// app/server/services/usageDigestService.ts
// Weekly usage digest (cp usage-alerts-digest, usage-analytics Phase 5). A scheduled job
// composes the week's headline numbers — WAU/MAU + trend, the biggest funnel-stage
// movement, top and bottom feature-adoption movers, and notable cohort-transition counts
// — RENDERED FROM the pre-rolled metrics (`UsageMetricDaily` / `UsageCohortSnapshot`),
// NEVER recomputed from raw events. No new aggregation logic: it reads this-week-vs-last-
// week deltas of rows Phase 3 already wrote and formats a fixed short summary.
//
// Delivery reuses the existing notification path (Sentry→Slack via `captureError` with a
// `digest:` tag), the same seam the alerts use; recipients + schedule are config. It must
// render gracefully in the first weeks when last-week data is missing (deltas fall back to
// "n/a" rather than dividing by zero or fabricating movement).
//
// Testable without BullMQ or a real DB: the DB surface is narrow + DI'd (FakeDb in tests).

import { getDb } from "../db.js";
import { getConfig } from "~/lib/config.js";
import { captureError } from "~/lib/observability.js";
import {
  UsageMetric,
  ADOPTION_FEATURES,
  FUNNEL_STAGES,
  utcDayStart,
} from "~/lib/usageMetrics.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** A dimensioned daily metric row (subset of `UsageMetricDaily`). */
interface MetricRow {
  readonly date: Date;
  readonly metric: string;
  readonly dimension: string;
  readonly value: number;
}

/** A per-shop cohort snapshot row (subset of `UsageCohortSnapshot`). */
interface CohortRow {
  readonly shop: string;
  readonly lifecycle: string;
  readonly computedAt: Date;
}

/** Narrow DB surface — small enough that FakeDb satisfies it in tests. */
export interface DigestDb {
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
}

/** A this-week-vs-last-week movement for one named series. `null` last week ⇒ no delta. */
export interface DigestMover {
  readonly name: string;
  readonly thisWeek: number;
  readonly lastWeek: number | null;
  readonly delta: number | null;
}

/** The composed digest — a serializable payload the "send" step renders to text. */
export interface UsageDigest {
  readonly appKey: string;
  readonly weekStart: string; // ISO date (UTC) of this week's window start
  readonly weekEnd: string; // ISO date (UTC), exclusive
  /** True in the first weeks when there is no complete prior week to compare against. */
  readonly missingLastWeek: boolean;
  readonly wau: DigestMover;
  readonly mau: DigestMover;
  /** The single funnel stage with the largest week-over-week reach change. */
  readonly biggestFunnelMove: DigestMover | null;
  readonly topAdoptionMovers: readonly DigestMover[];
  readonly bottomAdoptionMovers: readonly DigestMover[];
  /** Count of shops entering each lifecycle this week vs last (e.g. DORMANT, CHURNED). */
  readonly cohortTransitions: readonly DigestMover[];
  /** The rendered plain-text body delivered to the channel. */
  readonly body: string;
}

/** Lifecycles whose weekly entry counts the digest highlights (notable transitions). */
const NOTABLE_LIFECYCLES = ["ENGAGED", "DORMANT", "CHURNED"] as const;

export class UsageDigestService {
  constructor(private readonly db: DigestDb = getDb() as unknown as DigestDb) {}

  /**
   * Compose the digest for the finalized week ending YESTERDAY (this week = the 7 whole
   * UTC days before today; last week = the 7 before that). Reads pre-rolled rows only.
   */
  async compose(appKey: string, now: Date = new Date()): Promise<UsageDigest> {
    const todayStart = utcDayStart(now);
    const thisWeekEnd = todayStart; // exclusive
    const thisWeekStart = new Date(thisWeekEnd.getTime() - WEEK_MS);
    const lastWeekStart = new Date(thisWeekStart.getTime() - WEEK_MS);

    const metrics = await this.db.usageMetricDaily.findMany({
      where: { appKey, date: { gte: lastWeekStart, lt: thisWeekEnd } },
    });

    // Whether last week has ANY metric data — drives the graceful missing-week copy.
    const lastWeekHasData = metrics.some(
      (r) => r.date >= lastWeekStart && r.date < thisWeekStart,
    );

    const wau = this.scalarMover(
      "WAU",
      metrics,
      UsageMetric.WAU,
      { lastWeekStart, thisWeekStart, thisWeekEnd },
    );
    const mau = this.scalarMover(
      "MAU",
      metrics,
      UsageMetric.MAU,
      { lastWeekStart, thisWeekStart, thisWeekEnd },
    );

    const biggestFunnelMove = this.biggestFunnelMove(metrics, {
      lastWeekStart,
      thisWeekStart,
      thisWeekEnd,
    });

    const adoptionMovers = this.adoptionMovers(metrics, {
      lastWeekStart,
      thisWeekStart,
      thisWeekEnd,
    });
    // Rank by delta desc; movers with a null delta (no prior week) sort last.
    const ranked = [...adoptionMovers].sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity));
    const topAdoptionMovers = ranked.filter((m) => (m.delta ?? 0) > 0).slice(0, 3);
    const bottomAdoptionMovers = [...ranked].reverse().filter((m) => (m.delta ?? 0) < 0).slice(0, 3);

    const cohortTransitions = await this.cohortTransitions(appKey, {
      lastWeekStart,
      thisWeekStart,
      thisWeekEnd,
    });

    const digest: Omit<UsageDigest, "body"> = {
      appKey,
      weekStart: dateKey(thisWeekStart),
      weekEnd: dateKey(thisWeekEnd),
      missingLastWeek: !lastWeekHasData,
      wau,
      mau,
      biggestFunnelMove,
      topAdoptionMovers,
      bottomAdoptionMovers,
      cohortTransitions,
    };
    return { ...digest, body: renderDigestBody(digest) };
  }

  /**
   * Compose the digest AND deliver it through the existing notification path. Returns the
   * composed digest so the caller/test can assert on it. The "send" is the Sentry→Slack
   * seam (captureError with a `digest:` tag); when recipients are empty the digest is
   * still composed + logged (nothing to email), matching the SENTRY_DSN-empty fallback.
   */
  async runWeekly(appKey: string, now: Date = new Date()): Promise<UsageDigest> {
    const digest = await this.compose(appKey, now);
    const recipients = getConfig()
      .USAGE_DIGEST_RECIPIENTS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    captureError(new Error(`Weekly usage digest — ${appKey} — ${digest.weekStart}`), {
      digest: "usage-weekly",
      appKey,
      weekStart: digest.weekStart,
      recipients,
      body: digest.body,
    });
    return digest;
  }

  // ── movers (all read pre-rolled rows only) ───────────────────────────────────

  /** WoW mover for a scalar metric (dimension ""), averaged over each week's days. */
  private scalarMover(
    name: string,
    metrics: readonly MetricRow[],
    metric: string,
    w: { lastWeekStart: Date; thisWeekStart: Date; thisWeekEnd: Date },
  ): DigestMover {
    const thisWeek = weekAverage(metrics, metric, "", w.thisWeekStart, w.thisWeekEnd);
    const lastWeek = weekAverage(metrics, metric, "", w.lastWeekStart, w.thisWeekStart);
    return moverOf(name, thisWeek, lastWeek);
  }

  /** The funnel stage whose reach moved most (by absolute WoW change). */
  private biggestFunnelMove(
    metrics: readonly MetricRow[],
    w: { lastWeekStart: Date; thisWeekStart: Date; thisWeekEnd: Date },
  ): DigestMover | null {
    let best: DigestMover | null = null;
    for (const stage of FUNNEL_STAGES) {
      const thisWeek = weekSum(metrics, UsageMetric.FUNNEL_STAGE, stage, w.thisWeekStart, w.thisWeekEnd);
      const lastWeek = weekSum(metrics, UsageMetric.FUNNEL_STAGE, stage, w.lastWeekStart, w.thisWeekStart);
      const hasAny = thisWeek.count > 0 || lastWeek.count > 0;
      if (!hasAny) continue;
      const mover = moverOf(stage, thisWeek.value, lastWeek.count > 0 ? lastWeek.value : null);
      if (best === null || Math.abs(mover.delta ?? 0) > Math.abs(best.delta ?? 0)) best = mover;
    }
    return best;
  }

  /** WoW movers for every adoption feature (distinct-shops numerator, summed per week). */
  private adoptionMovers(
    metrics: readonly MetricRow[],
    w: { lastWeekStart: Date; thisWeekStart: Date; thisWeekEnd: Date },
  ): DigestMover[] {
    return ADOPTION_FEATURES.map((feature) => {
      const thisWeek = weekSum(metrics, UsageMetric.ADOPTION_D30, feature, w.thisWeekStart, w.thisWeekEnd);
      const lastWeek = weekSum(metrics, UsageMetric.ADOPTION_D30, feature, w.lastWeekStart, w.thisWeekStart);
      return moverOf(feature, thisWeek.value, lastWeek.count > 0 ? lastWeek.value : null);
    });
  }

  /**
   * Count shops entering each notable lifecycle this week vs last, from the NEWEST cohort
   * run in each window (one row per shop from that run — the append-only family keeps
   * every run). A snapshot family, so this is still "from pre-rolled rows", not raw events.
   */
  private async cohortTransitions(
    appKey: string,
    w: { lastWeekStart: Date; thisWeekStart: Date; thisWeekEnd: Date },
  ): Promise<DigestMover[]> {
    const [thisWeekRows, lastWeekRows] = await Promise.all([
      this.db.usageCohortSnapshot.findMany({
        where: { appKey, computedAt: { gte: w.thisWeekStart, lt: w.thisWeekEnd } },
        orderBy: { computedAt: "desc" },
      }),
      this.db.usageCohortSnapshot.findMany({
        where: { appKey, computedAt: { gte: w.lastWeekStart, lt: w.thisWeekStart } },
        orderBy: { computedAt: "desc" },
      }),
    ]);
    const thisCounts = newestRunLifecycleCounts(thisWeekRows);
    const lastCounts = newestRunLifecycleCounts(lastWeekRows);
    const lastHadData = lastWeekRows.length > 0;
    return NOTABLE_LIFECYCLES.map((lc) =>
      moverOf(lc, thisCounts.get(lc) ?? 0, lastHadData ? lastCounts.get(lc) ?? 0 : null),
    );
  }
}

// ── pure helpers ───────────────────────────────────────────────────────────────

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Sum + count of a (metric, dimension)'s daily values in [start, end). */
function weekSum(
  metrics: readonly MetricRow[],
  metric: string,
  dimension: string,
  start: Date,
  end: Date,
): { value: number; count: number } {
  let value = 0;
  let count = 0;
  for (const r of metrics) {
    if (r.metric !== metric || r.dimension !== dimension) continue;
    if (r.date < start || r.date >= end) continue;
    value += r.value;
    count += 1;
  }
  return { value, count };
}

/** Average of a (metric, dimension)'s daily values in [start, end), or null if none. */
function weekAverage(
  metrics: readonly MetricRow[],
  metric: string,
  dimension: string,
  start: Date,
  end: Date,
): number | null {
  const { value, count } = weekSum(metrics, metric, dimension, start, end);
  return count === 0 ? null : value / count;
}

/** Build a mover from this/last values; null `lastWeek` ⇒ null delta (no prior week). */
function moverOf(name: string, thisWeek: number | null, lastWeek: number | null): DigestMover {
  const tw = thisWeek ?? 0;
  const delta = lastWeek === null ? null : tw - lastWeek;
  return { name, thisWeek: tw, lastWeek, delta };
}

/** Distinct shops per lifecycle from ONLY the newest run in the given rows. */
function newestRunLifecycleCounts(rows: readonly CohortRow[]): Map<string, number> {
  const out = new Map<string, number>();
  if (rows.length === 0) return out;
  const newest = rows[0]!.computedAt.getTime(); // rows are ordered desc
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.computedAt.getTime() !== newest) break;
    if (seen.has(r.shop)) continue;
    seen.add(r.shop);
    out.set(r.lifecycle, (out.get(r.lifecycle) ?? 0) + 1);
  }
  return out;
}

/** Format one mover as a short line: "WAU: 120 (+8 WoW)" or "…(n/a — first week)". */
function renderMover(m: DigestMover): string {
  if (m.delta === null) return `${m.name}: ${round(m.thisWeek)} (n/a — no prior week)`;
  const sign = m.delta >= 0 ? "+" : "";
  return `${m.name}: ${round(m.thisWeek)} (${sign}${round(m.delta)} WoW)`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Render the fixed-format plain-text digest body from the composed movers. Kept pure +
 * exported-adjacent so the composer stays testable; the "send" step delivers this string.
 */
export function renderDigestBody(d: Omit<UsageDigest, "body">): string {
  const lines: string[] = [];
  lines.push(`Weekly usage digest — ${d.appKey}`);
  lines.push(`Week of ${d.weekStart} (through ${d.weekEnd}, exclusive)`);
  if (d.missingLastWeek) {
    lines.push("(First full week of history — week-over-week deltas are not yet available.)");
  }
  lines.push("");
  lines.push("Activity");
  lines.push(`  ${renderMover(d.wau)}`);
  lines.push(`  ${renderMover(d.mau)}`);
  lines.push("");
  lines.push("Funnel");
  lines.push(
    d.biggestFunnelMove
      ? `  Biggest stage move — ${renderMover(d.biggestFunnelMove)}`
      : "  No funnel movement to report yet.",
  );
  lines.push("");
  lines.push("Feature adoption");
  if (d.topAdoptionMovers.length > 0) {
    lines.push("  Top movers:");
    for (const m of d.topAdoptionMovers) lines.push(`    ${renderMover(m)}`);
  } else {
    lines.push("  Top movers: none this week.");
  }
  if (d.bottomAdoptionMovers.length > 0) {
    lines.push("  Biggest declines:");
    for (const m of d.bottomAdoptionMovers) lines.push(`    ${renderMover(m)}`);
  }
  lines.push("");
  lines.push("Cohort transitions (shops entering)");
  for (const m of d.cohortTransitions) lines.push(`  ${renderMover(m)}`);
  return lines.join("\n");
}

let instance: UsageDigestService | null = null;
export function getUsageDigestService(): UsageDigestService {
  if (instance === null) instance = new UsageDigestService();
  return instance;
}

/** Test seam. */
export function __setUsageDigestService(fake: UsageDigestService | null): void {
  instance = fake;
}

/** Worker call site for the weekly digest. Wraps errors for BullMQ retry. */
export async function runUsageWeeklyDigest(appKey: string, now: Date = new Date()): Promise<void> {
  try {
    await getUsageDigestService().runWeekly(appKey, now);
  } catch (err) {
    captureError(err, { job: "usage-weekly-digest", appKey });
    throw err;
  }
}
