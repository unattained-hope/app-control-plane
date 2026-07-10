import type { PlanChangeRequest } from "@prisma/client";
import { getDb } from "../db.js";
import { getAuditService, type AuditService } from "./auditService.js";
import { getBillingService } from "./billingService.js";
import { getConversationService, type ConversationService } from "./conversationService.js";
import { AuditActions } from "~/lib/auditActions.js";
import { getConfig, isAppAdminApiConfigured } from "~/lib/config.js";
import { captureError } from "~/lib/observability.js";
import type { SubscriptionState } from "../connectors/types.js";

/**
 * Self-serve billing — plan change (cp-self-serve-billing). Merchant-facing. The
 * control plane holds NO per-shop Shopify token and NEVER mutates billing or the app
 * DB directly: a plan change is recorded as a CP-owned `PlanChangeRequest` and
 * DISPATCHED to the narrow SaleSwitch admin API (the `complianceService.autoDispatch`
 * pattern), which performs the Shopify managed-pricing mutation and returns a
 * confirmation URL. When the admin API is absent, it degrades to opening a support
 * conversation — never a direct mutation. Every transition is audited.
 */

/**
 * SaleSwitch's managed-pricing plan catalog. Placeholder until the app admin API
 * exposes the live catalog (PRD D2 / open question §14.5) — the merchant-facing read
 * surfaces it so the picker renders; the actual mutation is the app's responsibility.
 */
export const DEFAULT_PLAN_CATALOG = ["Free", "Starter", "Pro"] as const;

export interface PlanChangeActorless {
  readonly shop: string;
}

/** App-admin-API dispatch seam (real fetch in prod; a stub in tests). */
export interface PlanChangeDispatcher {
  dispatch(input: {
    appKey: string;
    shop: string;
    requestId: string;
    toPlan: string;
  }): Promise<{
    ok: boolean;
    confirmationUrl?: string | null;
    externalRef?: string | null;
    error?: string | null;
  }>;
}

export interface BillingReadLike {
  getSubscription(shop: string): Promise<SubscriptionState>;
}

export interface PlanOptions {
  readonly current: SubscriptionState;
  readonly plans: readonly string[];
}

const SYSTEM_ACTOR = "system:self-serve";

/** Production dispatcher: POST the change to the narrow SaleSwitch admin API. */
const httpDispatcher: PlanChangeDispatcher = {
  async dispatch(input) {
    const cfg = getConfig();
    try {
      const res = await fetch(`${cfg.SALESWITCH_ADMIN_API_URL}/admin/billing/plan-change`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${cfg.SALESWITCH_ADMIN_API_TOKEN ?? ""}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ shop: input.shop, requestId: input.requestId, toPlan: input.toPlan }),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = (await res.json().catch(() => ({}))) as {
        confirmationUrl?: string;
        jobId?: string;
      };
      return { ok: true, confirmationUrl: data.confirmationUrl ?? null, externalRef: data.jobId ?? null };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "unknown error" };
    }
  },
};

export class PlanChangeService {
  constructor(
    private readonly db = getDb(),
    private readonly audit: AuditService = getAuditService(),
    private readonly billing: BillingReadLike = getBillingService(),
    private readonly conversations: ConversationService = getConversationService(),
    private readonly dispatcher: PlanChangeDispatcher = httpDispatcher,
    private readonly adminApiConfigured: () => boolean = () => isAppAdminApiConfigured(),
  ) {}

  /** Current subscription + available plans for the merchant-facing picker. */
  async getOptions(shop: string): Promise<PlanOptions> {
    const current = await this.billing.getSubscription(shop);
    return { current, plans: [...DEFAULT_PLAN_CATALOG] };
  }

  /**
   * Record + dispatch a plan-change request. Returns the persisted row (with the
   * Shopify confirmation URL when the app admin API handled it, or a `conversationId`
   * when it fell back to a ticket). Never mutates billing or the app DB directly.
   */
  async requestChange(
    appKey: string,
    shop: string,
    toPlan: string,
    fromPlan: string | null = null,
  ): Promise<PlanChangeRequest> {
    const request = await this.db.$transaction(async (tx) => {
      const created = await tx.planChangeRequest.create({
        data: { appKey, shop, fromPlan, toPlan, status: "REQUESTED" },
      });
      await this.audit.append(
        {
          actorUserId: `${SYSTEM_ACTOR}:${shop}`,
          actorType: "SYSTEM",
          source: "API",
          appKey,
          merchantShop: shop,
          action: AuditActions.BillingPlanChangeRequested,
          target: created.id,
          before: null,
          after: { toPlan, fromPlan },
        },
        tx,
      );
      return created;
    });

    if (this.adminApiConfigured()) {
      const result = await this.dispatcher.dispatch({ appKey, shop, requestId: request.id, toPlan });
      return result.ok
        ? this.markDispatched(request.id, result.confirmationUrl ?? null, result.externalRef ?? null)
        : this.markFailed(request.id, result.error ?? "dispatch failed");
    }

    // Fallback: no app admin API → open a support conversation. No direct mutation.
    return this.fallbackToConversation(request.id, appKey, shop, toPlan);
  }

  private async markDispatched(
    id: string,
    confirmationUrl: string | null,
    externalRef: string | null,
  ): Promise<PlanChangeRequest> {
    return this.db.$transaction(async (tx) => {
      const updated = await tx.planChangeRequest.update({
        where: { id },
        data: { status: "DISPATCHED", confirmationUrl, externalRef },
      });
      await this.audit.append(
        {
          actorUserId: `${SYSTEM_ACTOR}:${updated.shop}`,
          actorType: "SYSTEM",
          source: "API",
          appKey: updated.appKey,
          merchantShop: updated.shop,
          action: AuditActions.BillingPlanChangeDispatched,
          target: id,
          before: { status: "REQUESTED" },
          after: { status: "DISPATCHED", confirmationUrl },
        },
        tx,
      );
      return updated;
    });
  }

  private async markFailed(id: string, error: string): Promise<PlanChangeRequest> {
    return this.db.$transaction(async (tx) => {
      const updated = await tx.planChangeRequest.update({
        where: { id },
        data: { status: "FAILED", error },
      });
      await this.audit.append(
        {
          actorUserId: `${SYSTEM_ACTOR}:${updated.shop}`,
          actorType: "SYSTEM",
          source: "API",
          appKey: updated.appKey,
          merchantShop: updated.shop,
          action: AuditActions.BillingPlanChangeFailed,
          target: id,
          before: { status: "REQUESTED" },
          after: { status: "FAILED", error },
        },
        tx,
      );
      return updated;
    });
  }

  private async fallbackToConversation(
    id: string,
    appKey: string,
    shop: string,
    toPlan: string,
  ): Promise<PlanChangeRequest> {
    let conversationId: string | null = null;
    try {
      const convo = await this.conversations.getOrCreateForShop(appKey, shop);
      conversationId = convo.id;
      await this.conversations.persistMessage({
        conversationId: convo.id,
        senderType: "SYSTEM",
        senderId: "system:self-serve",
        body: `Merchant requested a plan change to "${toPlan}". No self-serve billing API is configured — handle this manually.`,
      });
    } catch (err) {
      captureError(err, { where: "planChangeService.fallbackToConversation", shop });
    }
    return this.db.planChangeRequest.update({ where: { id }, data: { conversationId } });
  }

  /** Recent plan-change requests for the admin view. */
  async list(appKey: string, limit = 200): Promise<PlanChangeRequest[]> {
    return this.db.planChangeRequest.findMany({
      where: { appKey },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}

let instance: PlanChangeService | null = null;
export function getPlanChangeService(): PlanChangeService {
  if (!instance) instance = new PlanChangeService();
  return instance;
}
