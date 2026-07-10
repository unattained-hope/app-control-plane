import { Queue, Worker, type ConnectionOptions, type JobsOptions } from "bullmq";
import { getConfig } from "~/lib/config.js";
import { getSlaService } from "../services/slaService.js";
import { initObservability, captureError, withTrace } from "~/lib/observability.js";

/**
 * Support-desk SLA sweep (cp-inbox-sla). A repeatable BullMQ job flips open,
 * prioritized conversations to BREACHING (within the warning window) or BREACHED
 * (past due), auditing each transition as a system/job event. Mirrors the
 * complianceSweep scheduling pattern.
 */
export const SLA_SWEEP_QUEUE_NAME = "sla-sweep";
export const SLA_SWEEP_JOB_NAME = "sweep";

export interface SlaSweepJobData {
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

export function makeSlaSweepQueue(): Queue<SlaSweepJobData> {
  return new Queue<SlaSweepJobData>(SLA_SWEEP_QUEUE_NAME, { connection: connection() });
}

/** Schedule the recurring sweep (every 5 min by default). Idempotent jobId per app. */
export async function scheduleSlaSweep(
  appKey: string,
  cron = "*/5 * * * *",
): Promise<void> {
  const queue = makeSlaSweepQueue();
  const opts: JobsOptions = {
    repeat: { pattern: cron },
    jobId: `sla-sweep-${appKey}`,
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
  };
  await queue.add(SLA_SWEEP_JOB_NAME, { appKey }, opts);
}

/** Start the sweep worker. Transitions are audited inside the service. */
export function startSlaWorker(): Worker<SlaSweepJobData> {
  initObservability("worker");
  const worker = new Worker<SlaSweepJobData>(
    SLA_SWEEP_QUEUE_NAME,
    async (job) =>
      withTrace("sla-sweep", async () => {
        const result = await getSlaService().sweep(job.data.appKey);
        if (result.breached > 0 || result.breaching > 0) {
          captureError(
            new Error(
              `Support SLA: ${result.breached} breached, ${result.breaching} breaching ` +
                `conversation(s) for app ${job.data.appKey}`,
            ),
            { ...result, appKey: job.data.appKey },
          );
        }
        return result;
      }),
    { connection: connection() },
  );
  worker.on("failed", (job, err) => {
    captureError(err, { queue: SLA_SWEEP_QUEUE_NAME, jobId: job?.id });
  });
  return worker;
}
