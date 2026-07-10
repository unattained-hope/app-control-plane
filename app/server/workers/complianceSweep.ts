import { Queue, Worker, type ConnectionOptions, type JobsOptions } from "bullmq";
import { getConfig } from "~/lib/config.js";
import { getComplianceService } from "../services/complianceService.js";
import { initObservability, captureError, withTrace } from "~/lib/observability.js";

/**
 * GDPR/DSR SLA sweep (cp-compliance-dsr). A repeatable BullMQ job flags open
 * compliance requests within N days of (or past) their 30-day `dueAt` so they are
 * surfaced before they breach. Mirrors the kpiRollup scheduling pattern.
 */
export const COMPLIANCE_SWEEP_QUEUE_NAME = "compliance-sweep";
export const COMPLIANCE_SWEEP_JOB_NAME = "sweep";

export interface ComplianceSweepJobData {
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

export function makeComplianceSweepQueue(): Queue<ComplianceSweepJobData> {
  return new Queue<ComplianceSweepJobData>(COMPLIANCE_SWEEP_QUEUE_NAME, {
    connection: connection(),
  });
}

/** Schedule the recurring sweep (hourly by default). Idempotent jobId per app. */
export async function scheduleComplianceSweep(
  appKey: string,
  cron = "0 * * * *",
): Promise<void> {
  const queue = makeComplianceSweepQueue();
  const opts: JobsOptions = {
    repeat: { pattern: cron },
    jobId: `compliance-sweep-${appKey}`,
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
  };
  await queue.add(COMPLIANCE_SWEEP_JOB_NAME, { appKey }, opts);
}

/** Start the sweep worker. Surfaces breaching requests via structured logs/alerts. */
export function startComplianceSweepWorker(): Worker<ComplianceSweepJobData> {
  initObservability("worker");
  const worker = new Worker<ComplianceSweepJobData>(
    COMPLIANCE_SWEEP_QUEUE_NAME,
    async (job) =>
      withTrace("compliance-sweep", async () => {
        const breaching = await getComplianceService().listBreaching(job.data.appKey);
        if (breaching.length > 0) {
          // Surface to ops. With a Sentry DSN this becomes a captured alert; without
          // one, captureError's structured-log fallback keeps it visible.
          captureError(
            new Error(
              `GDPR/DSR SLA: ${breaching.length} request(s) approaching/past due for ` +
                `app ${job.data.appKey}`,
            ),
            { breaching: breaching.map((b) => ({ id: b.id, shop: b.shop, dueAt: b.dueAt })) },
          );
        }
        return { breaching: breaching.length };
      }),
    { connection: connection() },
  );
  worker.on("failed", (job, err) => {
    captureError(err, { queue: COMPLIANCE_SWEEP_QUEUE_NAME, jobId: job?.id });
  });
  return worker;
}
