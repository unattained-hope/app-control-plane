import { Queue, Worker, type ConnectionOptions, type JobsOptions } from "bullmq";
import { getConfig } from "~/lib/config.js";
import { runUsageIngest } from "../services/usageIngestService.js";
import { runUsageMirrorPrune } from "../services/usageMirrorPruneService.js";
import { initObservability, captureError, withTrace } from "~/lib/observability.js";

/**
 * Usage-event ingestion (usage-analytics Phase 2b). Two scheduled jobs on one
 * queue: `ingest` pulls new events from an app's export endpoint into the CP
 * mirror (frequent), and `prune` deletes mirror rows past the retention window
 * (daily). Both are per-app. On failure BullMQ retries; the mirror stays
 * consistent because inserts are idempotent (unique constraint) and the cursor
 * advances transactionally with each page.
 */
export const USAGE_INGEST_QUEUE_NAME = "usage-ingest";
export const USAGE_INGEST_JOB_NAME = "ingest";
export const USAGE_PRUNE_JOB_NAME = "prune";

export interface UsageIngestJobData {
  readonly appKey: string;
}

// Let BullMQ construct its own ioredis from the URL (mirrors kpiRollup.ts).
function connection(): ConnectionOptions {
  const url = new URL(getConfig().REDIS_URL);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.password ? { password: url.password } : {}),
    maxRetriesPerRequest: null,
  };
}

export function makeUsageIngestQueue(): Queue<UsageIngestJobData> {
  return new Queue<UsageIngestJobData>(USAGE_INGEST_QUEUE_NAME, { connection: connection() });
}

/** Schedule the recurring pull (default from config, ~1 min). */
export async function scheduleUsageIngest(
  appKey: string,
  cron = getConfig().USAGE_INGEST_CRON,
): Promise<void> {
  const queue = makeUsageIngestQueue();
  const opts: JobsOptions = {
    repeat: { pattern: cron },
    jobId: `usage-ingest-${appKey}`,
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
  };
  await queue.add(USAGE_INGEST_JOB_NAME, { appKey }, opts);
}

/** Schedule the daily mirror retention prune (03:00 by default). */
export async function scheduleUsageMirrorPrune(
  appKey: string,
  cron = "0 3 * * *",
): Promise<void> {
  const queue = makeUsageIngestQueue();
  const opts: JobsOptions = {
    repeat: { pattern: cron },
    jobId: `usage-prune-${appKey}`,
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 1, // the next daily run IS the retry
  };
  await queue.add(USAGE_PRUNE_JOB_NAME, { appKey }, opts);
}

/** Start the worker handling both ingest and prune jobs. */
export function startUsageIngestWorker(): Worker<UsageIngestJobData> {
  initObservability("worker");
  const worker = new Worker<UsageIngestJobData>(
    USAGE_INGEST_QUEUE_NAME,
    async (job) =>
      withTrace(`usage-${job.name}`, async () => {
        if (job.name === USAGE_PRUNE_JOB_NAME) {
          const pruned = await runUsageMirrorPrune(job.data.appKey);
          return { pruned };
        }
        await runUsageIngest(job.data.appKey);
        return {};
      }),
    { connection: connection() },
  );
  worker.on("failed", (job, err) => {
    captureError(err, {
      queue: USAGE_INGEST_QUEUE_NAME,
      job: job?.name,
      jobId: job?.id,
      appKey: job?.data.appKey,
    });
  });
  return worker;
}
