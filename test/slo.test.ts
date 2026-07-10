import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => stubValidEnv());

const { SloService } = await import("~/server/services/sloService.js");
const { getAuditService } = await import("~/server/services/auditService.js");

const METRIC = "ops.slo.webhook_error_ratio";
const NOW = new Date("2026-06-28T12:00:00.000Z");

function makeSvc(db: FakeDb) {
  return new SloService(db as never, getAuditService());
}

/** Seed an error-ratio sample `minutes` ago. */
function sample(db: FakeDb, minutesAgo: number, value: number) {
  db.store.kpiSnapshot.push({
    id: `kpi_${minutesAgo}_${value}`,
    appKey: "saleswitch",
    metric: METRIC,
    value,
    asOf: new Date(NOW.getTime() - minutesAgo * 60_000),
  });
}

/** cp-slo-alerting — multiwindow multi-burn-rate evaluation. */
describe("SloService", () => {
  it("fires a page when both windows sustain a high burn, and audits it", async () => {
    const db = new FakeDb();
    // High error ratio across the last few minutes → both short (5m) and long (60m)
    // windows are far over budget (0.1% budget; ratio 0.5 ⇒ burn 500).
    sample(db, 1, 0.5);
    sample(db, 2, 0.5);
    sample(db, 3, 0.5);

    const alerts = await makeSvc(db).evaluate("saleswitch", NOW);

    const page = alerts.find((a) => a.severity === "page");
    expect(page).toBeTruthy();
    expect(page!.sloId).toBe("webhook_delivery");
    expect(db.store.auditLog.some((a) => a.action === "slo.alert.fired")).toBe(true);
  });

  it("does not page on a short-window-only blip (long window within budget)", async () => {
    const db = new FakeDb();
    // One small spike in the short window, diluted by many clean samples in the long
    // window → short burn high, long burn under the page multipliers.
    sample(db, 0.5, 0.1);
    for (let m = 3; m <= 60; m += 3) sample(db, m, 0);

    const alerts = await makeSvc(db).evaluate("saleswitch", NOW);

    expect(alerts.some((a) => a.severity === "page")).toBe(false);
  });

  it("is quiet when error rate is within budget", async () => {
    const db = new FakeDb();
    for (let m = 1; m <= 60; m += 5) sample(db, m, 0);

    const alerts = await makeSvc(db).evaluate("saleswitch", NOW);

    expect(alerts).toHaveLength(0);
    expect(db.store.auditLog.some((a) => a.action === "slo.alert.fired")).toBe(false);
  });

  it("skips an SLO with no samples (e.g. externally-fed availability)", async () => {
    const db = new FakeDb();
    // Only webhook samples exist; request_availability has none → not evaluated.
    sample(db, 1, 0);
    const alerts = await makeSvc(db).evaluate("saleswitch", NOW);
    expect(alerts.every((a) => a.sloId !== "request_availability")).toBe(true);
  });
});
