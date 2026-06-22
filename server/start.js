// Persistent process entry (cp-platform-infrastructure AC9.1). Hosts, on ONE
// long-lived HTTP server: the RR7 request handler, the tRPC fetch endpoint, the
// Socket.IO chat gateway, and the BullMQ KPI worker. NOT serverless.
//
// In production this runs the compiled output. The tRPC + realtime + worker
// modules are imported from the server bundle; RR7 emits build/server/index.js as
// the SSR handler. The exact wiring depends on the RR7 express template — this
// file documents the persistent-process composition the deployment must preserve.
import { createServer } from "node:http";
import express from "express";
import { createRequestHandler } from "@react-router/express";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

// These resolve to the compiled server modules (paths mirror app/server/**).
import { appRouter, createContext } from "./trpc/root.js";
import { attachChatGateway } from "./realtime/chatGateway.js";
import { startKpiWorker } from "./workers/kpiRollup.js";
import { initObservability } from "./lib/observability.js";

initObservability("web");

const app = express();

// tRPC HTTP endpoint.
app.use("/trpc", async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const request = new Request(url, {
    method: req.method,
    headers: req.headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : req,
    duplex: "half",
  });
  const response = await fetchRequestHandler({
    endpoint: "/trpc",
    req: request,
    router: appRouter,
    createContext: ({ req }) => createContext(req),
  });
  res.status(response.status);
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(await response.text());
});

// React Router SSR handler + static assets.
app.use(express.static("build/client"));
app.all("*", createRequestHandler({ build: () => import("../build/server/index.js") }));

const httpServer = createServer(app);

// Socket.IO chat gateway on the same persistent server.
attachChatGateway(httpServer);

// BullMQ KPI rollup worker in-process.
startKpiWorker();

const port = process.env.PORT || 3000;
httpServer.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Apoaap Control Plane listening on :${port}`);
});
