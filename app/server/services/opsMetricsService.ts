import { Queue, type ConnectionOptions } from "bullmq";
import { getConfig } from "~/lib/config.js";
import { captureError } from "~/lib/observability.js";
import { getDb } from "../db.js";
import { getComplianceService } from "./complianceService.js";
import { KPI_QUEUE_NAME } from "../workers/kpiRollup.js";
import { WEBHOOK_QUEUE_NAME } from "../workers/webhookProcess.js";
import { COMPLIANCE_SWEEP_QUEUE_NAME } from "../workers/complianceSweep.js";
import { SLA_SWEEP_QUEUE_NAME } from "../workers/slaSweep.js";
import { USAGE_INGEST_QUEUE_NAME } from "../workers/usageIngest.js";

/**
 * Portfolio ops metrics (cp-ops-monitoring). Reads LIVE BullMQ job counts (no app-DB
 * read) plus control-plane gauges (webhook failures/dead-letters, compliance
 * breaching) and renders them two ways: a Prometheus document for the `/metrics`
 * scrape (BullMQ-native `bullmq_job_count{queue,state}` — verified available on the
 * installed BullMQ via `exportPrometheusMetrics`, composed here into one multi-queue
 * document) and a structured tile snapshot for the monitoring dashboard.
 *
 * The ops rollup persists a subset of these gauges as `KpiSnapshot` rows so trend
 * tiles render from pre-aggregated rows (the same seam the KPI dashboard uses).
 */
export const OPS_ROLLUP_QUEUE_NAME = "ops-rollup";

/** Trailing window for the per-tick SLO webhook error-ratio sample (cp-slo-alerting). */
const SLO_SAMPLE_LOOKBACK_MS = 15 * 60_000;

/** Every queue the persistent process runs — the per-app monitoring surface. */
export const MONITORED_QUEUES = [
  KPI_QUEUE_NAME,
  WEBHOOK_QUEUE_NAME,
  COMPLIANCE_SWEEP_QUEUE_NAME,
  SLA_SWEEP_QUEUE_NAME,
  OPS_ROLLUP_QUEUE_NAME,
  USAGE_INGEST_QUEUE_NAME,
] as const;

export interface QueueStat {
  readonly name: string;
  readonly waiting: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly delayed: number;
  /** ms epoch of the most recent completed job, or null if none recorded. */
  readonly lastCompletedAt: number | null;
}

export type WorkerLiveness = "idle" | "healthy" | "stale";

export interface QueueTile extends QueueStat {
  readonly backlog: number;
  readonly liveness: WorkerLiveness;
}

export interface OpsGauges {
  readonly webhookFailed: number;
  readonly webhookDeadLetter: number;
  readonly complianceBreaching: number;
  /**
   * Seconds since the newest mirrored usage event for the app (usage-analytics
   * Phase 2b). -1 when no usage events have ever been ingested (nothing to lag
   * against). A large value while the app is emitting means ingestion stalled.
   */
  readonly usageIngestLagSeconds: number;
}

export interface OpsSnapshot {
  readonly appKey: string;
  readonly queues: readonly QueueTile[];
  readonly gauges: OpsGauges;
  readonly generatedAt: string;
}

/** Injectable provider so the dashboard/rollup are testable without a live Redis. */
export type QueueStatsProvider = (name: string) => Promise<QueueStat>;

function connection(): ConnectionOptions {
  const url = new URL(getConfig().REDIS_URL);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.password ? { password: url.password } : {}),
    maxRetriesPerRequest: 0,
    connectTimeout: 2000,
    retryStrategy: () => null,
  };
}

const handles = new Map<string, Queue>();
function queueHandle(name: string): Queue {
  let q = handles.get(name);
  if (!q) {
    q = new Queue(name, { connection: connection() });
    handles.set(name, q);
  }
  return q;
}

/** Default provider: live BullMQ counts + last-completed timestamp. */
async function liveQueueStats(name: string): Promise<QueueStat> {
  const q = queueHandle(name);
  let counts: Record<string, number>;
  try {
    counts = await q.getJobCounts("waiting", "active", "completed", "failed", "delayed");
  } catch {
    // Redis unavailable — return a zero-stat so tiles still render with the queue name.
    return { name, waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, lastCompletedAt: null };
  }
  let lastCompletedAt: number | null = null;
  try {
    const recent = await q.getJobs(["completed"], 0, 0, false);
    const finished = recent[0]?.finishedOn;
    if (typeof finished === "number") lastCompletedAt = finished;
  } catch {
    // getJobs can throw if the queue key doesn't exist yet — treat as no completions.
  }
  return {
    name,
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
    lastCompletedAt,
  };
}

/**
 * Classify worker liveness from a queue's stats:
 *  - `idle`    — the queue has never had a job (nothing to be stale about);
 *  - `healthy` — a job completed within the liveness window;
 *  - `stale`   — the queue has had activity but no completion within the window
 *               (a stuck/backed-up worker).
 */
export function classifyLiveness(
  stat: QueueStat,
  now: number,
  windowMs: number,
): WorkerLiveness {
  const total = stat.waiting + stat.active + stat.completed + stat.failed + stat.delayed;
  if (total === 0) return "idle";
  if (stat.lastCompletedAt != null && now - stat.lastCompletedAt <= windowMs) {
    return "healthy";
  }
  return "stale";
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export class OpsMetricsService {
  constructor(
    private readonly db = getDb(),
    private readonly queueStats: QueueStatsProvider = liveQueueStats,
    private readonly compliance = getComplianceService(),
  ) {}

  /** Live per-queue stats for every monitored queue. */
  async collectQueueStats(): Promise<QueueStat[]> {
    return Promise.all(MONITORED_QUEUES.map((name) => this.queueStats(name)));
  }

  /** Control-plane gauges (CP-table reads only — never the app DB). */
  async collectGauges(appKey: string, now: Date = new Date()): Promise<OpsGauges> {
    const [webhookFailed, webhookDeadLetter, breaching, usageAgg] = await Promise.all([
      this.db.webhookEvent.count({ where: { appKey, status: "FAILED" } }),
      this.db.webhookEvent.count({ where: { appKey, status: "DEAD_LETTER" } }),
      this.compliance.listBreaching(appKey, undefined, now),
      this.db.usageEvent.aggregate({
        where: { appKey },
        _max: { occurredAt: true },
      }),
    ]);
    const newest = usageAgg._max.occurredAt;
    const usageIngestLagSeconds = newest
      ? Math.max(0, Math.round((now.getTime() - newest.getTime()) / 1000))
      : -1;
    return {
      webhookFailed,
      webhookDeadLetter,
      complianceBreaching: breaching.length,
      usageIngestLagSeconds,
    };
  }

  /** A structured snapshot for the monitoring tiles (with derived liveness). */
  async snapshot(appKey: string, now: Date = new Date()): Promise<OpsSnapshot> {
    const windowMs = getConfig().WORKER_LIVENESS_WINDOW_MINUTES * 60_000;
    const [stats, gauges] = await Promise.all([
      this.collectQueueStats(),
      this.collectGauges(appKey, now),
    ]);
    const queues: QueueTile[] = stats.map((s) => ({
      ...s,
      backlog: s.waiting + s.active,
      liveness: classifyLiveness(s, now.getTime(), windowMs),
    }));
    return { appKey, queues, gauges, generatedAt: now.toISOString() };
  }

  /**
   * Prometheus text exposition. `bullmq_job_count{queue,state}` for every queue plus
   * control-plane gauges. Carries ONLY counts/labels — no PII.
   */
  async prometheus(appKey: string, now: Date = new Date()): Promise<string> {
    const stats = await this.collectQueueStats();
    const gauges = await this.collectGauges(appKey, now);
    const app = escapeLabel(appKey);
    const lines: string[] = [];

    lines.push("# HELP bullmq_job_count Number of jobs in the queue by state");
    lines.push("# TYPE bullmq_job_count gauge");
    for (const s of stats) {
      const q = escapeLabel(s.name);
      lines.push(`bullmq_job_count{queue="${q}", state="waiting"} ${s.waiting}`);
      lines.push(`bullmq_job_count{queue="${q}", state="active"} ${s.active}`);
      lines.push(`bullmq_job_count{queue="${q}", state="completed"} ${s.completed}`);
      lines.push(`bullmq_job_count{queue="${q}", state="failed"} ${s.failed}`);
      lines.push(`bullmq_job_count{queue="${q}", state="delayed"} ${s.delayed}`);
    }

    lines.push("# HELP control_plane_webhook_failed Webhook events in the FAILED state");
    lines.push("# TYPE control_plane_webhook_failed gauge");
    lines.push(`control_plane_webhook_failed{app="${app}"} ${gauges.webhookFailed}`);
    lines.push("# HELP control_plane_webhook_dead_letter Webhook events dead-lettered");
    lines.push("# TYPE control_plane_webhook_dead_letter gauge");
    lines.push(`control_plane_webhook_dead_letter{app="${app}"} ${gauges.webhookDeadLetter}`);
    lines.push("# HELP control_plane_compliance_breaching DSR requests near/past their SLA");
    lines.push("# TYPE control_plane_compliance_breaching gauge");
    lines.push(`control_plane_compliance_breaching{app="${app}"} ${gauges.complianceBreaching}`);
    lines.push(
      "# HELP control_plane_usage_ingest_lag_seconds Seconds since the newest mirrored usage event (-1 = none)",
    );
    lines.push("# TYPE control_plane_usage_ingest_lag_seconds gauge");
    lines.push(
      `control_plane_usage_ingest_lag_seconds{app="${app}"} ${gauges.usageIngestLagSeconds}`,
    );

    return lines.join("\n") + "\n";
  }

  /**
   * Ops rollup: persist a subset of the gauges + per-queue failure/backlog counts as
   * `KpiSnapshot` rows so trend tiles + SLO burn-rate read pre-aggregated history.
   * Returns the number of snapshot rows written.
   */
  async runRollup(appKey: string, now: Date = new Date()): Promise<number> {
    const snap = await this.snapshot(appKey, now);
    const rows: { appKey: string; metric: string; value: number; asOf: Date }[] = [];
    for (const q of snap.queues) {
      rows.push({ appKey, metric: `ops.queue.failed.${q.name}`, value: q.failed, asOf: now });
      rows.push({ appKey, metric: `ops.queue.backlog.${q.name}`, value: q.backlog, asOf: now });
      rows.push({
        appKey,
        metric: `ops.queue.completed.${q.name}`,
        value: q.completed,
        asOf: now,
      });
    }
    rows.push({ appKey, metric: "ops.webhook.failed", value: snap.gauges.webhookFailed, asOf: now });
    rows.push({
      appKey,
      metric: "ops.webhook.dead_letter",
      value: snap.gauges.webhookDeadLetter,
      asOf: now,
    });
    rows.push({
      appKey,
      metric: "ops.compliance.breaching",
      value: snap.gauges.complianceBreaching,
      asOf: now,
    });
    rows.push({
      appKey,
      metric: "ops.usage.ingest_lag_seconds",
      value: snap.gauges.usageIngestLagSeconds,
      asOf: now,
    });
    // Ingestion-lag alert (usage-analytics Phase 2b): fire when the newest mirrored
    // event is older than the threshold — a stalled pipeline is worse than a loud
    // one. -1 (never ingested) is not a stall, so it is excluded.
    const lagThresholdSeconds = getConfig().USAGE_INGEST_LAG_ALERT_MINUTES * 60;
    if (
      snap.gauges.usageIngestLagSeconds >= 0 &&
      snap.gauges.usageIngestLagSeconds > lagThresholdSeconds
    ) {
      captureError(
        new Error(
          `usage ingestion lag ${snap.gauges.usageIngestLagSeconds}s exceeds ` +
            `${lagThresholdSeconds}s for app "${appKey}"`,
        ),
        { alert: "usage-ingest-lag", appKey, lagSeconds: snap.gauges.usageIngestLagSeconds },
      );
    }
    // SLO sample (cp-slo-alerting): the webhook-delivery error ratio over a trailing
    // window, persisted per tick so sloService can compute multi-window burn rate.
    rows.push({
      appKey,
      metric: "ops.slo.webhook_error_ratio",
      value: await this.webhookErrorRatio(appKey, now),
      asOf: now,
    });
    await this.db.kpiSnapshot.createMany({ data: rows });
    return rows.length;
  }

  /** Webhook delivery error ratio over the trailing sample window (bad ÷ received). */
  async webhookErrorRatio(appKey: string, now: Date = new Date()): Promise<number> {
    const since = new Date(now.getTime() - SLO_SAMPLE_LOOKBACK_MS);
    const [total, bad] = await Promise.all([
      this.db.webhookEvent.count({ where: { appKey, receivedAt: { gte: since } } }),
      this.db.webhookEvent.count({
        where: { appKey, status: { in: ["FAILED", "DEAD_LETTER"] }, receivedAt: { gte: since } },
      }),
    ]);
    return total === 0 ? 0 : bad / total;
  }
}

let instance: OpsMetricsService | null = null;
export function getOpsMetricsService(): OpsMetricsService {
  if (!instance) instance = new OpsMetricsService();
  return instance;
}
