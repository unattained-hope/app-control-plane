import { getDb } from "../db.js";
import { getConnector } from "../connectors/registry.js";
import { getMerchantHealthService, type MerchantHealthService } from "./merchantHealthService.js";
import { getNpsService, type NpsService } from "./npsService.js";
import { getLifecycleService, type LifecycleService } from "./lifecycleService.js";

/**
 * Growth-metrics rollup (cp-merchant-health / cp-uninstall-churn / cp-announcements-nps).
 * One per-tick job (driven by the growth-rollup worker): refresh each active merchant's
 * `MerchantHealthSnapshot`, infer reinstalls, and persist portfolio growth gauges
 * (`nps`, `churned_merchants`, `at_risk_merchants`) as `KpiSnapshot` rows so the
 * dashboard reads pre-aggregated history — never a live join. Reads the active shop set
 * through the connector (replica); writes only CP-owned tables.
 */

/** The active-shop source seam — connector-backed in prod, a stub in tests. */
export type ShopLister = (appKey: string) => Promise<string[]>;

async function connectorShops(appKey: string): Promise<string[]> {
  const connector = await getConnector(appKey);
  const page = await connector.listMerchants({ page: 1, pageSize: 1000 });
  return page.rows.map((r) => r.shop);
}

export class GrowthMetricsService {
  constructor(
    private readonly db = getDb(),
    private readonly health: MerchantHealthService = getMerchantHealthService(),
    private readonly nps: NpsService = getNpsService(),
    private readonly lifecycle: LifecycleService = getLifecycleService(),
    private readonly listShops: ShopLister = connectorShops,
  ) {}

  /** Run the rollup for one app. Returns the number of `KpiSnapshot` rows written. */
  async runRollup(appKey: string, now: Date = new Date()): Promise<number> {
    const shops = await this.listShops(appKey);

    let atRisk = 0;
    for (const shop of shops) {
      const result = await this.health.refreshAndPersist(appKey, shop, now);
      if (result.band !== "HEALTHY") atRisk += 1;
      // A previously-uninstalled shop that reappears active is a reinstall (idempotent
      // no-op once recorded).
      await this.lifecycle.recordReinstall(appKey, shop, now);
    }

    const nps = await this.nps.computeNps(appKey);
    const churned = (await this.lifecycle.churnedShops(appKey)).length;

    const rows = [
      { appKey, metric: "nps", value: nps, asOf: now },
      { appKey, metric: "churned_merchants", value: churned, asOf: now },
      { appKey, metric: "at_risk_merchants", value: atRisk, asOf: now },
    ];
    await this.db.kpiSnapshot.createMany({ data: rows });
    return rows.length;
  }
}

export const GROWTH_ROLLUP_QUEUE_NAME = "growth-rollup";

let instance: GrowthMetricsService | null = null;
export function getGrowthMetricsService(): GrowthMetricsService {
  if (!instance) instance = new GrowthMetricsService();
  return instance;
}
