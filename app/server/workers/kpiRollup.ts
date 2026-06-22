import { Queue, Worker, type ConnectionOptions, type JobsOptions } from "bullmq";
import { getConfig } from "~/lib/config.js";
import { getKpiService } from "../services/kpiService.js";
import { initObservability, captureError, withTrace } from "~/lib/observability.js";

/**
 * KPI rollup job (cp-kpi-dashboard AC8.1). A scheduled BullMQ job runs
 * `connector.computeKpis()` against the REPLICA and appends KpiSnapshot rows. On
 * failure BullMQ retries; prior snapshots remain intact (the service only appends).
 */
export const KPI_QUEUE_NAME = "kpi-rollup";
export const KPI_JOB_NAME = "rollup";

export interface KpiRollupJobData {
  readonly appKey: string;
}

// Let BullMQ construct its own ioredis from the URL — passing a foreign Redis
// instance clashes with BullMQ's bundled ioredis types.
function connection(): ConnectionOptions {
  const url = new URL(getConfig().REDIS_URL);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.password ? { password: url.password } : {}),
    maxRetriesPerRequest: null,
  };
}

export function makeKpiQueue(): Queue<KpiRollupJobData> {
  return new Queue<KpiRollupJobData>(KPI_QUEUE_NAME, { connection: connection() });
}

/** Schedule the recurring rollup (every 15 min by default). */
export async function scheduleKpiRollup(
  appKey: string,
  cron = "*/15 * * * *",
): Promise<void> {
  const queue = makeKpiQueue();
  const opts: JobsOptions = {
    repeat: { pattern: cron },
    jobId: `kpi-rollup-${appKey}`,
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
  };
  await queue.add(KPI_JOB_NAME, { appKey }, opts);
}

/** Start the worker (called from the persistent process / worker entry). */
export function startKpiWorker(): Worker<KpiRollupJobData> {
  initObservability("worker");
  const worker = new Worker<KpiRollupJobData>(
    KPI_QUEUE_NAME,
    async (job) =>
      withTrace("kpi-rollup", async () => {
        const count = await getKpiService().runRollup(job.data.appKey);
        return { metrics: count };
      }),
    { connection: connection() },
  );
  worker.on("failed", (job, err) => {
    captureError(err, { queue: KPI_QUEUE_NAME, jobId: job?.id, appKey: job?.data.appKey });
  });
  return worker;
}
