import type { WebhookEvent } from "@prisma/client";
import { getDb } from "../db.js";
import { getAuditService, type AuditService } from "./auditService.js";
import { getKpiService } from "./kpiService.js";
import { AuditActions } from "~/lib/auditActions.js";
import { getConfig } from "~/lib/config.js";
import { captureError } from "~/lib/observability.js";

/**
 * App-uninstall / churn flow (cp-uninstall-churn). Worker branch for the
 * `app/uninstalled` lifecycle topic.
 *
 * INVARIANTS:
 *  - The control plane NEVER redacts application data here. Shopify drives redaction
 *    via `shop/redact` / `customers/redact` and the 30-day `ComplianceRequest` SLA
 *    (cp-compliance-dsr); this flow only RECORDS the uninstall + recomputes churn KPIs.
 *  - Every lifecycle transition writes an `AuditLog` row in the SAME transaction.
 *  - Idempotent: a replayed `app/uninstalled` (deduped at ingest) and a repeat where
 *    the latest lifecycle is already `UNINSTALL` both yield a single record.
 *  - Retention reconciliation (`purgeForRedactedShop`) purges only CP-OWNED PII-bearing
 *    records once redaction completes — the append-only `AuditLog` is never deleted —
 *    and is gated OFF by default (`CHURN_RETENTION_PURGE_ENABLED`).
 */
const SYSTEM_ACTOR = "system:webhook";
const JOB_ACTOR = "system:growth-rollup";

/** Minimal churn-KPI recomputer seam (the real KpiService; a stub in tests). */
export interface ChurnKpiRecomputer {
  runRollup(appKey: string): Promise<unknown>;
}

function shopFrom(event: WebhookEvent): string {
  if (event.shop) return event.shop;
  const payload = event.payload as { shop_domain?: unknown } | null;
  if (payload && typeof payload.shop_domain === "string") return payload.shop_domain;
  return "unknown";
}

export class LifecycleService {
  // Constructor injection gives a DB-free test seam; defaults preserve production.
  constructor(
    private readonly db = getDb(),
    private readonly audit: AuditService = getAuditService(),
    private readonly kpi: ChurnKpiRecomputer = getKpiService(),
  ) {}

  /** Worker entry: a verified `app/uninstalled` event → a tracked uninstall. */
  async handleWebhook(event: WebhookEvent): Promise<void> {
    await this.recordUninstall(event.appKey, shopFrom(event));
  }

  /**
   * Record an `UNINSTALL` lifecycle event + audit (same tx), then recompute churn
   * KPIs (best-effort — the periodic rollup is the source of truth, append-only).
   * Idempotent: if the latest lifecycle for the shop is already `UNINSTALL`, no-op.
   */
  async recordUninstall(appKey: string, shop: string, now: Date = new Date()): Promise<void> {
    const latest = await this.db.merchantLifecycleEvent.findFirst({
      where: { appKey, shop },
      orderBy: { occurredAt: "desc" },
    });
    if (latest && latest.kind === "UNINSTALL") return; // already uninstalled

    await this.db.$transaction(async (tx) => {
      const ev = await tx.merchantLifecycleEvent.create({
        data: { appKey, shop, kind: "UNINSTALL", occurredAt: now },
      });
      await this.audit.append(
        {
          actorUserId: SYSTEM_ACTOR,
          actorType: "SYSTEM",
          source: "JOB",
          appKey,
          merchantShop: shop,
          action: AuditActions.MerchantUninstalled,
          target: ev.id,
          before: null,
          after: { kind: "UNINSTALL" },
        },
        tx,
      );
    });

    try {
      await this.kpi.runRollup(appKey);
    } catch (err) {
      captureError(err, { where: "lifecycleService.recordUninstall", shop });
    }
  }

  /**
   * Record a `REINSTALL` (inferred by the growth rollup when a previously-uninstalled
   * shop reappears active). Idempotent: only fires when the latest lifecycle is
   * `UNINSTALL`. Audited SYSTEM/JOB in the same transaction.
   */
  async recordReinstall(appKey: string, shop: string, now: Date = new Date()): Promise<boolean> {
    const latest = await this.db.merchantLifecycleEvent.findFirst({
      where: { appKey, shop },
      orderBy: { occurredAt: "desc" },
    });
    if (!latest || latest.kind !== "UNINSTALL") return false; // not a churned shop

    await this.db.$transaction(async (tx) => {
      const ev = await tx.merchantLifecycleEvent.create({
        data: { appKey, shop, kind: "REINSTALL", occurredAt: now },
      });
      await this.audit.append(
        {
          actorUserId: JOB_ACTOR,
          actorType: "SYSTEM",
          source: "JOB",
          appKey,
          merchantShop: shop,
          action: AuditActions.MerchantReinstalled,
          target: ev.id,
          before: { kind: latest.kind },
          after: { kind: "REINSTALL" },
        },
        tx,
      );
    });
    return true;
  }

  /** Shops currently churned (latest lifecycle is `UNINSTALL`) — drives churn aggregates. */
  async churnedShops(appKey: string): Promise<string[]> {
    const events = await this.db.merchantLifecycleEvent.findMany({
      where: { appKey },
      orderBy: { occurredAt: "desc" },
    });
    const latestByShop = new Map<string, string>();
    for (const e of events) {
      if (!latestByShop.has(e.shop)) latestByShop.set(e.shop, e.kind);
    }
    return [...latestByShop.entries()].filter(([, kind]) => kind === "UNINSTALL").map(([shop]) => shop);
  }

  /**
   * Retention reconciliation (cp-uninstall-churn). When the `shop/redact` request for
   * an uninstalled shop COMPLETES, purge the control plane's OWN PII-bearing records
   * for that shop (merchant notes + conversations/messages). The append-only
   * `AuditLog` is NEVER deleted. Gated OFF by default (`CHURN_RETENTION_PURGE_ENABLED`)
   * pending team/legal confirmation (docs/churn-retention.md). Redaction of APP data
   * stays the compliance flow's job — this never touches the app DB.
   */
  async purgeForRedactedShop(
    appKey: string,
    shop: string,
  ): Promise<{ purged: boolean; notes: number; conversations: number }> {
    if (!getConfig().CHURN_RETENTION_PURGE_ENABLED) {
      return { purged: false, notes: 0, conversations: 0 };
    }
    return this.db.$transaction(async (tx) => {
      const notes = await tx.merchantNote.deleteMany({ where: { appKey, shop } });
      // Messages cascade-delete with their conversation (schema onDelete: Cascade).
      const conversations = await tx.conversation.deleteMany({ where: { appKey, shop } });
      await this.audit.append(
        {
          actorUserId: SYSTEM_ACTOR,
          actorType: "SYSTEM",
          source: "JOB",
          appKey,
          merchantShop: shop,
          action: AuditActions.MerchantUninstalled,
          target: shop,
          before: null,
          after: {
            retentionPurge: true,
            notes: notes.count,
            conversations: conversations.count,
          },
        },
        tx,
      );
      return { purged: true, notes: notes.count, conversations: conversations.count };
    });
  }
}

let instance: LifecycleService | null = null;
export function getLifecycleService(): LifecycleService {
  if (!instance) instance = new LifecycleService();
  return instance;
}
