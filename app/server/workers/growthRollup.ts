import { Queue, Worker, type ConnectionOptions, type JobsOptions } from "bullmq";
import { getConfig } from "~/lib/config.js";
import {
  getGrowthMetricsService,
  GROWTH_ROLLUP_QUEUE_NAME,
} from "../services/growthMetricsService.js";
import { initObservability, captureError, withTrace } from "~/lib/observability.js";

/**
 * Growth rollup (cp-merchant-health / cp-uninstall-churn / cp-announcements-nps). A
 * repeatable BullMQ job that refreshes per-merchant health snapshots, infers reinstalls,
 * and persists portfolio growth gauges (`nps`, `churned_merchants`, `at_risk_merchants`)
 * as `KpiSnapshot` rows. Mirrors the complianceSweep/opsRollup scheduling pattern; less
 * frequent (hourly default) since health/churn/NPS move slowly.
 */
export const GROWTH_ROLLUP_JOB_NAME = "rollup";

export interface GrowthRollupJobData {
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

export function makeGrowthRollupQueue(): Queue<GrowthRollupJobData> {
  return new Queue<GrowthRollupJobData>(GROWTH_ROLLUP_QUEUE_NAME, { connection: connection() });
}

/** Schedule the recurring rollup (hourly by default). Idempotent jobId per app. */
export async function scheduleGrowthRollup(
  appKey: string,
  cron = getConfig().GROWTH_ROLLUP_CRON,
): Promise<void> {
  const queue = makeGrowthRollupQueue();
  const opts: JobsOptions = {
    repeat: { pattern: cron },
    jobId: `growth-rollup-${appKey}`,
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
  };
  await queue.add(GROWTH_ROLLUP_JOB_NAME, { appKey }, opts);
}

/** Start the growth rollup worker: health snapshots + reinstall inference + growth KPIs. */
export function startGrowthRollupWorker(): Worker<GrowthRollupJobData> {
  initObservability("worker");
  const worker = new Worker<GrowthRollupJobData>(
    GROWTH_ROLLUP_QUEUE_NAME,
    async (job) =>
      withTrace("growth-rollup", async () => {
        const written = await getGrowthMetricsService().runRollup(job.data.appKey);
        return { snapshots: written };
      }),
    { connection: connection() },
  );
  worker.on("failed", (job, err) => {
    captureError(err, { queue: GROWTH_ROLLUP_QUEUE_NAME, jobId: job?.id, appKey: job?.data.appKey });
  });
  return worker;
}
