// app/server/services/usageRollupService.ts
// Turns mirrored usage events (usage-analytics Phase 2b) into the dimensioned daily
// time series Phase 4 renders (usage-analytics Phase 3). One rollup run computes, for
// a UTC day, the activity / wizard-funnel / feature-adoption / retention metrics and
// writes them to `UsageMetricDaily` via UPSERT on the compound key (a re-run is
// idempotent and self-heals a partial failure — a DELIBERATE divergence from
// kpiService.ts's append-only createMany). Headline scalars (WAU/MAU/events-per-day)
// are ALSO appended to `KpiSnapshot` under `usage.*` names so existing tiles work.
//
// Reads the CP-OWNED mirror table via Prisma findMany (never raw SQL, never the app
// primary) and aggregates in memory. Bounded: the mirror starts at Phase-2 go-live and
// is retention-pruned, and each run reads only a single day (or a trailing window keyed
// by the mirror's `(appKey, occurredAt)` index). Dashboards never touch raw events.
//
// Testable without BullMQ or a real DB: the DB surface is narrow + DI'd (FakeDb in
// tests), following the usageIngestService / growthMetricsService pattern.

import { getDb } from "../db.js";
import { captureError } from "~/lib/observability.js";
import { getConfig } from "~/lib/config.js";
import { runUsageAlertEval } from "./usageAlertService.js";
import {
  UsageMetric,
  KPI_USAGE_METRICS,
  Ev,
  WIZARD_STEP_STAGES,
  FEATURE_EVENT_NAMES,
  MARKETS_SYNC_SETTING_KEY,
  NOT_IMPERSONATED,
  median,
  utcDayStart,
  utcDayEnd,
  isoWeekStart,
  weekOffset,
  type FunnelStage,
} from "~/lib/usageMetrics.js";

/** A mirrored usage-event row, as this service reads it (subset of `UsageEvent`). */
interface MirrorRow {
  readonly shopDomain: string;
  readonly name: string;
  readonly properties: unknown;
  readonly occurredAt: Date;
}

/** One computed metric row destined for `UsageMetricDaily` (date filled by the writer). */
interface MetricPoint {
  readonly metric: string;
  readonly dimension: string;
  readonly value: number;
}

/** Narrow DB surface — kept small so FakeDb satisfies it (mirrors IngestDb's style). */
export interface RollupDb {
  usageEvent: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, "asc" | "desc">;
    }): Promise<MirrorRow[]>;
  };
  usageMetricDaily: {
    upsert(args: {
      where: { appKey_date_metric_dimension: { appKey: string; date: Date; metric: string; dimension: string } };
      create: { appKey: string; date: Date; metric: string; dimension: string; value: number };
      update: { value: number };
    }): Promise<unknown>;
  };
  kpiSnapshot: {
    createMany(args: { data: readonly Record<string, unknown>[] }): Promise<{ count: number }>;
  };
}

export interface UsageRollupResult {
  readonly day: string; // ISO date (UTC day)
  readonly metricRows: number; // UsageMetricDaily rows upserted
  readonly kpiRows: number; // KpiSnapshot rows appended
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class UsageRollupService {
  constructor(private readonly db: RollupDb = getDb() as unknown as RollupDb) {}

  /**
   * Recompute one UTC day fully and idempotently. Every metric derives from the
   * mirror with impersonation excluded at the query boundary. Used by the hourly
   * incremental (day = today) and the daily finalize (day = yesterday).
   */
  async rollupDay(appKey: string, day: Date): Promise<UsageRollupResult> {
    const dayStart = utcDayStart(day);
    const dayEnd = utcDayEnd(day);

    // Single-day slice (for DAU, events, per-action counts, funnel).
    const dayRows = await this.readWindow(appKey, dayStart, dayEnd);
    // Trailing windows (inclusive of `day`) for WAU/MAU + adoption. Read once, widest.
    const window90Start = new Date(dayEnd.getTime() - 90 * DAY_MS);
    const windowRows = await this.readWindow(appKey, window90Start, dayEnd);

    const points: MetricPoint[] = [
      ...this.activityMetrics(dayRows, windowRows, dayEnd),
      ...this.funnelMetrics(dayRows),
      ...this.adoptionMetrics(windowRows, dayEnd),
      // Median step dwell (usage.funnel.dwell, dimension = step) from `wizard_step_saved`
      // events carrying a numeric `properties.durationMs` (Badgy's Phase-5 dwell beacon).
      // Rows without a duration are ignored, never faked (spec: dwell present ⇒ metric,
      // absent ⇒ skipped).
      ...this.dwellMetrics(dayRows),
    ];

    const metricRows = await this.writeMetrics(appKey, dayStart, points);
    const kpiRows = await this.appendHeadlineKpis(appKey, dayEnd, points);

    return { day: dayStart.toISOString().slice(0, 10), metricRows, kpiRows };
  }

  /**
   * Recompute a full retention matrix for the install cohorts whose week-0 falls in
   * the trailing `USAGE_RETENTION_MAX_WEEKS`. Written on the same cadence as the daily
   * finalize (cohort membership + activity are both derived from the mirror). Rows are
   * keyed by `date` = the cohort's week-0 Monday, dimension `cohortWeek:weekN`.
   */
  async rollupRetention(appKey: string, now: Date): Promise<number> {
    const maxWeeks = getConfig().USAGE_RETENTION_MAX_WEEKS;
    const thisWeek0 = isoWeekStart(now);
    const earliestWeek0 = new Date(thisWeek0.getTime() - (maxWeeks - 1) * 7 * DAY_MS);

    // Installs within the cohort span → cohort membership by week-0.
    const installs = await this.readByName(appKey, Ev.APP_INSTALLED, earliestWeek0, utcDayEnd(now));
    const cohortShops = new Map<number, Set<string>>(); // week0-epoch → shops
    const firstInstall = new Map<string, Date>();
    for (const r of installs) {
      if (!firstInstall.has(r.shopDomain) || r.occurredAt < firstInstall.get(r.shopDomain)!) {
        firstInstall.set(r.shopDomain, r.occurredAt);
      }
    }
    for (const [shop, at] of firstInstall) {
      const wk0 = isoWeekStart(at).getTime();
      (cohortShops.get(wk0) ?? cohortShops.set(wk0, new Set()).get(wk0)!).add(shop);
    }

    // All activity across the span → who was active in which absolute week.
    const activity = await this.readWindow(appKey, earliestWeek0, utcDayEnd(now));
    let written = 0;
    for (const [wk0Epoch, shops] of cohortShops) {
      const wk0 = new Date(wk0Epoch);
      // Cohort size (dimension "") anchored on the cohort's own week-0.
      await this.upsert(appKey, wk0, UsageMetric.RETENTION_COHORT_SIZE, "", shops.size);
      written += 1;
      const maxN = weekOffset(wk0, now); // furthest observable offset for this cohort
      for (let n = 0; n <= maxN && n < maxWeeks; n += 1) {
        const weekStart = new Date(wk0.getTime() + n * 7 * DAY_MS);
        const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);
        const activeThisWeek = new Set<string>();
        for (const r of activity) {
          if (
            shops.has(r.shopDomain) &&
            r.occurredAt >= weekStart &&
            r.occurredAt < weekEnd
          ) {
            activeThisWeek.add(r.shopDomain);
          }
        }
        await this.upsert(appKey, wk0, UsageMetric.RETENTION_COHORT, `cohortWeek:week${n}`, activeThisWeek.size);
        written += 1;
      }
    }
    return written;
  }

  // ── metric families (pure over the rows they're given) ─────────────────────

  private activityMetrics(dayRows: readonly MirrorRow[], windowRows: readonly MirrorRow[], dayEnd: Date): MetricPoint[] {
    const out: MetricPoint[] = [];
    // DAU: distinct shops active on the day.
    out.push({ metric: UsageMetric.DAU, dimension: "", value: distinctShops(dayRows) });
    // Total events on the day.
    out.push({ metric: UsageMetric.EVENTS_TOTAL, dimension: "", value: dayRows.length });
    // Per-event-name action counts (dimension = event name).
    const byName = new Map<string, number>();
    for (const r of dayRows) byName.set(r.name, (byName.get(r.name) ?? 0) + 1);
    for (const [name, count] of byName) {
      out.push({ metric: UsageMetric.ACTION_COUNT, dimension: name, value: count });
    }
    // WAU / MAU: distinct shops in the trailing 7 / 30 days (inclusive of the day).
    const wauStart = new Date(dayEnd.getTime() - 7 * DAY_MS);
    const mauStart = new Date(dayEnd.getTime() - 30 * DAY_MS);
    out.push({ metric: UsageMetric.WAU, dimension: "", value: distinctShops(windowRows.filter((r) => r.occurredAt >= wauStart)) });
    out.push({ metric: UsageMetric.MAU, dimension: "", value: distinctShops(windowRows.filter((r) => r.occurredAt >= mauStart)) });
    return out;
  }

  private funnelMetrics(dayRows: readonly MirrorRow[]): MetricPoint[] {
    const out: MetricPoint[] = [];
    // Distinct shops reaching each stage on the day. A shop counts ONCE per stage/day
    // even if it saved the same step several times (spec's funnel-stage scenario).
    const stageShops = new Map<FunnelStage, Set<string>>();
    const reach = (stage: FunnelStage, shop: string): void => {
      (stageShops.get(stage) ?? stageShops.set(stage, new Set()).get(stage)!).add(shop);
    };
    const ruleCounts = new Map<string, number>();
    for (const r of dayRows) {
      if (r.name === Ev.WIZARD_STARTED) reach("started", r.shopDomain);
      else if (r.name === Ev.WIZARD_COMPLETED) reach("completed", r.shopDomain);
      else if (r.name === Ev.WIZARD_STEP_SAVED) {
        const step = readStringProp(r.properties, "step");
        if (step && (WIZARD_STEP_STAGES as readonly string[]).includes(step)) {
          reach(step as FunnelStage, r.shopDomain);
        }
      } else if (r.name === Ev.WIZARD_VALIDATION_FAILED) {
        for (const rule of readStringArrayProp(r.properties, "rules")) {
          ruleCounts.set(rule, (ruleCounts.get(rule) ?? 0) + 1);
        }
      }
    }
    for (const [stage, shops] of stageShops) {
      out.push({ metric: UsageMetric.FUNNEL_STAGE, dimension: stage, value: shops.size });
    }
    // Top validation-failure rules for the day (cap from config).
    const top = [...ruleCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, getConfig().USAGE_FUNNEL_TOP_RULES);
    for (const [rule, count] of top) {
      out.push({ metric: UsageMetric.FUNNEL_VALIDATION_RULE, dimension: rule, value: count });
    }
    return out;
  }

  /**
   * Median (p50) step dwell in ms per wizard step (dimension = step). Only
   * `wizard_step_saved` events with a numeric `properties.durationMs` contribute; a
   * step whose saves ALL lack a duration produces NO row (honest gap, not a faked 0).
   * A step with a mix computes the median over only the durations present. Impersonation
   * is already excluded at the query boundary (readWindow), same as every other metric.
   */
  private dwellMetrics(dayRows: readonly MirrorRow[]): MetricPoint[] {
    const byStep = new Map<string, number[]>();
    for (const r of dayRows) {
      if (r.name !== Ev.WIZARD_STEP_SAVED) continue;
      const step = readStringProp(r.properties, "step");
      if (!step || !(WIZARD_STEP_STAGES as readonly string[]).includes(step)) continue;
      const dur = readNumberProp(r.properties, "durationMs");
      if (dur === null) continue; // best-effort beacon: absent ⇒ skip this sample
      (byStep.get(step) ?? byStep.set(step, []).get(step)!).push(dur);
    }
    const out: MetricPoint[] = [];
    for (const [step, durations] of byStep) {
      const p50 = median(durations);
      if (p50 === null) continue; // no usable samples for this step
      out.push({ metric: UsageMetric.FUNNEL_DWELL, dimension: step, value: p50 });
    }
    return out;
  }

  private adoptionMetrics(windowRows: readonly MirrorRow[], dayEnd: Date): MetricPoint[] {
    const out: MetricPoint[] = [];
    const d30Start = new Date(dayEnd.getTime() - 30 * DAY_MS);
    const rows30 = windowRows.filter((r) => r.occurredAt >= d30Start);
    const rows90 = windowRows; // window is already 90d

    // Numerators: distinct shops that touched each feature within the window.
    for (const [feature, names] of Object.entries(FEATURE_EVENT_NAMES)) {
      const nameSet = new Set(names);
      out.push({ metric: UsageMetric.ADOPTION_D30, dimension: feature, value: distinctShops(rows30.filter((r) => nameSet.has(r.name))) });
      out.push({ metric: UsageMetric.ADOPTION_D90, dimension: feature, value: distinctShops(rows90.filter((r) => nameSet.has(r.name))) });
    }
    // markets_sync is settings-driven (setting_saved + properties.key === "markets_sync").
    const isMarkets = (r: MirrorRow): boolean =>
      r.name === Ev.SETTING_SAVED && readStringProp(r.properties, "key") === MARKETS_SYNC_SETTING_KEY;
    out.push({ metric: UsageMetric.ADOPTION_D30, dimension: "markets_sync", value: distinctShops(rows30.filter(isMarkets)) });
    out.push({ metric: UsageMetric.ADOPTION_D90, dimension: "markets_sync", value: distinctShops(rows90.filter(isMarkets)) });

    // Denominators: distinct active shops in the same windows (so Phase 4 can divide).
    out.push({ metric: UsageMetric.ACTIVE_SHOPS_D30, dimension: "", value: distinctShops(rows30) });
    out.push({ metric: UsageMetric.ACTIVE_SHOPS_D90, dimension: "", value: distinctShops(rows90) });
    return out;
  }

  // ── writers ────────────────────────────────────────────────────────────────

  /** Upsert every point on the compound key so a re-run overwrites in place. */
  private async writeMetrics(appKey: string, date: Date, points: readonly MetricPoint[]): Promise<number> {
    for (const p of points) await this.upsert(appKey, date, p.metric, p.dimension, p.value);
    return points.length;
  }

  private async upsert(appKey: string, date: Date, metric: string, dimension: string, value: number): Promise<void> {
    await this.db.usageMetricDaily.upsert({
      where: { appKey_date_metric_dimension: { appKey, date, metric, dimension } },
      create: { appKey, date, metric, dimension, value },
      update: { value },
    });
  }

  /**
   * Append the headline scalars to `KpiSnapshot` under `usage.*` names via the shipped
   * append-only path, so existing dashboard tiles pick them up unchanged. `asOf` is
   * the day's end (the point the numbers describe).
   */
  private async appendHeadlineKpis(appKey: string, asOf: Date, points: readonly MetricPoint[]): Promise<number> {
    const scalar = (metric: string): number =>
      points.find((p) => p.metric === metric && p.dimension === "")?.value ?? 0;
    const rows = [
      { appKey, metric: KPI_USAGE_METRICS.WAU, value: scalar(UsageMetric.WAU), asOf },
      { appKey, metric: KPI_USAGE_METRICS.MAU, value: scalar(UsageMetric.MAU), asOf },
      { appKey, metric: KPI_USAGE_METRICS.EVENTS_PER_DAY, value: scalar(UsageMetric.EVENTS_TOTAL), asOf },
    ];
    await this.db.kpiSnapshot.createMany({ data: rows });
    return rows.length;
  }

  // ── mirror reads (impersonation excluded at the boundary) ───────────────────

  private async readWindow(appKey: string, startInclusive: Date, endExclusive: Date): Promise<MirrorRow[]> {
    return this.db.usageEvent.findMany({
      where: {
        appKey,
        ...NOT_IMPERSONATED,
        occurredAt: { gte: startInclusive, lt: endExclusive },
      },
      orderBy: { occurredAt: "asc" },
    });
  }

  private async readByName(appKey: string, name: string, startInclusive: Date, endExclusive: Date): Promise<MirrorRow[]> {
    return this.db.usageEvent.findMany({
      where: {
        appKey,
        name,
        ...NOT_IMPERSONATED,
        occurredAt: { gte: startInclusive, lt: endExclusive },
      },
      orderBy: { occurredAt: "asc" },
    });
  }
}

// ── small pure helpers ─────────────────────────────────────────────────────

function distinctShops(rows: readonly MirrorRow[]): number {
  const s = new Set<string>();
  for (const r of rows) s.add(r.shopDomain);
  return s.size;
}

function readStringProp(properties: unknown, key: string): string | null {
  if (properties && typeof properties === "object" && key in properties) {
    const v = (properties as Record<string, unknown>)[key];
    return typeof v === "string" ? v : null;
  }
  return null;
}

/** Read a FINITE numeric property (the dwell beacon's `durationMs`), else null. */
function readNumberProp(properties: unknown, key: string): number | null {
  if (properties && typeof properties === "object" && key in properties) {
    const v = (properties as Record<string, unknown>)[key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return null;
}

function readStringArrayProp(properties: unknown, key: string): string[] {
  if (properties && typeof properties === "object" && key in properties) {
    const v = (properties as Record<string, unknown>)[key];
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  }
  return [];
}

let instance: UsageRollupService | null = null;
export function getUsageRollupService(): UsageRollupService {
  if (instance === null) instance = new UsageRollupService();
  return instance;
}

/** Test seam. */
export function __setUsageRollupService(fake: UsageRollupService | null): void {
  instance = fake;
}

/**
 * Backfill entry point: recompute an inclusive [from, to] UTC-day range (and the
 * retention matrix once at the end). Used on deploy to seed history over the mirror,
 * and to correct any day on demand. Bounded by the mirror's retention window.
 */
export async function runUsageRollupBackfill(appKey: string, from: Date, to: Date): Promise<number> {
  const svc = getUsageRollupService();
  let days = 0;
  for (let d = utcDayStart(from); d <= utcDayStart(to); d = new Date(d.getTime() + DAY_MS)) {
    await svc.rollupDay(appKey, d);
    days += 1;
  }
  await svc.rollupRetention(appKey, to);
  return days;
}

/** Worker call site for the hourly incremental (today) — wraps errors for retry. */
export async function runUsageRollupIncremental(appKey: string, now: Date = new Date()): Promise<void> {
  try {
    await getUsageRollupService().rollupDay(appKey, now);
  } catch (err) {
    captureError(err, { job: "usage-rollup-incremental", appKey });
    throw err;
  }
}

/**
 * Worker call site for the daily finalize: recompute YESTERDAY fully (correcting for
 * ingestion lag) + refresh the retention matrix, THEN evaluate usage alert rules against
 * the just-finalized numbers (cp usage-alerts-digest, P5). Chaining the alert eval here
 * — rather than on an independent schedule — is what guarantees alerts fire on FINALIZED
 * daily numbers, never provisional intraday ones (the incremental job is deliberately
 * NOT wired to alerts). Alert-eval failure is caught and logged, NOT rethrown, so a
 * transient delivery hiccup can't roll back a good finalize; the standalone alert-eval
 * safety-net job (USAGE_ALERT_EVAL_CRON, ~15 min later) retries it under BullMQ.
 */
export async function runUsageRollupFinalize(appKey: string, now: Date = new Date()): Promise<void> {
  try {
    const yesterday = new Date(utcDayStart(now).getTime() - DAY_MS);
    const svc = getUsageRollupService();
    await svc.rollupDay(appKey, yesterday);
    await svc.rollupRetention(appKey, now);
  } catch (err) {
    captureError(err, { job: "usage-rollup-finalize", appKey });
    throw err;
  }
  // Post-finalization alert evaluation. Isolated so it never fails the finalize.
  try {
    await runUsageAlertEval(appKey, now);
  } catch (err) {
    captureError(err, { job: "usage-alert-eval", phase: "post-finalize", appKey });
  }
}
