/**
 * Dev worker entry (cp-webhook-ingestion dev-parity). In production the persistent
 * `server/start.js` starts the BullMQ workers in-process; `react-router dev` does
 * NOT, so enqueued jobs would sit unprocessed locally. Run this alongside the dev
 * server: `npm run worker`.
 */
import { initObservability } from "~/lib/observability.js";
import { startKpiWorker } from "./kpiRollup.js";
import { startWebhookWorker } from "./webhookProcess.js";
import {
  scheduleComplianceSweep,
  startComplianceSweepWorker,
} from "./complianceSweep.js";
import { scheduleSlaSweep, startSlaWorker } from "./slaSweep.js";
import { scheduleOpsRollup, startOpsRollupWorker } from "./opsRollup.js";
import { scheduleGrowthRollup, startGrowthRollupWorker } from "./growthRollup.js";
import {
  scheduleUsageIngest,
  scheduleUsageMirrorPrune,
  startUsageIngestWorker,
} from "./usageIngest.js";
import {
  scheduleUsageRollupIncremental,
  scheduleUsageRollupFinalize,
  scheduleUsageCohort,
  scheduleUsageAlertEval,
  startUsageRollupWorker,
} from "./usageRollup.js";
import {
  scheduleUsageDigest,
  startUsageDigestWorker,
} from "./usageDigest.js";

initObservability("worker");
startKpiWorker();
startWebhookWorker();
startComplianceSweepWorker();
void scheduleComplianceSweep("saleswitch");
startSlaWorker();
void scheduleSlaSweep("saleswitch");
startOpsRollupWorker();
void scheduleOpsRollup("saleswitch");
startGrowthRollupWorker();
void scheduleGrowthRollup("saleswitch");
startUsageIngestWorker();
void scheduleUsageIngest("saleswitch");
void scheduleUsageMirrorPrune("saleswitch");
startUsageRollupWorker();
void scheduleUsageRollupIncremental("saleswitch");
void scheduleUsageRollupFinalize("saleswitch");
void scheduleUsageCohort("saleswitch");
void scheduleUsageAlertEval("saleswitch");
startUsageDigestWorker();
void scheduleUsageDigest("saleswitch");

// eslint-disable-next-line no-console
console.log(
  "[dev-worker] KPI + webhook workers running; compliance + SLA + ops + growth rollups + usage ingest + usage rollups/cohort/alert-eval + weekly digest scheduled.",
);
