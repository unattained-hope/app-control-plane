import { Queue, Worker, type ConnectionOptions, type JobsOptions } from "bullmq";
import { getConfig } from "~/lib/config.js";
import { runUsageWeeklyDigest } from "../services/usageDigestService.js";
import { initObservability, captureError, withTrace } from "~/lib/observability.js";

/**
 * Weekly usage digest job (cp usage-alerts-digest, usage-analytics Phase 5). A repeatable
 * BullMQ job (default: Mondays 13:00 UTC) that composes the week's headline numbers from
 * the pre-rolled metrics and delivers them via the existing notification path. No new
 * aggregation — the composer reads `UsageMetricDaily` / `UsageCohortSnapshot` deltas only.
 * Mirrors the growthRollup/opsRollup single-concern scheduling idiom. On failure BullMQ
 * retries (idempotent: composing + re-sending the same week is harmless).
 */
export const USAGE_DIGEST_QUEUE_NAME = "usage-digest";
export const USAGE_DIGEST_JOB_NAME = "weekly";

export interface UsageDigestJobData {
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

export function makeUsageDigestQueue(): Queue<UsageDigestJobData> {
  return new Queue<UsageDigestJobData>(USAGE_DIGEST_QUEUE_NAME, { connection: connection() });
}

/** Schedule the recurring weekly digest. Idempotent jobId per app. */
export async function scheduleUsageDigest(
  appKey: string,
  cron = getConfig().USAGE_DIGEST_CRON,
): Promise<void> {
  const queue = makeUsageDigestQueue();
  const opts: JobsOptions = {
    repeat: { pattern: cron },
    jobId: `usage-digest-${appKey}`,
    removeOnComplete: 20,
    removeOnFail: 100,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
  };
  await queue.add(USAGE_DIGEST_JOB_NAME, { appKey }, opts);
}

/** Start the weekly-digest worker. */
export function startUsageDigestWorker(): Worker<UsageDigestJobData> {
  initObservability("worker");
  const worker = new Worker<UsageDigestJobData>(
    USAGE_DIGEST_QUEUE_NAME,
    async (job) =>
      withTrace("usage-weekly-digest", async () => {
        await runUsageWeeklyDigest(job.data.appKey);
        return { job: job.name };
      }),
    { connection: connection() },
  );
  worker.on("failed", (job, err) => {
    captureError(err, {
      queue: USAGE_DIGEST_QUEUE_NAME,
      jobId: job?.id,
      appKey: job?.data.appKey,
    });
  });
  return worker;
}
