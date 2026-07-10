import { Prisma, type WebhookEvent } from "@prisma/client";
import { getDb } from "../db.js";
import { getAuditService } from "./auditService.js";
import { getKpiService } from "./kpiService.js";
import { captureError } from "~/lib/observability.js";
import { AuditActions } from "~/lib/auditActions.js";

/**
 * Billing & subscription monitoring (cp-billing-monitoring). Worker branch for the
 * `app_subscriptions/*` topics.
 *
 * CAVEAT baked into the design: `app_subscriptions/update` is EVENT-DRIVEN — it does
 * NOT fire on every monthly auto-renewal. The periodic KPI rollup remains the source
 * of truth for MRR; these webhooks are low-latency nudges that append a fresh
 * snapshot (append-only — prior `KpiSnapshot` rows are never mutated).
 */
const SYSTEM_ACTOR = "system:webhook";

function shopFrom(event: WebhookEvent): string {
  return event.shop ?? "unknown";
}

export class BillingMonitor {
  // Constructor injection gives a DB-free test seam; defaults preserve production.
  constructor(
    private readonly db = getDb(),
    private readonly audit = getAuditService(),
    private readonly kpi = getKpiService(),
  ) {}

  async handleWebhook(event: WebhookEvent): Promise<void> {
    switch (event.topic) {
      case "app_subscriptions/update":
        await this.onSubscriptionUpdate(event);
        return;
      case "app_subscriptions/approaching_capped_amount":
        await this.onCapApproaching(event);
        return;
      default:
        return;
    }
  }

  /**
   * Subscription change → append a fresh KPI snapshot (mrr + active_merchants are
   * recomputed from the replica via the append-only rollup) and audit. A rollup
   * failure is captured but never blocks acknowledgement (periodic rollup is the
   * source of truth).
   */
  private async onSubscriptionUpdate(event: WebhookEvent): Promise<void> {
    const shop = shopFrom(event);
    try {
      await this.kpi.runRollup(event.appKey);
    } catch (err) {
      captureError(err, { where: "billingMonitor.onSubscriptionUpdate", shop });
    }
    await this.audit.append({
      actorUserId: SYSTEM_ACTOR,
      actorType: "SYSTEM",
      source: "JOB",
      appKey: event.appKey,
      merchantShop: shop,
      action: AuditActions.BillingSubscriptionUpdated,
      target: shop,
      before: null,
      after: { topic: event.topic },
    });
  }

  /**
   * Cap-approaching → raise exactly one control-plane-owned `BillingAlert` and audit
   * `billing.cap.approaching`, in the same transaction.
   */
  private async onCapApproaching(event: WebhookEvent): Promise<void> {
    const shop = shopFrom(event);
    await this.db.$transaction(async (tx) => {
      const alert = await tx.billingAlert.create({
        data: {
          appKey: event.appKey,
          shop,
          kind: "CAP_APPROACHING",
          payload: (event.payload ?? {}) as Prisma.InputJsonValue,
        },
      });
      await this.audit.append(
        {
          actorUserId: SYSTEM_ACTOR,
          actorType: "SYSTEM",
          source: "JOB",
          appKey: event.appKey,
          merchantShop: shop,
          action: AuditActions.BillingCapApproaching,
          target: alert.id,
          before: null,
          after: { topic: event.topic },
        },
        tx,
      );
    });
  }
}

let instance: BillingMonitor | null = null;
export function getBillingMonitor(): BillingMonitor {
  if (!instance) instance = new BillingMonitor();
  return instance;
}
