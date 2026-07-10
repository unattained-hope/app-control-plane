import { createHash } from "node:crypto";
import { Prisma, type WebhookStatus } from "@prisma/client";
import { getDb } from "../db.js";
import {
  getSecretsManager,
  SALESWITCH_WEBHOOK_SECRET_REF,
} from "~/lib/secrets.js";
import { enqueueWebhook, reenqueueWebhook } from "../workers/webhookProcess.js";
import { getAuditService, type AuditService } from "./auditService.js";
import { AuditActions } from "~/lib/auditActions.js";

/**
 * Webhook ingestion + reliability service (cp-webhook-ingestion,
 * cp-webhook-reliability). Owns the idempotent persist + enqueue, per-app secret
 * resolution, the failed-delivery read, and the audited manual replay.
 *
 * INVARIANTS:
 *  - `WebhookEvent.shopifyWebhookId` is unique → at-least-once dedupe. A duplicate
 *    delivery creates nothing and enqueues nothing.
 *  - `contentHash` (SHA-256 of the raw body) is a SECONDARY dedupe guard: a
 *    redelivery with a fresh webhook-id but identical `(appKey, topic)` body is also
 *    a no-op.
 *  - An invalid-HMAC delivery is recorded (forensics) but NEVER enqueued.
 *  - The environment is never read here — secrets come through the secrets seam.
 */
const DEFAULT_APP_KEY = "saleswitch";

export interface IngestInput {
  readonly webhookId: string;
  readonly topic: string;
  readonly shop: string | null;
  readonly appKey: string;
  readonly raw: string;
}

export interface FailedDeliveryQuery {
  readonly appKey: string;
  readonly status?: readonly WebhookStatus[];
  readonly topic?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface FailedDeliveryRow {
  readonly id: string;
  readonly topic: string;
  readonly shop: string | null;
  readonly status: WebhookStatus;
  readonly attempts: number;
  readonly error: string | null;
  readonly receivedAt: string;
  readonly lastAttemptAt: string | null;
}

export interface ReplayActor {
  readonly id: string;
  readonly email: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

function isDuplicate(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function parsePayload(raw: string): Prisma.InputJsonValue {
  try {
    return JSON.parse(raw) as Prisma.InputJsonValue;
  } catch {
    // Non-JSON body (e.g. a malformed/forged delivery): keep it verbatim.
    return { _raw: raw };
  }
}

/** SHA-256 of the raw body — the secondary dedupe key (cp-webhook-reliability). */
export function hashWebhookBody(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export class WebhookService {
  // Constructor injection gives a DB-free test seam; defaults preserve the
  // singleton/production wiring.
  constructor(
    private readonly db = getDb(),
    private readonly enqueue: (webhookEventId: string) => Promise<void> = enqueueWebhook,
    private readonly reenqueue: (webhookEventId: string) => Promise<void> = reenqueueWebhook,
    private readonly audit: AuditService = getAuditService(),
  ) {}

  /** Map a shop domain to its registered app key. MVP: the single tenant. */
  appKeyForShop(_shop: string | null): string {
    return DEFAULT_APP_KEY;
  }

  /** Resolve the webhook-signing secret for an app via the secrets seam. */
  async resolveSecret(appKey: string): Promise<string> {
    const ref = this.webhookSecretRef(appKey);
    return getSecretsManager().resolveWebhookSecret(ref);
  }

  /** MVP: the canonical SaleSwitch ref. Multi-app reads `App.webhookSecretRef`. */
  private webhookSecretRef(_appKey: string): string {
    return SALESWITCH_WEBHOOK_SECRET_REF;
  }

  /**
   * Idempotent ingest of a VERIFIED delivery. Creates exactly one WebhookEvent and
   * enqueues exactly one job; a duplicate `webhookId` OR an identical-body redelivery
   * for the same `(appKey, topic)` is a no-op (no row, no job).
   */
  async ingest(input: IngestInput): Promise<{ enqueued: boolean }> {
    const contentHash = hashWebhookBody(input.raw);
    // Secondary dedupe: a redelivery with a fresh webhook-id but identical body.
    const dup = await this.db.webhookEvent.findFirst({
      where: { appKey: input.appKey, topic: input.topic, contentHash },
    });
    if (dup) return { enqueued: false };

    let id: string;
    try {
      id = await this.create(input, true, "RECEIVED", contentHash);
    } catch (err) {
      if (isDuplicate(err)) return { enqueued: false };
      throw err;
    }
    await this.enqueue(id);
    return { enqueued: true };
  }

  /**
   * Record an invalid-HMAC delivery for forensics. Never enqueues. A replayed bad
   * signature (same id) is swallowed as a duplicate.
   */
  async recordInvalid(input: IngestInput): Promise<void> {
    try {
      await this.create(input, false, "FAILED", hashWebhookBody(input.raw));
    } catch (err) {
      if (!isDuplicate(err)) throw err;
    }
  }

  /**
   * The failed-delivery read (cp-webhook-reliability). Server-paginated list of
   * FAILED / DEAD_LETTER events for the ops view. CP-table read only.
   */
  async listFailed(q: FailedDeliveryQuery): Promise<FailedDeliveryRow[]> {
    const statuses = q.status ?? (["FAILED", "DEAD_LETTER"] as const);
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25));
    const rows = await this.db.webhookEvent.findMany({
      where: {
        appKey: q.appKey,
        status: { in: [...statuses] },
        ...(q.topic ? { topic: q.topic } : {}),
      },
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return rows.map((r) => ({
      id: r.id,
      topic: r.topic,
      shop: r.shop,
      status: r.status,
      attempts: r.attempts,
      error: r.error,
      receivedAt: r.receivedAt.toISOString(),
      lastAttemptAt: r.lastAttemptAt ? r.lastAttemptAt.toISOString() : null,
    }));
  }

  /**
   * Replay a dead-lettered/failed event (cp-webhook-reliability). Resets the status
   * to RECEIVED and writes a `webhook.replayed` audit row in the SAME transaction,
   * then re-enqueues for reprocessing (reprocessing stays idempotent). ADMIN-only
   * (enforced in the router). `attempts` is left intact for the record.
   */
  async replay(actor: ReplayActor, appKey: string, eventId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const ev = await tx.webhookEvent.findUnique({ where: { id: eventId } });
      if (!ev || ev.appKey !== appKey) {
        throw new Prisma.PrismaClientKnownRequestError("WebhookEvent not found", {
          code: "P2025",
          clientVersion: Prisma.prismaVersion.client,
        });
      }
      await tx.webhookEvent.update({
        where: { id: eventId },
        data: { status: "RECEIVED", error: null },
      });
      await this.audit.append(
        {
          actorUserId: actor.id,
          actorEmail: actor.email,
          appKey,
          merchantShop: ev.shop ?? null,
          action: AuditActions.WebhookReplayed,
          target: eventId,
          before: { status: ev.status, attempts: ev.attempts },
          after: { status: "RECEIVED" },
          ip: actor.ip,
          userAgent: actor.userAgent,
        },
        tx,
      );
    });
    await this.reenqueue(eventId);
  }

  /**
   * Terminal dead-letter transition (cp-webhook-reliability), called by the worker on
   * retry exhaustion. Moves `FAILED → DEAD_LETTER` and audits `webhook.dead_lettered`
   * (SYSTEM/JOB) in one transaction. Idempotent — a re-run on a dead-lettered event
   * is a no-op.
   */
  async deadLetter(eventId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.db.$transaction(async (tx) => {
      const ev = await tx.webhookEvent.findUnique({ where: { id: eventId } });
      if (!ev || ev.status === "DEAD_LETTER") return;
      await tx.webhookEvent.update({
        where: { id: eventId },
        data: { status: "DEAD_LETTER", error: message },
      });
      await this.audit.append(
        {
          actorUserId: "system:webhook-process",
          actorType: "SYSTEM",
          source: "JOB",
          appKey: ev.appKey,
          merchantShop: ev.shop ?? null,
          action: AuditActions.WebhookDeadLettered,
          target: eventId,
          before: { status: ev.status },
          after: { status: "DEAD_LETTER", attempts: ev.attempts, error: message },
        },
        tx,
      );
    });
  }

  /** Transient failure marking (still retriable). No audit — only the terminal one is. */
  async markFailedTransient(eventId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.db.webhookEvent.update({
      where: { id: eventId },
      data: { status: "FAILED", error: message },
    });
  }

  private async create(
    input: IngestInput,
    hmacValid: boolean,
    status: WebhookStatus,
    contentHash: string,
  ): Promise<string> {
    const row = await this.db.webhookEvent.create({
      data: {
        appKey: input.appKey,
        topic: input.topic,
        shopifyWebhookId: input.webhookId,
        shop: input.shop,
        hmacValid,
        status,
        contentHash,
        payload: parsePayload(input.raw),
        error: hmacValid ? null : "invalid HMAC signature",
      },
    });
    return row.id;
  }
}

let instance: WebhookService | null = null;
export function getWebhookService(): WebhookService {
  if (!instance) instance = new WebhookService();
  return instance;
}
