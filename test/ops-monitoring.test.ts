import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => {
  stubValidEnv();
  process.env.METRICS_AUTH_TOKEN = "scrape-secret";
});

const { OpsMetricsService, classifyLiveness, MONITORED_QUEUES } = await import(
  "~/server/services/opsMetricsService.js"
);
const { ComplianceService } = await import("~/server/services/complianceService.js");

const WINDOW_MS = 15 * 60_000;

interface StatOver {
  name: string;
  waiting?: number;
  active?: number;
  completed?: number;
  failed?: number;
  delayed?: number;
  lastCompletedAt?: number | null;
}

function stat(over: StatOver) {
  return {
    name: over.name,
    waiting: over.waiting ?? 0,
    active: over.active ?? 0,
    completed: over.completed ?? 0,
    failed: over.failed ?? 0,
    delayed: over.delayed ?? 0,
    lastCompletedAt: over.lastCompletedAt ?? null,
  };
}

function makeSvc(db: FakeDb, stats: Record<string, ReturnType<typeof stat>>) {
  const provider = async (name: string) =>
    stats[name] ?? stat({ name });
  return new OpsMetricsService(db as never, provider, new ComplianceService(db as never));
}

/** cp-ops-monitoring — liveness classification, Prometheus output, rollup. */
describe("ops monitoring", () => {
  it("classifies worker liveness (idle / healthy / stale)", () => {
    const now = 1_000_000_000;
    expect(classifyLiveness(stat({ name: "q" }), now, WINDOW_MS)).toBe("idle");
    expect(
      classifyLiveness(stat({ name: "q", completed: 5, lastCompletedAt: now - 60_000 }), now, WINDOW_MS),
    ).toBe("healthy");
    // Backlog but last completion is older than the window → stale.
    expect(
      classifyLiveness(
        stat({ name: "q", waiting: 3, completed: 5, lastCompletedAt: now - WINDOW_MS - 1 }),
        now,
        WINDOW_MS,
      ),
    ).toBe("stale");
  });

  it("renders Prometheus with bullmq_job_count + gauges and no PII", async () => {
    const db = new FakeDb();
    db.store.webhookEvent.push({ id: "w1", appKey: "saleswitch", shop: "aurora@secret.com", status: "FAILED" });
    const svc = makeSvc(db, {
      "webhook-process": stat({ name: "webhook-process", waiting: 2, failed: 3 }),
    });

    const text = await svc.prometheus("saleswitch");

    expect(text).toContain('bullmq_job_count{queue="webhook-process", state="failed"} 3');
    expect(text).toContain('control_plane_webhook_failed{app="saleswitch"} 1');
    // No merchant PII leaks into the scrape payload.
    expect(text).not.toContain("@");
    expect(text).not.toContain("aurora");
  });

  it("collectGauges counts FAILED + DEAD_LETTER webhooks and breaching DSRs", async () => {
    const db = new FakeDb();
    const wh = { appKey: "saleswitch", shop: null };
    db.store.webhookEvent.push({ id: "a", ...wh, status: "FAILED" });
    db.store.webhookEvent.push({ id: "b", ...wh, status: "DEAD_LETTER" });
    db.store.webhookEvent.push({ id: "c", ...wh, status: "PROCESSED" });

    const svc = makeSvc(db, {});
    const g = await svc.collectGauges("saleswitch");
    expect(g.webhookFailed).toBe(1);
    expect(g.webhookDeadLetter).toBe(1);
    expect(g.complianceBreaching).toBe(0);
  });

  it("collectGauges reports usage-ingest lag in seconds (-1 when never ingested)", async () => {
    const db = new FakeDb();
    const now = new Date("2026-07-11T00:05:00Z");
    // No usage events yet → -1.
    const svc = makeSvc(db, {});
    expect((await svc.collectGauges("saleswitch", now)).usageIngestLagSeconds).toBe(-1);

    // Newest event 5 min ago → 300s lag; other-app events don't count.
    db.store.usageEvent.push({
      id: "u1",
      appKey: "saleswitch",
      occurredAt: new Date("2026-07-11T00:00:00Z"),
    });
    db.store.usageEvent.push({
      id: "u2",
      appKey: "otherapp",
      occurredAt: new Date("2026-07-11T00:04:59Z"),
    });
    const g = await svc.collectGauges("saleswitch", now);
    expect(g.usageIngestLagSeconds).toBe(300);
  });

  it("runRollup persists ops KpiSnapshot rows (incl. the SLO error-ratio sample)", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db, {});
    const written = await svc.runRollup("saleswitch");

    expect(written).toBeGreaterThan(0);
    expect(db.store.kpiSnapshot.length).toBe(written);
    const metrics = db.store.kpiSnapshot.map((r) => r.metric);
    expect(metrics).toContain("ops.webhook.dead_letter");
    expect(metrics).toContain("ops.slo.webhook_error_ratio");
    // A snapshot exists for every monitored queue's failed count.
    for (const q of MONITORED_QUEUES) {
      expect(metrics).toContain(`ops.queue.failed.${q}`);
    }
  });
});

/** cp-ops-monitoring — the /metrics route is token-guarded. */
describe("/metrics route", () => {
  it("rejects a request with no bearer token", async () => {
    const { loader } = await import("~/routes/metrics.js");
    const res = await loader({ request: new Request("http://x/metrics") } as never);
    expect((res as Response).status).toBe(401);
  });

  it("rejects a request with the wrong bearer token", async () => {
    const { loader } = await import("~/routes/metrics.js");
    const res = await loader({
      request: new Request("http://x/metrics", { headers: { authorization: "Bearer wrong" } }),
    } as never);
    expect((res as Response).status).toBe(401);
  });
});
