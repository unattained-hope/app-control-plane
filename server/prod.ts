/**
 * Production entry (cp-platform-infrastructure AC9.1).
 *
 * One long-lived HTTP server hosts:
 * - React Router 7 SSR (+ tRPC / healthz / readyz resource routes)
 * - Socket.IO chat gateway (same origin as the admin UI)
 * - BullMQ workers in-process
 *
 * Built by `scripts/build-prod-server.mjs` → `build/server/prod.js`.
 * Do not use `react-router-serve` in production — it never attaches Socket.IO.
 */
import path from "node:path";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import express from "express";
import { createRequestHandler } from "@react-router/express";
import { attachChatGateway } from "~/server/realtime/chatGateway.js";
import { initObservability } from "~/lib/observability.js";
import { startKpiWorker } from "~/server/workers/kpiRollup.js";
import { startWebhookWorker } from "~/server/workers/webhookProcess.js";
import {
  scheduleComplianceSweep,
  startComplianceSweepWorker,
} from "~/server/workers/complianceSweep.js";
import { scheduleSlaSweep, startSlaWorker } from "~/server/workers/slaSweep.js";
import { scheduleOpsRollup, startOpsRollupWorker } from "~/server/workers/opsRollup.js";
import { scheduleGrowthRollup, startGrowthRollupWorker } from "~/server/workers/growthRollup.js";
import {
  scheduleUsageIngest,
  scheduleUsageMirrorPrune,
  startUsageIngestWorker,
} from "~/server/workers/usageIngest.js";
import {
  scheduleUsageRollupIncremental,
  scheduleUsageRollupFinalize,
  scheduleUsageCohort,
  scheduleUsageAlertEval,
  startUsageRollupWorker,
} from "~/server/workers/usageRollup.js";
import {
  scheduleUsageDigest,
  startUsageDigestWorker,
} from "~/server/workers/usageDigest.js";

initObservability("web");

const app = express();
app.disable("x-powered-by");

const clientDir = path.resolve("build/client");
app.use(
  "/assets",
  express.static(path.join(clientDir, "assets"), {
    immutable: true,
    maxAge: "1y",
  }),
);
app.use(express.static(clientDir));

const serverBuildUrl = pathToFileURL(
  path.resolve("build/server/index.js"),
).href;

app.all(
  "*",
  createRequestHandler({
    build: () => import(serverBuildUrl),
    mode: process.env.NODE_ENV,
  }),
);

const httpServer = createServer(app);
attachChatGateway(httpServer);

startKpiWorker();
startWebhookWorker();

startComplianceSweepWorker();
scheduleComplianceSweep("saleswitch").catch((err: unknown) => {
  console.error("Failed to schedule compliance SLA sweep:", err);
});

startSlaWorker();
scheduleSlaSweep("saleswitch").catch((err: unknown) => {
  console.error("Failed to schedule support SLA sweep:", err);
});

startOpsRollupWorker();
scheduleOpsRollup("saleswitch").catch((err: unknown) => {
  console.error("Failed to schedule ops rollup:", err);
});

startGrowthRollupWorker();
scheduleGrowthRollup("saleswitch").catch((err: unknown) => {
  console.error("Failed to schedule growth rollup:", err);
});

startUsageIngestWorker();
scheduleUsageIngest("saleswitch").catch((err: unknown) => {
  console.error("Failed to schedule usage ingest:", err);
});
scheduleUsageMirrorPrune("saleswitch").catch((err: unknown) => {
  console.error("Failed to schedule usage mirror prune:", err);
});

startUsageRollupWorker();
scheduleUsageRollupIncremental("saleswitch").catch((err: unknown) => {
  console.error("Failed to schedule usage rollup (incremental):", err);
});
scheduleUsageRollupFinalize("saleswitch").catch((err: unknown) => {
  console.error("Failed to schedule usage rollup (finalize):", err);
});
scheduleUsageCohort("saleswitch").catch((err: unknown) => {
  console.error("Failed to schedule usage cohort assignment:", err);
});
scheduleUsageAlertEval("saleswitch").catch((err: unknown) => {
  console.error("Failed to schedule usage alert eval:", err);
});

startUsageDigestWorker();
scheduleUsageDigest("saleswitch").catch((err: unknown) => {
  console.error("Failed to schedule usage weekly digest:", err);
});

const port = Number(process.env.PORT) || 3000;
httpServer.listen(port, () => {
  console.log(`Apoaap Control Plane listening on :${port}`);
});
