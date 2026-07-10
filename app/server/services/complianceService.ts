import {
  Prisma,
  type ComplianceRequest,
  type ComplianceStatus,
  type ComplianceTopic,
  type WebhookEvent,
} from "@prisma/client";
import { getDb } from "../db.js";
import { getAuditService } from "./auditService.js";
import { ConfirmationError } from "./merchantActionService.js";
import { complianceTopicEnum } from "~/lib/shopifyWebhook.js";
import { getConfig, isAppAdminApiConfigured } from "~/lib/config.js";
import { captureError } from "~/lib/observability.js";
import { AuditActions } from "~/lib/auditActions.js";

/**
 * GDPR / data-subject-request handling (cp-compliance-dsr).
 *
 * INVARIANTS:
 *  - `dueAt = receivedAt + 30 days` drives the SLA against Shopify's 30-day mandate.
 *  - EVERY state change writes an `AuditLog` row in the SAME `$transaction` as the
 *    change (same pattern as merchant notes/tags); an audit-insert failure rolls the
 *    transition back — no compliance state exists without an audit record.
 *  - The control plane NEVER mutates the app DB. Execution (redaction/export) is
 *    dispatched to the narrow app admin API; until it exists we run A-phased
 *    (ingest + track + manual operator fulfilment).
 */
export const SLA_DAYS = 30;
export const DEFAULT_BREACH_THRESHOLD_DAYS = 5;

/** Audit actor for webhook-driven (non-operator) transitions. */
const SYSTEM_ACTOR = "system:webhook";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Serialized compliance row for the operator queue UI. */
export interface ComplianceRow {
  readonly id: string;
  readonly appKey: string;
  readonly topic: ComplianceTopic;
  readonly shop: string;
  readonly status: ComplianceStatus;
  readonly receivedAt: string;
  readonly dueAt: string;
  readonly dispatchedAt: string | null;
  readonly completedAt: string | null;
}

export interface OperatorContext {
  readonly actorUserId: string;
  readonly actorEmail?: string | null;
  readonly appKey: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

function toRow(r: ComplianceRequest): ComplianceRow {
  return {
    id: r.id,
    appKey: r.appKey,
    topic: r.topic,
    shop: r.shop,
    status: r.status,
    receivedAt: r.receivedAt.toISOString(),
    dueAt: r.dueAt.toISOString(),
    dispatchedAt: r.dispatchedAt ? r.dispatchedAt.toISOString() : null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
  };
}

/** Extract the shop domain from header or the compliance payload. */
function shopFrom(event: WebhookEvent): string {
  if (event.shop) return event.shop;
  const payload = event.payload as { shop_domain?: unknown } | null;
  if (payload && typeof payload.shop_domain === "string") return payload.shop_domain;
  return "unknown";
}

export class ComplianceService {
  // Constructor injection gives a DB-free test seam; defaults preserve production.
  constructor(
    private readonly db = getDb(),
    private readonly audit = getAuditService(),
  ) {}

  /**
   * Worker entry: turn a verified compliance `WebhookEvent` into a tracked request,
   * then (A-phased) auto-dispatch if the app admin API is configured.
   */
  async handleWebhook(event: WebhookEvent): Promise<void> {
    const topic = complianceTopicEnum(event.topic);
    if (!topic) return; // not a compliance topic — processor shouldn't route it here
    const req = await this.record({
      appKey: event.appKey,
      topic,
      shop: shopFrom(event),
      payload: (event.payload ?? {}) as Prisma.InputJsonValue,
      receivedAt: event.receivedAt,
      webhookEventId: event.id,
    });
    if (isAppAdminApiConfigured()) {
      await this.autoDispatch(req);
    }
  }

  /** Create a tracked request + the `compliance.request.received` audit (same tx). */
  async record(input: {
    appKey: string;
    topic: ComplianceTopic;
    shop: string;
    payload: Prisma.InputJsonValue;
    receivedAt?: Date;
    webhookEventId?: string | null;
  }): Promise<ComplianceRequest> {
    const receivedAt = input.receivedAt ?? new Date();
    const dueAt = new Date(receivedAt.getTime() + SLA_DAYS * DAY_MS);
    return this.db.$transaction(async (tx) => {
      const req = await tx.complianceRequest.create({
        data: {
          appKey: input.appKey,
          topic: input.topic,
          shop: input.shop,
          status: "RECEIVED",
          payload: input.payload,
          receivedAt,
          dueAt,
          webhookEventId: input.webhookEventId ?? null,
        },
      });
      await this.audit.append(
        {
          actorUserId: SYSTEM_ACTOR,
          actorType: "SYSTEM",
          source: "JOB",
          appKey: input.appKey,
          merchantShop: input.shop,
          action: AuditActions.ComplianceRequestReceived,
          target: req.id,
          before: null,
          after: { topic: input.topic, dueAt: dueAt.toISOString() },
        },
        tx,
      );
      return req;
    });
  }

  /**
   * A-phased auto-dispatch: POST the export/redaction to the narrow app admin API,
   * then record IN_PROGRESS + audit `compliance.dispatched`. On failure, audit
   * `compliance.failed`. Never mutates the app DB directly.
   */
  private async autoDispatch(req: ComplianceRequest): Promise<void> {
    const cfg = getConfig();
    let ok = false;
    let externalRef: string | null = null;
    let errorDetail: string | null = null;
    try {
      const res = await fetch(`${cfg.SALESWITCH_ADMIN_API_URL}/admin/compliance/${req.topic}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${cfg.SALESWITCH_ADMIN_API_TOKEN ?? ""}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ shop: req.shop, requestId: req.id, payload: req.payload }),
      });
      ok = res.ok;
      if (ok) {
        externalRef = res.headers.get("x-job-id");
      } else {
        errorDetail = `HTTP ${res.status}`;
      }
    } catch (err) {
      errorDetail = err instanceof Error ? err.message : "unknown error";
      captureError(err, { where: "complianceService.autoDispatch", requestId: req.id });
    }
    if (ok) {
      await this.markDispatched(req.id, externalRef);
    } else {
      await this.markFailed(req.id, errorDetail);
    }
  }

  /** Transition to IN_PROGRESS + audit `compliance.dispatched` (same tx). */
  async markDispatched(id: string, externalRef: string | null): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const before = await tx.complianceRequest.findUniqueOrThrow({ where: { id } });
      const updated = await tx.complianceRequest.update({
        where: { id },
        data: { status: "IN_PROGRESS", dispatchedAt: new Date(), externalRef },
      });
      await this.audit.append(
        {
          actorUserId: SYSTEM_ACTOR,
          actorType: "SYSTEM",
          source: "JOB",
          appKey: updated.appKey,
          merchantShop: updated.shop,
          action: AuditActions.ComplianceDispatched,
          target: id,
          before: { status: before.status },
          after: { status: updated.status, externalRef },
        },
        tx,
      );
    });
  }

  /** Transition to FAILED + audit `compliance.failed` (same tx). */
  async markFailed(id: string, error: string | null): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const before = await tx.complianceRequest.findUniqueOrThrow({ where: { id } });
      const updated = await tx.complianceRequest.update({
        where: { id },
        data: { status: "FAILED" },
      });
      await this.audit.append(
        {
          actorUserId: SYSTEM_ACTOR,
          actorType: "SYSTEM",
          source: "JOB",
          appKey: updated.appKey,
          merchantShop: updated.shop,
          action: AuditActions.ComplianceFailed,
          target: id,
          before: { status: before.status },
          after: { status: updated.status, error },
        },
        tx,
      );
    });
  }

  /**
   * Operator "mark fulfilled": type-to-confirm guarded (confirm text must equal the
   * shop domain, matching merchant-action ergonomics), transition to COMPLETED +
   * audit `compliance.completed` (same tx, operator as actor).
   */
  async markCompleted(ctx: OperatorContext, id: string, confirmText: string): Promise<void> {
    let completed: { topic: ComplianceTopic; shop: string; appKey: string } | null = null;
    await this.db.$transaction(async (tx) => {
      const before = await tx.complianceRequest.findUnique({ where: { id } });
      if (!before || before.appKey !== ctx.appKey) {
        throw new Prisma.PrismaClientKnownRequestError("Compliance request not found", {
          code: "P2025",
          clientVersion: Prisma.prismaVersion.client,
        });
      }
      if (confirmText.trim() !== before.shop) {
        throw new ConfirmationError();
      }
      const updated = await tx.complianceRequest.update({
        where: { id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      await this.audit.append(
        {
          actorUserId: ctx.actorUserId,
          actorEmail: ctx.actorEmail ?? null,
          appKey: updated.appKey,
          merchantShop: updated.shop,
          action: AuditActions.ComplianceCompleted,
          target: id,
          before: { status: before.status },
          after: { status: updated.status },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
      completed = { topic: updated.topic, shop: updated.shop, appKey: updated.appKey };
    });

    // Retention reconciliation (cp-uninstall-churn): once a `shop/redact` completes,
    // purge the control plane's OWN PII-bearing records for the shop (gated by config;
    // audit never purged). Best-effort — never blocks the compliance completion.
    const done = completed as { topic: ComplianceTopic; shop: string; appKey: string } | null;
    if (done && done.topic === "SHOP_REDACT") {
      try {
        const { getLifecycleService } = await import("./lifecycleService.js");
        await getLifecycleService().purgeForRedactedShop(done.appKey, done.shop);
      } catch (err) {
        captureError(err, { where: "complianceService.purgeForRedactedShop", shop: done.shop });
      }
    }
  }

  /** Open requests (RECEIVED | IN_PROGRESS), soonest-due first. */
  async listPending(appKey: string): Promise<ComplianceRow[]> {
    const rows = await this.db.complianceRequest.findMany({
      where: { appKey, status: { in: ["RECEIVED", "IN_PROGRESS"] } },
      orderBy: { dueAt: "asc" },
      take: 500,
    });
    return rows.map(toRow);
  }

  /**
   * Open requests within `thresholdDays` of (or past) their `dueAt` — the
   * "what's breaching" query backed by `@@index([status, dueAt])`.
   */
  async listBreaching(
    appKey: string,
    thresholdDays = DEFAULT_BREACH_THRESHOLD_DAYS,
    now: Date = new Date(),
  ): Promise<ComplianceRow[]> {
    const cutoff = new Date(now.getTime() + thresholdDays * DAY_MS);
    const rows = await this.db.complianceRequest.findMany({
      where: {
        appKey,
        status: { in: ["RECEIVED", "IN_PROGRESS"] },
        dueAt: { lte: cutoff },
      },
      orderBy: { dueAt: "asc" },
      take: 500,
    });
    return rows.map(toRow);
  }
}

let instance: ComplianceService | null = null;
export function getComplianceService(): ComplianceService {
  if (!instance) instance = new ComplianceService();
  return instance;
}
