import { Queue, Worker, type ConnectionOptions, type JobsOptions } from "bullmq";
import { getConfig } from "~/lib/config.js";
import {
  runUsageRollupIncremental,
  runUsageRollupFinalize,
  runUsageRollupBackfill,
} from "../services/usageRollupService.js";
import { runUsageCohortAssignment } from "../services/usageCohortService.js";
import { runUsageAlertEval } from "../services/usageAlertService.js";
import { initObservability, captureError, withTrace } from "~/lib/observability.js";

/**
 * Usage-metric rollups + cohort assignment + alert eval (usage-analytics Phase 3/5). One
 * queue, five job kinds — mirrors the opsRollup multi-concern-on-one-queue idiom:
 *   • `incremental` — refresh TODAY (UTC) hourly so dashboards are same-day fresh.
 *   • `finalize`    — recompute YESTERDAY fully + the retention matrix, once daily,
 *                     correcting for ingestion lag (late-arriving mirrored events); the
 *                     finalize entry point ALSO chains the alert eval on the finalized
 *                     numbers, so the standalone `alert-eval` job below is a safety net.
 *   • `cohort`      — assign nightly per-shop cohort snapshots (append-only history).
 *   • `alert-eval`  — evaluate threshold alert rules over finalized WoW deltas (P5). A
 *                     schedule-driven SAFETY NET; the primary trigger is the finalize
 *                     chain. Runs a few minutes AFTER the finalize cron so it never reads
 *                     provisional intraday numbers.
 *   • `backfill`    — manual entry point: recompute an inclusive UTC-day range (seed
 *                     history on deploy, or correct any window on demand).
 * The rollup writes are idempotent (UsageMetricDaily upsert on the compound key), so a
 * retry after a partial failure self-heals. Alert eval is idempotent too (breach-episode
 * state makes a re-run within an episode a no-op). On failure BullMQ retries.
 */
export const USAGE_ROLLUP_QUEUE_NAME = "usage-rollup";
export const USAGE_ROLLUP_INCREMENTAL_JOB = "incremental";
export const USAGE_ROLLUP_FINALIZE_JOB = "finalize";
export const USAGE_COHORT_JOB = "cohort";
export const USAGE_ALERT_EVAL_JOB = "alert-eval";
export const USAGE_ROLLUP_BACKFILL_JOB = "backfill";

export interface UsageRollupJobData {
  readonly appKey: string;
  /** Backfill only: inclusive UTC-day range as ISO strings. */
  readonly fromISO?: string;
  readonly toISO?: string;
}

// Let BullMQ construct its own ioredis from the URL (mirrors the sibling workers).
function connection(): ConnectionOptions {
  const url = new URL(getConfig().REDIS_URL);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.password ? { password: url.password } : {}),
    maxRetriesPerRequest: null,
  };
}

export function makeUsageRollupQueue(): Queue<UsageRollupJobData> {
  return new Queue<UsageRollupJobData>(USAGE_ROLLUP_QUEUE_NAME, { connection: connection() });
}

/** Schedule the hourly incremental (today). Idempotent jobId per app. */
export async function scheduleUsageRollupIncremental(
  appKey: string,
  cron = getConfig().USAGE_ROLLUP_INCREMENTAL_CRON,
): Promise<void> {
  const queue = makeUsageRollupQueue();
  const opts: JobsOptions = {
    repeat: { pattern: cron },
    jobId: `usage-rollup-incremental-${appKey}`,
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
  };
  await queue.add(USAGE_ROLLUP_INCREMENTAL_JOB, { appKey }, opts);
}

/** Schedule the daily finalize (yesterday + retention). */
export async function scheduleUsageRollupFinalize(
  appKey: string,
  cron = getConfig().USAGE_ROLLUP_FINALIZE_CRON,
): Promise<void> {
  const queue = makeUsageRollupQueue();
  const opts: JobsOptions = {
    repeat: { pattern: cron },
    jobId: `usage-rollup-finalize-${appKey}`,
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
  };
  await queue.add(USAGE_ROLLUP_FINALIZE_JOB, { appKey }, opts);
}

/** Schedule the nightly cohort assignment. */
export async function scheduleUsageCohort(
  appKey: string,
  cron = getConfig().USAGE_COHORT_CRON,
): Promise<void> {
  const queue = makeUsageRollupQueue();
  const opts: JobsOptions = {
    repeat: { pattern: cron },
    jobId: `usage-cohort-${appKey}`,
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
  };
  await queue.add(USAGE_COHORT_JOB, { appKey }, opts);
}

/**
 * Schedule the standalone alert-eval SAFETY NET (P5). The primary trigger is the finalize
 * chain; this scheduled run (defaulting to a few minutes after the finalize cron) covers
 * the case where the chained call was skipped, and lets BullMQ retry a transient failure
 * independently. Evaluating finalized numbers is guaranteed by the cron running after
 * finalize — never against today's provisional day.
 */
export async function scheduleUsageAlertEval(
  appKey: string,
  cron = getConfig().USAGE_ALERT_EVAL_CRON,
): Promise<void> {
  const queue = makeUsageRollupQueue();
  const opts: JobsOptions = {
    repeat: { pattern: cron },
    jobId: `usage-alert-eval-${appKey}`,
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
  };
  await queue.add(USAGE_ALERT_EVAL_JOB, { appKey }, opts);
}

/**
 * Enqueue a one-off backfill over an inclusive UTC-day range. Not scheduled — call on
 * deploy (seed history) or to correct a window. The worker executes it below.
 */
export async function enqueueUsageRollupBackfill(appKey: string, from: Date, to: Date): Promise<void> {
  const queue = makeUsageRollupQueue();
  await queue.add(
    USAGE_ROLLUP_BACKFILL_JOB,
    { appKey, fromISO: from.toISOString(), toISO: to.toISOString() },
    { removeOnComplete: 100, removeOnFail: 500, attempts: 1 },
  );
}

/** Start the worker handling all four job kinds. */
export function startUsageRollupWorker(): Worker<UsageRollupJobData> {
  initObservability("worker");
  const worker = new Worker<UsageRollupJobData>(
    USAGE_ROLLUP_QUEUE_NAME,
    async (job) =>
      withTrace(`usage-rollup-${job.name}`, async () => {
        const { appKey } = job.data;
        switch (job.name) {
          case USAGE_ROLLUP_FINALIZE_JOB:
            await runUsageRollupFinalize(appKey);
            return { job: job.name };
          case USAGE_COHORT_JOB:
            await runUsageCohortAssignment(appKey);
            return { job: job.name };
          case USAGE_ALERT_EVAL_JOB:
            await runUsageAlertEval(appKey);
            return { job: job.name };
          case USAGE_ROLLUP_BACKFILL_JOB: {
            if (!job.data.fromISO || !job.data.toISO) {
              throw new Error("backfill job requires fromISO and toISO");
            }
            const days = await runUsageRollupBackfill(
              appKey,
              new Date(job.data.fromISO),
              new Date(job.data.toISO),
            );
            return { job: job.name, days };
          }
          case USAGE_ROLLUP_INCREMENTAL_JOB:
          default:
            await runUsageRollupIncremental(appKey);
            return { job: job.name };
        }
      }),
    { connection: connection() },
  );
  worker.on("failed", (job, err) => {
    captureError(err, {
      queue: USAGE_ROLLUP_QUEUE_NAME,
      job: job?.name,
      jobId: job?.id,
      appKey: job?.data.appKey,
    });
  });
  return worker;
}
