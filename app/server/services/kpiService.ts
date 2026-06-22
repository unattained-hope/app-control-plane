import { getDb } from "../db.js";
import { getConnector } from "../connectors/registry.js";

/**
 * KPI dashboard reads + rollup persistence (cp-kpi-dashboard). The dashboard reads
 * ONLY pre-aggregated KpiSnapshot rows (no live joins on production data). The
 * rollup runs `connector.computeKpis()` against the replica and appends snapshots.
 */
export interface KpiValue {
  readonly metric: string;
  readonly value: number;
  readonly asOf: string; // ISO
}

export const MVP_METRICS = [
  "active_merchants",
  "new_installs_7d",
  "new_installs_30d",
  "uninstalls",
  "plan_distribution",
  "mrr",
] as const;

export class KpiService {
  private readonly db = getDb();

  /**
   * Latest snapshot per metric for an app — the dashboard read path. Issues NO
   * query against the connector's production tables (cp-kpi-dashboard AC8.1).
   * Metrics with no snapshot are simply absent (the UI renders a placeholder).
   */
  async latest(appKey: string): Promise<KpiValue[]> {
    const rows = await this.db.kpiSnapshot.findMany({
      where: { appKey, metric: { in: [...MVP_METRICS] } },
      orderBy: { asOf: "desc" },
    });
    const seen = new Set<string>();
    const out: KpiValue[] = [];
    for (const r of rows) {
      if (seen.has(r.metric)) continue; // first row per metric is the latest asOf
      seen.add(r.metric);
      out.push({ metric: r.metric, value: r.value, asOf: r.asOf.toISOString() });
    }
    return out;
  }

  /**
   * Rollup: compute KPIs against the REPLICA and append one snapshot per metric.
   * On failure the caller (BullMQ) retries; prior snapshots remain intact (AC8.1
   * rollup-failure scenario) because this only appends.
   */
  async runRollup(appKey: string): Promise<number> {
    const connector = await getConnector(appKey);
    const kpis = await connector.computeKpis();
    await this.db.kpiSnapshot.createMany({
      data: kpis.map((k) => ({
        appKey,
        metric: k.metric,
        value: k.value,
        asOf: new Date(k.asOf),
      })),
    });
    return kpis.length;
  }
}

let instance: KpiService | null = null;
export function getKpiService(): KpiService {
  if (!instance) instance = new KpiService();
  return instance;
}
