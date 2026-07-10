import { Queue, Worker, type ConnectionOptions, type JobsOptions } from "bullmq";
import { getConfig } from "~/lib/config.js";
import { getOpsMetricsService, OPS_ROLLUP_QUEUE_NAME } from "../services/opsMetricsService.js";
import { getSloService } from "../services/sloService.js";
import { getBreakGlassService } from "../services/breakGlassService.js";
import { initObservability, captureError, withTrace } from "~/lib/observability.js";

/**
 * Ops-KPI rollup (cp-ops-monitoring). A repeatable BullMQ job persists ops gauges as
 * `KpiSnapshot` rows (trend tiles read pre-aggregated history), then evaluates SLO
 * burn-rate (cp-slo-alerting) and sweeps expired break-glass grants
 * (cp-break-glass-rbac) — all on one tick, no extra workers. Mirrors the
 * complianceSweep scheduling pattern.
 */
export const OPS_ROLLUP_JOB_NAME = "rollup";

export interface OpsRollupJobData {
  readonly appKey: string;
}

function connection(): ConnectionOptions {
  const url = new URL(getConfig().REDIS_URL);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.password ? { password: url.password } : {}),
    maxRetriesPerRequest: null,
  };
}

export function makeOpsRollupQueue(): Queue<OpsRollupJobData> {
  return new Queue<OpsRollupJobData>(OPS_ROLLUP_QUEUE_NAME, { connection: connection() });
}

/** Schedule the recurring rollup (every 5 min by default). Idempotent jobId per app. */
export async function scheduleOpsRollup(
  appKey: string,
  cron = getConfig().OPS_ROLLUP_CRON,
): Promise<void> {
  const queue = makeOpsRollupQueue();
  const opts: JobsOptions = {
    repeat: { pattern: cron },
    jobId: `ops-rollup-${appKey}`,
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
  };
  await queue.add(OPS_ROLLUP_JOB_NAME, { appKey }, opts);
}

/** Start the rollup worker: persist ops KPIs, evaluate SLOs, sweep expired grants. */
export function startOpsRollupWorker(): Worker<OpsRollupJobData> {
  initObservability("worker");
  const worker = new Worker<OpsRollupJobData>(
    OPS_ROLLUP_QUEUE_NAME,
    async (job) =>
      withTrace("ops-rollup", async () => {
        const { appKey } = job.data;
        const written = await getOpsMetricsService().runRollup(appKey);
        const alerts = await getSloService().evaluate(appKey);
        const expired = await getBreakGlassService().sweepExpired(appKey);
        return { snapshots: written, alerts: alerts.length, grantsExpired: expired };
      }),
    { connection: connection() },
  );
  worker.on("failed", (job, err) => {
    captureError(err, { queue: OPS_ROLLUP_QUEUE_NAME, jobId: job?.id, appKey: job?.data.appKey });
  });
  return worker;
}
