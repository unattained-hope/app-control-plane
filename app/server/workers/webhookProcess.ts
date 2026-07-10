import { Queue, Worker, type ConnectionOptions, type JobsOptions } from "bullmq";
import { getConfig } from "~/lib/config.js";
import { getDb } from "../db.js";
import { processWebhookEvent } from "../services/webhookProcessor.js";
import { getWebhookService } from "../services/webhookService.js";
import { initObservability, captureError, withTrace } from "~/lib/observability.js";

/**
 * Webhook-processing job (cp-webhook-ingestion + cp-webhook-reliability). The
 * ingestion route returns 200 fast and enqueues here; ALL real work (compliance
 * upsert, billing KPI deltas) happens in this worker. At-least-once durability:
 * each run increments `attempts`/`lastAttemptAt`; a transient failure marks the
 * event FAILED and retries with CAPPED exponential backoff; on exhausting
 * `WEBHOOK_MAX_ATTEMPTS` the event is moved to the terminal DEAD_LETTER state and a
 * `webhook.dead_lettered` audit row is written (SYSTEM/JOB). DEAD_LETTER events are
 * never auto-retried — only an audited manual replay re-enqueues them.
 */
export const WEBHOOK_QUEUE_NAME = "webhook-process";
export const WEBHOOK_JOB_NAME = "process";
const WEBHOOK_BASE_BACKOFF_MS = 5_000;

export interface WebhookJobData {
  readonly webhookEventId: string;
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

let queue: Queue<WebhookJobData> | null = null;
function getQueue(): Queue<WebhookJobData> {
  if (!queue) queue = new Queue<WebhookJobData>(WEBHOOK_QUEUE_NAME, { connection: connection() });
  return queue;
}

/** Enqueue one webhook event for processing (called by the ingestion route). */
export async function enqueueWebhook(webhookEventId: string): Promise<void> {
  const opts: JobsOptions = {
    jobId: webhookEventId, // one job per event — extra-safe against double enqueue
    removeOnComplete: 1000,
    removeOnFail: 5000,
    attempts: getConfig().WEBHOOK_MAX_ATTEMPTS,
    // Custom strategy (capped on the worker) instead of plain exponential so the
    // backoff never grows past WEBHOOK_BACKOFF_CEILING_MS.
    backoff: { type: "custom" },
  };
  await getQueue().add(WEBHOOK_JOB_NAME, { webhookEventId }, opts);
}

/**
 * Re-enqueue a previously dead-lettered (or failed) event for reprocessing. Removes
 * any lingering job with the same id first (the jobId === eventId would otherwise be
 * rejected as a duplicate), then enqueues fresh. Called by an audited ADMIN replay.
 */
export async function reenqueueWebhook(webhookEventId: string): Promise<void> {
  const existing = await getQueue().getJob(webhookEventId);
  if (existing) await existing.remove();
  await enqueueWebhook(webhookEventId);
}

/** Start the worker (called from the persistent process / worker entry). */
export function startWebhookWorker(): Worker<WebhookJobData> {
  initObservability("worker");
  const ceiling = getConfig().WEBHOOK_BACKOFF_CEILING_MS;
  const worker = new Worker<WebhookJobData>(
    WEBHOOK_QUEUE_NAME,
    async (job) =>
      withTrace("webhook-process", async () => {
        const db = getDb();
        const event = await db.webhookEvent.findUnique({
          where: { id: job.data.webhookEventId },
        });
        if (!event) return; // event row gone — nothing to do
        // Track the processing attempt before doing the work.
        await db.webhookEvent.update({
          where: { id: event.id },
          data: { attempts: { increment: 1 }, lastAttemptAt: new Date() },
        });
        await processWebhookEvent(event);
        await db.webhookEvent.update({
          where: { id: event.id },
          data: { status: "PROCESSED", processedAt: new Date() },
        });
      }),
    {
      connection: connection(),
      settings: {
        // Capped exponential: 5s, 10s, 20s, … never exceeding the configured ceiling.
        backoffStrategy: (attemptsMade: number) =>
          Math.min(ceiling, WEBHOOK_BASE_BACKOFF_MS * 2 ** Math.max(0, attemptsMade - 1)),
      },
    },
  );
  worker.on("failed", (job, err) => {
    captureError(err, { queue: WEBHOOK_QUEUE_NAME, jobId: job?.id });
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? getConfig().WEBHOOK_MAX_ATTEMPTS;
    const exhausted = job.attemptsMade >= maxAttempts;
    const svc = getWebhookService();
    if (exhausted) {
      // Terminal: dead-letter + audit. Never auto-retried again.
      void svc
        .deadLetter(job.data.webhookEventId, err)
        .catch((e) => captureError(e, { where: "webhookProcess.deadLetter" }));
    } else {
      // Transient: mark FAILED so the failed-delivery view shows in-flight failures;
      // BullMQ will retry on the capped backoff.
      void svc
        .markFailedTransient(job.data.webhookEventId, err)
        .catch((e) => captureError(e, { where: "webhookProcess.markFailed" }));
    }
  });
  return worker;
}
