// app/server/services/usageAlertService.ts
// Threshold-alert evaluation over the pre-rolled usage metrics (cp usage-alerts-digest,
// usage-analytics Phase 5). Reads this-week-vs-last-week DELTAS from `UsageMetricDaily`
// (and lifecycle-entry counts from `UsageCohortSnapshot`) — NEVER raw events — and fires
// an alert once per breach EPISODE: a rule transitions OK→BREACHED (one alert) and
// BREACHED→OK (one recovery notice); repeated evaluations inside an ongoing episode are
// silent. Episode state is persisted (`UsageAlertState`) so the once-per-episode guarantee
// survives across job runs.
//
// Evaluation runs on FINALIZED daily numbers only — the worker chains it to run right
// after the daily finalize (see workers/usageRollup.ts), so it never reads provisional
// intraday values. Delivery reuses the existing Sentry→Slack path (`captureError` with an
// `alert:` tag), the same mechanism the Phase-2 ingestion-lag alert uses; every fire/
// recovery is also written to the append-only audit log (JOB-sourced).
//
// Testable without BullMQ or a real DB: the DB surface is narrow + DI'd (FakeDb in tests),
// following the opsMetricsService / usageRollupService pattern.

import { getDb } from "../db.js";
import { getAuditService, type AuditService, type TxClient } from "./auditService.js";
import { captureError } from "~/lib/observability.js";
import { AuditActions } from "~/lib/auditActions.js";
import { utcDayStart } from "~/lib/usageMetrics.js";
import type {
  UsageAlertComparison,
  UsageAlertMetricKind,
  UsageAlertEpisodeState,
} from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** An alert rule as this service reads it (subset of `UsageAlertRule`). */
export interface AlertRuleRow {
  readonly id: string;
  readonly appKey: string;
  readonly key: string;
  readonly label: string;
  readonly metricKind: UsageAlertMetricKind;
  readonly metric: string;
  readonly dimension: string;
  readonly comparison: UsageAlertComparison;
  readonly threshold: number;
  readonly enabled: boolean;
}

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

/** A per-rule episode-state row (subset of `UsageAlertState`). */
interface AlertStateRow {
  readonly id: string;
  readonly ruleId: string;
  readonly state: UsageAlertEpisodeState;
  readonly lastValue: number | null;
  readonly breachedAt: Date | null;
}

/** Narrow DB surface — small enough that FakeDb satisfies it in tests. */
export interface AlertDb {
  usageAlertRule: {
    findMany(args: { where: Record<string, unknown> }): Promise<AlertRuleRow[]>;
  };
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
  usageAlertState: {
    findUnique(args: { where: { ruleId: string } }): Promise<AlertStateRow | null>;
    upsert(args: {
      where: { ruleId: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<AlertStateRow>;
  };
}

/** The observed value + whether it breached this evaluation, for one rule. */
export interface RuleEvaluation {
  readonly ruleId: string;
  readonly ruleKey: string;
  readonly observed: number;
  readonly breached: boolean;
  /** What notification the episode transition produced this run (or `none`). */
  readonly action: "alert" | "recovery" | "none";
  /** Human message delivered on an alert/recovery (empty for `none`). */
  readonly message: string;
}

export interface UsageAlertEvalResult {
  readonly evaluatedRules: number;
  readonly alertsFired: number;
  readonly recoveriesFired: number;
  readonly evaluations: readonly RuleEvaluation[];
}

/**
 * Pure breach test for one rule's observed delta. `DROP_GT` breaches when the value has
 * fallen more than `threshold` below zero (a decline worse than the threshold); `RISE_GT`
 * breaches when it has risen more than `threshold` above zero. The observed value's SIGN
 * carries the direction (negative = decline, positive = rise), so a rule that watches a
 * drop compares `-observed > threshold`.
 */
export function isBreach(
  comparison: UsageAlertComparison,
  observed: number,
  threshold: number,
): boolean {
  if (comparison === "DROP_GT") return -observed > threshold;
  return observed > threshold; // RISE_GT
}

export class UsageAlertService {
  constructor(
    private readonly db: AlertDb = getDb() as unknown as AlertDb,
    private readonly audit: AuditService = getAuditService(),
  ) {}

  /**
   * Evaluate every ENABLED rule for the app against finalized week-over-week deltas and
   * apply breach-episode transitions. `now` is the finalize instant; the "this week"
   * window is the 7 finalized days ending YESTERDAY (never today's provisional day).
   */
  async evaluate(appKey: string, now: Date = new Date()): Promise<UsageAlertEvalResult> {
    const rules = await this.db.usageAlertRule.findMany({
      where: { appKey, enabled: true },
    });

    // Finalized windows: [thisWeekStart, thisWeekEnd) is the 7 whole UTC days ending
    // YESTERDAY; last week is the 7 days before that. Today (provisional) is excluded.
    const todayStart = utcDayStart(now);
    const thisWeekEnd = todayStart; // exclusive: up to but not including today
    const thisWeekStart = new Date(thisWeekEnd.getTime() - WEEK_MS);
    const lastWeekStart = new Date(thisWeekStart.getTime() - WEEK_MS);

    let alertsFired = 0;
    let recoveriesFired = 0;
    const evaluations: RuleEvaluation[] = [];

    for (const rule of rules) {
      const observed = await this.observeDelta(
        rule,
        { lastWeekStart, thisWeekStart, thisWeekEnd },
      );
      const breached = isBreach(rule.comparison, observed, rule.threshold);
      const evaluation = await this.applyEpisode(rule, observed, breached, now);
      evaluations.push(evaluation);
      if (evaluation.action === "alert") alertsFired += 1;
      if (evaluation.action === "recovery") recoveriesFired += 1;
    }

    return {
      evaluatedRules: rules.length,
      alertsFired,
      recoveriesFired,
      evaluations,
    };
  }

  /**
   * The rule's observed week-over-week delta, read from pre-rolled rows ONLY:
   *  - METRIC_WOW_POINTS  → (thisWeek value − lastWeek value) in the metric's units.
   *  - METRIC_WOW_PERCENT → (thisWeek − lastWeek) / lastWeek as a signed fraction
   *    (0 when last week is 0, to avoid a divide-by-zero false spike).
   *  - COHORT_TRANSITION  → (#shops entering the lifecycle this week − last week) as a
   *    signed count, from the newest cohort run in each window.
   */
  private async observeDelta(
    rule: AlertRuleRow,
    windows: { lastWeekStart: Date; thisWeekStart: Date; thisWeekEnd: Date },
  ): Promise<number> {
    if (rule.metricKind === "COHORT_TRANSITION") {
      const thisWeek = await this.lifecycleCount(rule, windows.thisWeekStart, windows.thisWeekEnd);
      const lastWeek = await this.lifecycleCount(rule, windows.lastWeekStart, windows.thisWeekStart);
      return thisWeek - lastWeek;
    }

    const thisWeek = await this.metricWindowValue(rule, windows.thisWeekStart, windows.thisWeekEnd);
    const lastWeek = await this.metricWindowValue(rule, windows.lastWeekStart, windows.thisWeekStart);
    if (rule.metricKind === "METRIC_WOW_PERCENT") {
      if (lastWeek === 0) return 0;
      return (thisWeek - lastWeek) / lastWeek;
    }
    return thisWeek - lastWeek; // METRIC_WOW_POINTS
  }

  /**
   * A metric's representative value over a window: the AVERAGE of its daily values in
   * [start, end). Averaging (not summing) keeps conversion-style ratios comparable
   * week-over-week regardless of how many days carry a row.
   */
  private async metricWindowValue(rule: AlertRuleRow, start: Date, end: Date): Promise<number> {
    const rows = await this.db.usageMetricDaily.findMany({
      where: {
        appKey: rule.appKey,
        metric: rule.metric,
        dimension: rule.dimension,
        date: { gte: start, lt: end },
      },
    });
    if (rows.length === 0) return 0;
    const sum = rows.reduce((acc, r) => acc + r.value, 0);
    return sum / rows.length;
  }

  /**
   * Count distinct shops whose NEWEST cohort snapshot inside the window assigns the
   * watched lifecycle (`rule.metric` holds the lifecycle, e.g. "DORMANT"). One row per
   * shop from the latest run in the window (the append-only snapshot family keeps every
   * run), so a shop counts once even across multiple runs in the week.
   */
  private async lifecycleCount(rule: AlertRuleRow, start: Date, end: Date): Promise<number> {
    const rows = await this.db.usageCohortSnapshot.findMany({
      where: { appKey: rule.appKey, computedAt: { gte: start, lt: end } },
      orderBy: { computedAt: "desc" },
    });
    if (rows.length === 0) return 0;
    const newest = rows[0]!.computedAt.getTime();
    const counted = new Set<string>();
    for (const r of rows) {
      if (r.computedAt.getTime() !== newest) break; // ordered desc → newest run first
      if (r.lifecycle === rule.metric) counted.add(r.shop);
    }
    return counted.size;
  }

  /**
   * Apply the breach-episode state machine for one rule and deliver at most one
   * notification. OK→BREACHED fires an alert; BREACHED→OK fires a recovery notice; a
   * repeated breach or a repeated OK is silent. The new state is persisted so the next
   * run sees the episode.
   */
  private async applyEpisode(
    rule: AlertRuleRow,
    observed: number,
    breached: boolean,
    now: Date,
  ): Promise<RuleEvaluation> {
    const prior = await this.db.usageAlertState.findUnique({ where: { ruleId: rule.id } });
    const priorState: UsageAlertEpisodeState = prior?.state ?? "OK";

    let action: RuleEvaluation["action"] = "none";
    let message = "";

    if (breached && priorState === "OK") {
      action = "alert";
      message = this.describe(rule, observed, "breach");
      await this.deliver(rule, message, observed, "alert");
    } else if (!breached && priorState === "BREACHED") {
      action = "recovery";
      message = this.describe(rule, observed, "recovery");
      await this.deliver(rule, message, observed, "recovery");
    }

    const nextState: UsageAlertEpisodeState = breached ? "BREACHED" : "OK";
    await this.db.usageAlertState.upsert({
      where: { ruleId: rule.id },
      create: {
        ruleId: rule.id,
        state: nextState,
        lastValue: observed,
        breachedAt: breached ? now : null,
        lastEvaluatedAt: now,
      },
      update: {
        state: nextState,
        lastValue: observed,
        // Keep the original episode start; clear it only when the episode closes.
        breachedAt: breached ? (prior?.breachedAt ?? now) : null,
        lastEvaluatedAt: now,
      },
    });

    return { ruleId: rule.id, ruleKey: rule.key, observed, breached, action, message };
  }

  /** Compose the alert/recovery message naming the metric, the delta, and the window. */
  private describe(rule: AlertRuleRow, observed: number, kind: "breach" | "recovery"): string {
    const delta = this.formatObserved(rule, observed);
    const subject = rule.dimension ? `${rule.metric} [${rule.dimension}]` : rule.metric;
    if (kind === "breach") {
      return (
        `Usage alert "${rule.label}" BREACHED: ${subject} moved ${delta} ` +
        `week-over-week (threshold ${this.formatThreshold(rule)}).`
      );
    }
    return (
      `Usage alert "${rule.label}" RECOVERED: ${subject} is back within threshold ` +
      `(now ${delta} week-over-week).`
    );
  }

  private formatObserved(rule: AlertRuleRow, observed: number): string {
    if (rule.metricKind === "METRIC_WOW_PERCENT") return `${(observed * 100).toFixed(1)}%`;
    if (rule.metricKind === "COHORT_TRANSITION") {
      return `${observed >= 0 ? "+" : ""}${observed} shops`;
    }
    return `${observed >= 0 ? "+" : ""}${observed}`;
  }

  private formatThreshold(rule: AlertRuleRow): string {
    if (rule.metricKind === "METRIC_WOW_PERCENT") return `${(rule.threshold * 100).toFixed(1)}%`;
    if (rule.metricKind === "COHORT_TRANSITION") return `${rule.threshold} shops`;
    return `${rule.threshold}`;
  }

  /**
   * Deliver a fire/recovery through the existing Sentry→Slack path AND record it in the
   * append-only audit log (JOB-sourced), mirroring the ops-lag alert + SLO-alert idioms.
   */
  private async deliver(
    rule: AlertRuleRow,
    message: string,
    observed: number,
    kind: "alert" | "recovery",
  ): Promise<void> {
    captureError(new Error(message), {
      alert: kind === "alert" ? "usage-threshold" : "usage-threshold-recovery",
      appKey: rule.appKey,
      ruleKey: rule.key,
      observed,
    });
    // Route the audit write through THIS service's db handle (the same one the eval read
    // from), so a test that injects a fake DB sees the audit row too, and production
    // writes to the CP DB. It is a single append, not part of a wider transaction.
    await this.audit.append(
      {
        actorUserId: "system",
        actorType: "SYSTEM",
        source: "JOB",
        appKey: rule.appKey,
        action:
          kind === "alert" ? AuditActions.UsageAlertFired : AuditActions.UsageAlertRecovered,
        target: rule.id,
        after: { ruleKey: rule.key, observed, message },
      },
      this.db as unknown as TxClient,
    );
  }
}

let instance: UsageAlertService | null = null;
export function getUsageAlertService(): UsageAlertService {
  if (instance === null) instance = new UsageAlertService();
  return instance;
}

/** Test seam. */
export function __setUsageAlertService(fake: UsageAlertService | null): void {
  instance = fake;
}

/**
 * Worker call site: evaluate alerts for the app. Wraps errors for BullMQ retry, like the
 * sibling usage-rollup entry points. Chained after the daily finalize (finalized numbers).
 */
export async function runUsageAlertEval(appKey: string, now: Date = new Date()): Promise<void> {
  try {
    await getUsageAlertService().evaluate(appKey, now);
  } catch (err) {
    captureError(err, { job: "usage-alert-eval", appKey });
    throw err;
  }
}
