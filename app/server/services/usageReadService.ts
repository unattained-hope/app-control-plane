// app/server/services/usageReadService.ts
// The Phase-4 dashboard READ layer (usage-analytics). Turns the pre-aggregated rows
// Phase 3 writes — `UsageMetricDaily` (dimensioned daily series), `KpiSnapshot`
// (`usage.*` headline scalars), and `UsageCohortSnapshot` (per-shop cohort labels) —
// into server-shaped payloads the dumb chart components render. It also serves the
// ONE bounded, cursor-paginated raw-event read: the per-merchant Activity feed, from
// the control plane's OWN mirror table (`UsageEvent`).
//
// ARCHITECTURE INVARIANT (AGENTS.md §6 "Dashboard from rollups"): every CHART reads
// snapshot rows only — never raw events aggregated at request time. The activity feed
// is the explicit, documented exception (design.md Decision 2): it is a hard-capped,
// cursor-paginated page from our own mirror, a shape unsuited to charting, so it does
// not erode the invariant. See `activityFeed` below.
//
// Mirrors the KpiService / MerchantHealthService read-service shape: a thin, typed
// class over a narrow DI'd DB surface (FakeDb drives the unit tests), returning plain
// serializable payloads. Metric NAMES come exclusively from `app/lib/usageMetrics.ts`
// (`UsageMetric` / `KPI_USAGE_METRICS`) — no metric string is invented here.

import { getDb } from "../db.js";
import { getConfig } from "~/lib/config.js";
import {
  UsageMetric,
  KPI_USAGE_METRICS,
  FUNNEL_STAGES,
  ADOPTION_FEATURES,
  utcDayStart,
  type FunnelStage,
} from "~/lib/usageMetrics.js";

// ── Row shapes as this service reads them (subsets of the Prisma models) ──────

/** A dimensioned daily metric row (subset of `UsageMetricDaily`). */
interface MetricRow {
  readonly date: Date;
  readonly metric: string;
  readonly dimension: string;
  readonly value: number;
  readonly updatedAt: Date;
}

/** A per-shop cohort snapshot row (subset of `UsageCohortSnapshot`). */
interface CohortRow {
  readonly shop: string;
  readonly lifecycle: string;
  readonly intensity: string;
  readonly personaTags: readonly string[];
  readonly activityScore: number;
  readonly computedAt: Date;
}

/** A KPI snapshot row (subset of `KpiSnapshot`). */
interface KpiRow {
  readonly metric: string;
  readonly value: number;
  readonly asOf: Date;
}

/** A mirrored usage event as the activity feed reads it (subset of `UsageEvent`). */
interface EventRow {
  readonly id: string;
  readonly sourceSeq: bigint;
  readonly name: string;
  readonly category: string;
  readonly source: string;
  readonly properties: unknown;
  readonly impersonated: boolean;
  readonly occurredAt: Date;
}

/** Narrow DB surface — small enough that FakeDb satisfies it in tests. */
export interface UsageReadDb {
  usageMetricDaily: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, "asc" | "desc">;
    }): Promise<MetricRow[]>;
  };
  usageCohortSnapshot: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, "asc" | "desc">;
    }): Promise<CohortRow[]>;
  };
  kpiSnapshot: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, "asc" | "desc">;
    }): Promise<KpiRow[]>;
  };
  usageEvent: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, "asc" | "desc">;
      take?: number;
    }): Promise<EventRow[]>;
  };
}

// ── Payload types (server-shaped so chart components stay dumb) ───────────────

/** A single (date, value) point for a time-series chart; `provisional` = today (UTC). */
export interface SeriesPoint {
  readonly date: string; // ISO date (YYYY-MM-DD)
  readonly value: number;
  readonly provisional: boolean;
}

/** A named ranked datum for BarLists / mixes. */
export interface RankedDatum {
  readonly name: string;
  readonly value: number;
}

/** A stat tile: a value that may be absent (no snapshot yet) or deferred (not collected). */
export interface StatTile {
  readonly key: string;
  readonly value: number | null;
  /** `true` when the metric is intentionally not produced yet (rendered "coming soon"). */
  readonly deferred?: boolean;
}

export interface OverviewPayload {
  readonly asOf: string | null; // last rollup write; null when no data yet
  readonly collectingSince: string | null; // earliest metric date; drives empty-state copy
  readonly tiles: readonly StatTile[];
  readonly activeShops: readonly SeriesPoint[]; // WAU series, ≥12 weeks where available
  readonly topActions: readonly RankedDatum[];
  readonly activationFunnel: readonly RankedDatum[]; // lifecycle-derived stages
}

export interface FeatureAdoptionRow {
  readonly feature: string;
  readonly shops: number; // distinct shops using the feature in the window
  readonly activeShops: number; // denominator (distinct active shops, same window)
  readonly pct: number; // shops / activeShops (0 when denominator is 0)
}

export interface FeaturesPayload {
  readonly asOf: string | null;
  readonly collectingSince: string | null;
  readonly adoption30: readonly FeatureAdoptionRow[];
  readonly adoption90: readonly FeatureAdoptionRow[];
  /** Per-feature D30 adoption-shop trend (one series per feature), for the trend lines. */
  readonly featureTrends: readonly { readonly feature: string; readonly points: readonly SeriesPoint[] }[];
  readonly discountTypeMix: readonly RankedDatum[];
  readonly campaignTypeMix: readonly RankedDatum[];
}

export interface FunnelStageDatum {
  readonly stage: FunnelStage;
  readonly shops: number;
  /** Conversion from the FIRST stage (`started`), 0–1; 1 for the first stage. */
  readonly conversionFromStart: number;
  /** Step-over-step conversion from the PREVIOUS stage, 0–1; 1 for the first stage. */
  readonly conversionFromPrev: number;
}

/** Median step dwell for one wizard step (from `usage.funnel.dwell`, newest day). */
export interface StepDwellDatum {
  readonly stage: FunnelStage;
  /** Median (p50) dwell in MILLISECONDS. */
  readonly medianMs: number;
}

export interface FunnelPayload {
  readonly asOf: string | null;
  readonly collectingSince: string | null;
  readonly stages: readonly FunnelStageDatum[];
  readonly topValidationRules: readonly RankedDatum[];
  /**
   * Median step dwell per wizard step (Phase-5 dwell beacon → `usage.funnel.dwell`).
   * Empty when no step has usable duration data yet (early history) — the UI then shows
   * the shared empty-state, never the old "coming soon" copy. Steps are in funnel order.
   */
  readonly stepDwell: readonly StepDwellDatum[];
}

export interface ShopAggregateRow {
  readonly shop: string;
  readonly lifecycle: string;
  readonly intensity: string;
  readonly personaTags: readonly string[];
  readonly activityScore: number; // 30-day weighted score (a scatter axis)
  readonly campaignsActivated: number; // reserved; 0 until a dedicated metric exists
  readonly tenureDays: number | null; // null until an install signal is available
  readonly computedAt: string;
}

export interface ShopsPayload {
  readonly asOf: string | null;
  readonly collectingSince: string | null;
  readonly shops: readonly ShopAggregateRow[];
}

export interface ActivityEvent {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly source: string;
  readonly properties: Record<string, unknown> | null;
  readonly impersonated: boolean;
  readonly occurredAt: string; // ISO
  readonly cursor: string; // opaque cursor (the source seq) for paging backwards
}

export interface ActivityPage {
  readonly events: readonly ActivityEvent[];
  /** Cursor to pass as `before` for the next (older) page; null when exhausted. */
  readonly nextCursor: string | null;
}

// Overview activation-funnel stages, derived from the latest cohort snapshot's
// lifecycle distribution. Phase 3 does NOT emit the literal
// installed→theme-embed→wizard→1st-campaign→2nd-campaign event funnel (there is no
// "theme embed enabled" event), so the honest pre-aggregated proxy is the lifecycle
// ladder: every known shop is "installed"; activation/engagement are cohort labels.
const ACTIVATION_LADDER: ReadonlyArray<{ readonly label: string; readonly lifecycles: readonly string[] }> = [
  { label: "Installed", lifecycles: ["NEW", "ONBOARDING", "ACTIVATED", "ENGAGED", "DORMANT"] },
  { label: "Onboarding+", lifecycles: ["ONBOARDING", "ACTIVATED", "ENGAGED"] },
  { label: "Activated", lifecycles: ["ACTIVATED", "ENGAGED"] },
  { label: "Engaged", lifecycles: ["ENGAGED"] },
];

export class UsageReadService {
  constructor(private readonly db: UsageReadDb = getDb() as unknown as UsageReadDb) {}

  /**
   * The freshness stamp shared by every view: the most recent `UsageMetricDaily`
   * write for the app (the last rollup run). Null when nothing has been rolled up.
   * This is the "as of" the house rule requires on every page.
   */
  async latestAsOf(appKey: string): Promise<string | null> {
    const rows = await this.db.usageMetricDaily.findMany({
      where: { appKey },
      orderBy: { updatedAt: "desc" },
    });
    return rows.length > 0 ? rows[0]!.updatedAt.toISOString() : null;
  }

  // ── Overview (`/usage`) ─────────────────────────────────────────────────────

  async overview(appKey: string, now: Date = new Date()): Promise<OverviewPayload> {
    const [metrics, kpis, cohorts] = await Promise.all([
      this.readMetrics(appKey),
      this.readKpis(appKey),
      this.latestCohortRows(appKey),
    ]);
    const asOf = maxUpdatedAt(metrics);
    const collectingSince = minDate(metrics);
    const todayKey = dateKey(utcDayStart(now));

    // Headline scalars from KpiSnapshot (latest per metric).
    const latestKpi = latestByMetric(kpis);
    const wau = latestKpi.get(KPI_USAGE_METRICS.WAU)?.value ?? null;
    const mau = latestKpi.get(KPI_USAGE_METRICS.MAU)?.value ?? null;
    const eventsPerDay = latestKpi.get(KPI_USAGE_METRICS.EVENTS_PER_DAY)?.value ?? null;

    // Stickiness = DAU/MAU, from the latest UsageMetricDaily DAU + MAU on the newest day.
    const dau = latestScalar(metrics, UsageMetric.DAU);
    const mauMetric = latestScalar(metrics, UsageMetric.MAU);
    const stickiness = dau != null && mauMetric != null && mauMetric > 0 ? dau / mauMetric : null;

    const tiles: StatTile[] = [
      { key: "wau", value: wau },
      { key: "mau", value: mau },
      { key: "stickiness", value: stickiness },
      { key: "eventsPerDay", value: eventsPerDay },
      // Median time-to-first-campaign is not produced as a rollup metric in Phase 3
      // (no time-to-value metric emitted). Surface it as an explicit "coming soon"
      // tile rather than fabricate — same honesty rule as the deferred wizard dwell.
      { key: "medianTimeToFirstCampaign", value: null, deferred: true },
    ];

    // Active-shops trend = the WAU daily series (≥12 weeks where data exists).
    const activeShops = this.series(metrics, UsageMetric.WAU, "", todayKey);

    // Top actions = the newest day's per-event-name counts, ranked.
    const topActions = this.latestDimensioned(metrics, UsageMetric.ACTION_COUNT);

    // Activation funnel from the latest cohort lifecycle distribution (see ladder note).
    const lifecycleCounts = countBy(cohorts, (c) => c.lifecycle);
    const activationFunnel = ACTIVATION_LADDER.map((stage) => ({
      name: stage.label,
      value: stage.lifecycles.reduce((sum, lc) => sum + (lifecycleCounts.get(lc) ?? 0), 0),
    }));

    return { asOf, collectingSince, tiles, activeShops, topActions, activationFunnel };
  }

  // ── Feature adoption (`/usage/features`) ────────────────────────────────────

  async features(appKey: string, now: Date = new Date()): Promise<FeaturesPayload> {
    const metrics = await this.readMetrics(appKey);
    const asOf = maxUpdatedAt(metrics);
    const collectingSince = minDate(metrics);
    const todayKey = dateKey(utcDayStart(now));

    const adoption30 = this.adoptionRows(
      metrics,
      UsageMetric.ADOPTION_D30,
      UsageMetric.ACTIVE_SHOPS_D30,
    );
    const adoption90 = this.adoptionRows(
      metrics,
      UsageMetric.ADOPTION_D90,
      UsageMetric.ACTIVE_SHOPS_D90,
    );

    // Per-feature D30 adoption-shop trend (one series per feature).
    const featureTrends = ADOPTION_FEATURES.map((feature) => ({
      feature,
      points: this.series(metrics, UsageMetric.ADOPTION_D30, feature, todayKey),
    }));

    // Discount-type / campaign-type mix among activated campaigns. Phase 3 does not
    // (yet) split `campaign_activated` by discount/campaign type into its own metric,
    // so these mixes are empty until such a dimensioned metric lands — the DonutChart
    // renders its own "collecting data" empty state, never a broken/faked slice.
    const discountTypeMix = this.latestDimensioned(metrics, "usage.mix.discount_type");
    const campaignTypeMix = this.latestDimensioned(metrics, "usage.mix.campaign_type");

    return {
      asOf,
      collectingSince,
      adoption30,
      adoption90,
      featureTrends,
      discountTypeMix,
      campaignTypeMix,
    };
  }

  // ── Wizard funnel (`/usage/funnel`) ─────────────────────────────────────────

  async funnel(appKey: string): Promise<FunnelPayload> {
    const metrics = await this.readMetrics(appKey);
    const asOf = maxUpdatedAt(metrics);
    const collectingSince = minDate(metrics);

    // Sum each stage over the whole observed range (distinct-shops-per-day summed gives
    // total reaches; conversion is computed on those totals). Reading the aggregate this
    // way keeps the leak visible without a per-day slice picker in v1.
    const stageTotals = new Map<string, number>();
    for (const r of metrics) {
      if (r.metric === UsageMetric.FUNNEL_STAGE) {
        stageTotals.set(r.dimension, (stageTotals.get(r.dimension) ?? 0) + r.value);
      }
    }
    const startedTotal = stageTotals.get("started") ?? 0;
    let prev = startedTotal;
    const stages: FunnelStageDatum[] = FUNNEL_STAGES.map((stage, i) => {
      const shops = stageTotals.get(stage) ?? 0;
      const conversionFromStart = startedTotal > 0 ? shops / startedTotal : i === 0 ? 1 : 0;
      const conversionFromPrev = i === 0 ? 1 : prev > 0 ? shops / prev : 0;
      prev = shops;
      return { stage, shops, conversionFromStart, conversionFromPrev };
    });

    // Top validation-failure rules, summed over the range and re-ranked.
    const ruleTotals = new Map<string, number>();
    for (const r of metrics) {
      if (r.metric === UsageMetric.FUNNEL_VALIDATION_RULE) {
        ruleTotals.set(r.dimension, (ruleTotals.get(r.dimension) ?? 0) + r.value);
      }
    }
    const topValidationRules = rank(ruleTotals);

    // Median step dwell (Phase-5 beacon): a median is NOT summable, so take the NEWEST
    // day's value per step (same "latest per dimension" reduction the mixes use). Steps
    // are ordered along the funnel; steps with no dwell row are simply omitted.
    const dwellByStep = latestDimensionValues(metrics, UsageMetric.FUNNEL_DWELL);
    const stepDwell: StepDwellDatum[] = FUNNEL_STAGES.filter(
      (stage) => dwellByStep.has(stage),
    ).map((stage) => ({ stage, medianMs: dwellByStep.get(stage)! }));

    return { asOf, collectingSince, stages, topValidationRules, stepDwell };
  }

  // ── Shop explorer (`/usage/shops`) ──────────────────────────────────────────

  async shops(appKey: string): Promise<ShopsPayload> {
    const [cohorts, asOf] = await Promise.all([
      this.latestCohortRows(appKey),
      this.latestAsOf(appKey),
    ]);
    const collectingSince = cohorts.length > 0 ? minBy(cohorts, (c) => c.computedAt).toISOString() : null;
    const shops: ShopAggregateRow[] = cohorts.map((c) => ({
      shop: c.shop,
      lifecycle: c.lifecycle,
      intensity: c.intensity,
      personaTags: c.personaTags,
      activityScore: c.activityScore,
      // These two require signals not carried on the cohort snapshot (install date /
      // per-shop activation count). Reserved as scatter axes; null/0 keeps the payload
      // stable so the axis picker can offer them once the snapshot carries them.
      campaignsActivated: 0,
      tenureDays: null,
      computedAt: c.computedAt.toISOString(),
    }));
    return { asOf, collectingSince, shops };
  }

  // ── Activity feed (`merchant-detail` → Activity tab) ────────────────────────
  //
  // THE ONE PERMITTED RAW-EVENT READ. Cursor-paginated (newest first), HARD-capped at
  // `USAGE_ACTIVITY_FEED_MAX_PAGE_SIZE`, scoped to a single shop, from the CP's OWN
  // mirror table. This is NOT a chart source and is deliberately shaped so it can't be
  // used as one (design.md Decision 2; AGENTS.md dashboard-from-rollups invariant).
  // Impersonated events are INCLUDED here (support context) and flagged, unlike every
  // metric, which excludes them.

  async activityFeed(
    appKey: string,
    shop: string,
    opts: { readonly limit?: number; readonly before?: string | null } = {},
  ): Promise<ActivityPage> {
    const cap = getConfig().USAGE_ACTIVITY_FEED_MAX_PAGE_SIZE;
    const requested = opts.limit ?? cap;
    // Enforce the hard cap: a caller may ask for fewer, never more.
    const limit = Math.max(1, Math.min(requested, cap));

    const where: Record<string, unknown> = { appKey, shopDomain: shop };
    const beforeSeq = parseCursor(opts.before);
    if (beforeSeq !== null) {
      // Page backwards through the source's monotonic seq (stable, unlike occurredAt).
      where.sourceSeq = { lt: beforeSeq };
    }

    // Fetch one extra to know whether an older page exists.
    const rows = await this.db.usageEvent.findMany({
      where,
      orderBy: { sourceSeq: "desc" },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const events: ActivityEvent[] = page.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      source: r.source,
      properties: isRecord(r.properties) ? r.properties : null,
      impersonated: r.impersonated,
      occurredAt: r.occurredAt.toISOString(),
      cursor: r.sourceSeq.toString(),
    }));
    const nextCursor = hasMore && events.length > 0 ? events[events.length - 1]!.cursor : null;
    return { events, nextCursor };
  }

  // ── shared reads ────────────────────────────────────────────────────────────

  private readMetrics(appKey: string): Promise<MetricRow[]> {
    return this.db.usageMetricDaily.findMany({
      where: { appKey },
      orderBy: { date: "asc" },
    });
  }

  private readKpis(appKey: string): Promise<KpiRow[]> {
    return this.db.kpiSnapshot.findMany({
      where: {
        appKey,
        metric: {
          in: [KPI_USAGE_METRICS.WAU, KPI_USAGE_METRICS.MAU, KPI_USAGE_METRICS.EVENTS_PER_DAY],
        },
      },
      orderBy: { asOf: "desc" },
    });
  }

  /** The latest cohort-snapshot run for the app (one row per shop from that run). */
  private async latestCohortRows(appKey: string): Promise<CohortRow[]> {
    const rows = await this.db.usageCohortSnapshot.findMany({
      where: { appKey },
      orderBy: { computedAt: "desc" },
    });
    if (rows.length === 0) return [];
    // The append-only snapshot family keeps every run; take only the newest run's rows.
    const newest = rows[0]!.computedAt.getTime();
    const seen = new Set<string>();
    const out: CohortRow[] = [];
    for (const r of rows) {
      if (r.computedAt.getTime() !== newest) break; // ordered desc → older runs follow
      if (seen.has(r.shop)) continue;
      seen.add(r.shop);
      out.push(r);
    }
    return out;
  }

  /** Build a dense daily series for one (metric, dimension), flagging today provisional. */
  private series(
    metrics: readonly MetricRow[],
    metric: string,
    dimension: string,
    todayKey: string,
  ): SeriesPoint[] {
    const points: SeriesPoint[] = [];
    for (const r of metrics) {
      if (r.metric !== metric || r.dimension !== dimension) continue;
      const key = dateKey(r.date);
      points.push({ date: key, value: r.value, provisional: key === todayKey });
    }
    return points;
  }

  /** Rank the newest day's rows for a dimensioned metric (top actions / mixes). */
  private latestDimensioned(metrics: readonly MetricRow[], metric: string): RankedDatum[] {
    let latest = -Infinity;
    for (const r of metrics) if (r.metric === metric) latest = Math.max(latest, r.date.getTime());
    if (latest === -Infinity) return [];
    const totals = new Map<string, number>();
    for (const r of metrics) {
      if (r.metric === metric && r.date.getTime() === latest && r.dimension !== "") {
        totals.set(r.dimension, (totals.get(r.dimension) ?? 0) + r.value);
      }
    }
    return rank(totals);
  }

  /** Feature adoption rows (numerator ÷ denominator) from the newest day of each metric. */
  private adoptionRows(
    metrics: readonly MetricRow[],
    numeratorMetric: string,
    denominatorMetric: string,
  ): FeatureAdoptionRow[] {
    const numerators = latestDimensionValues(metrics, numeratorMetric);
    const denominator = latestScalar(metrics, denominatorMetric) ?? 0;
    return ADOPTION_FEATURES.map((feature) => {
      const shops = numerators.get(feature) ?? 0;
      const pct = denominator > 0 ? shops / denominator : 0;
      return { feature, shops, activeShops: denominator, pct };
    });
  }
}

// ── pure helpers ─────────────────────────────────────────────────────────────

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function maxUpdatedAt(rows: readonly MetricRow[]): string | null {
  let max: Date | null = null;
  for (const r of rows) if (max === null || r.updatedAt > max) max = r.updatedAt;
  return max ? max.toISOString() : null;
}

function minDate(rows: readonly MetricRow[]): string | null {
  let min: Date | null = null;
  for (const r of rows) if (min === null || r.date < min) min = r.date;
  return min ? dateKey(min) : null;
}

/** Latest value of a scalar (dimension "") metric across the newest day it appears. */
function latestScalar(rows: readonly MetricRow[], metric: string): number | null {
  let best: MetricRow | null = null;
  for (const r of rows) {
    if (r.metric !== metric || r.dimension !== "") continue;
    if (best === null || r.date > best.date) best = r;
  }
  return best ? best.value : null;
}

/** Latest per-dimension values for a dimensioned metric (from its newest day). */
function latestDimensionValues(rows: readonly MetricRow[], metric: string): Map<string, number> {
  let latest = -Infinity;
  for (const r of rows) if (r.metric === metric) latest = Math.max(latest, r.date.getTime());
  const out = new Map<string, number>();
  if (latest === -Infinity) return out;
  for (const r of rows) {
    if (r.metric === metric && r.date.getTime() === latest && r.dimension !== "") {
      out.set(r.dimension, r.value);
    }
  }
  return out;
}

function latestByMetric(rows: readonly KpiRow[]): Map<string, KpiRow> {
  // rows arrive ordered by asOf desc → first seen per metric is the latest.
  const out = new Map<string, KpiRow>();
  for (const r of rows) if (!out.has(r.metric)) out.set(r.metric, r);
  return out;
}

function rank(totals: ReadonlyMap<string, number>): RankedDatum[] {
  return [...totals.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function countBy<T>(items: readonly T[], key: (t: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

function minBy<T>(items: readonly T[], pick: (t: T) => Date): Date {
  let min = pick(items[0]!);
  for (const it of items) {
    const v = pick(it);
    if (v < min) min = v;
  }
  return min;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Parse an opaque cursor (the source seq, as a decimal string) back to a bigint. */
function parseCursor(cursor: string | null | undefined): bigint | null {
  if (cursor === null || cursor === undefined || cursor === "") return null;
  if (!/^\d+$/.test(cursor)) return null;
  try {
    return BigInt(cursor);
  } catch {
    return null;
  }
}

let instance: UsageReadService | null = null;
export function getUsageReadService(): UsageReadService {
  if (instance === null) instance = new UsageReadService();
  return instance;
}

/** Test seam. */
export function __setUsageReadService(fake: UsageReadService | null): void {
  instance = fake;
}
