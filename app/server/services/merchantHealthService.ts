import type { Prisma } from "@prisma/client";
import { getDb } from "../db.js";
import { getAuditService, type AuditService } from "./auditService.js";
import { getBillingService } from "./billingService.js";
import { AuditActions } from "~/lib/auditActions.js";
import {
  scoreHealth,
  type HealthResult,
  type HealthSignals,
  type SubscriptionSignal,
} from "~/lib/healthScore.js";

/**
 * Merchant health derivation (cp-merchant-health). Gathers the observable signals —
 * subscription state (via the connector-backed billing service, replica/Shopify
 * state), open cap-approaching billing alerts, open support conversations + latest
 * CSAT, and lifecycle (uninstalled) — all from the connector + CP tables (NEVER the
 * app primary, no raw SQL) and runs the pure scorer. The growth rollup persists the
 * latest score per shop; the 360 panel + at-risk list read the pre-aggregated snapshot.
 */

/** Minimal subscription reader seam (the BillingService; a stub in tests). */
export interface SubscriptionReaderLike {
  getSubscription(shop: string): Promise<{ status: SubscriptionSignal }>;
}

export interface MerchantHealthRow {
  readonly shop: string;
  readonly score: number;
  readonly band: HealthResult["band"];
  readonly factors: readonly { key: string; points: number }[];
  readonly asOf: string;
}

export class MerchantHealthService {
  constructor(
    private readonly db = getDb(),
    private readonly audit: AuditService = getAuditService(),
    private readonly billing: SubscriptionReaderLike = getBillingService(),
  ) {}

  /** Gather signals (connector + CP tables) and run the pure scorer — no persistence. */
  async evaluate(appKey: string, shop: string): Promise<HealthResult> {
    const signals = await this.gatherSignals(appKey, shop);
    return scoreHealth(signals);
  }

  /** Collect the health signals for a shop. Connector (replica) + CP-table reads only. */
  async gatherSignals(appKey: string, shop: string): Promise<HealthSignals> {
    const [sub, capAlert, latestLifecycle, openConversations, latestCsatConvo] =
      await Promise.all([
        this.billing.getSubscription(shop),
        this.db.billingAlert.findFirst({
          where: { appKey, shop, kind: "CAP_APPROACHING", resolvedAt: null },
        }),
        this.db.merchantLifecycleEvent.findFirst({
          where: { appKey, shop },
          orderBy: { occurredAt: "desc" },
        }),
        this.db.conversation.count({ where: { appKey, shop, status: "OPEN" } }),
        this.db.conversation.findFirst({
          where: { appKey, shop, csatScore: { not: null } },
          orderBy: { lastMessageAt: "desc" },
        }),
      ]);
    return {
      subscription: sub.status,
      capAlert: capAlert != null,
      uninstalled: latestLifecycle?.kind === "UNINSTALL",
      openConversations,
      latestCsat: (latestCsatConvo?.csatScore as number | null | undefined) ?? null,
    };
  }

  /**
   * Evaluate + persist a `MerchantHealthSnapshot` (the growth-rollup write path). When
   * the band differs from the prior latest snapshot, audit `merchant.health.evaluated`
   * (SYSTEM/JOB) in the same transaction — so the log records band CHANGES, not every
   * tick. Returns the persisted result.
   */
  async refreshAndPersist(
    appKey: string,
    shop: string,
    now: Date = new Date(),
  ): Promise<HealthResult> {
    const result = await this.evaluate(appKey, shop);
    await this.db.$transaction(async (tx) => {
      const prior = await tx.merchantHealthSnapshot.findFirst({
        where: { appKey, shop },
        orderBy: { asOf: "desc" },
      });
      await tx.merchantHealthSnapshot.create({
        data: {
          appKey,
          shop,
          score: result.score,
          band: result.band,
          factors: result.factors as unknown as Prisma.InputJsonValue,
          asOf: now,
        },
      });
      if (!prior || prior.band !== result.band) {
        await this.audit.append(
          {
            actorUserId: "system:growth-rollup",
            actorType: "SYSTEM",
            source: "JOB",
            appKey,
            merchantShop: shop,
            action: AuditActions.MerchantHealthEvaluated,
            target: shop,
            before: prior ? { band: prior.band } : null,
            after: { band: result.band, score: result.score },
          },
          tx,
        );
      }
    });
    return result;
  }

  /** The latest snapshot for one shop (the 360-panel read). Null if never scored. */
  async latestForShop(appKey: string, shop: string): Promise<MerchantHealthRow | null> {
    const row = await this.db.merchantHealthSnapshot.findFirst({
      where: { appKey, shop },
      orderBy: { asOf: "desc" },
    });
    return row ? toRow(row) : null;
  }

  /**
   * The at-risk list: the latest snapshot per shop, ranked CRITICAL → AT_RISK →
   * HEALTHY, then by score (worst first). Reads pre-aggregated rows — no live join.
   */
  async atRisk(appKey: string, limit = 100): Promise<MerchantHealthRow[]> {
    const rows = await this.db.merchantHealthSnapshot.findMany({
      where: { appKey },
      orderBy: { asOf: "desc" },
    });
    const latestByShop = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (!latestByShop.has(r.shop as string)) latestByShop.set(r.shop as string, r);
    }
    return [...latestByShop.values()]
      .map(toRow)
      .sort((a, b) => bandRank(b.band) - bandRank(a.band) || b.score - a.score)
      .slice(0, limit);
  }
}

function bandRank(band: HealthResult["band"]): number {
  return band === "CRITICAL" ? 2 : band === "AT_RISK" ? 1 : 0;
}

function toRow(r: {
  shop: string;
  score: number;
  band: HealthResult["band"];
  factors: unknown;
  asOf: Date;
}): MerchantHealthRow {
  return {
    shop: r.shop,
    score: r.score,
    band: r.band,
    factors: (r.factors as { key: string; points: number }[] | null) ?? [],
    asOf: r.asOf.toISOString(),
  };
}

let instance: MerchantHealthService | null = null;
export function getMerchantHealthService(): MerchantHealthService {
  if (!instance) instance = new MerchantHealthService();
  return instance;
}
