// test/usage-alerts.test.ts
// Threshold-alert evaluation over pre-rolled metrics (cp usage-alerts-digest, P5):
// breach-episode semantics (ONE alert per breach, ONE recovery, silent while breached),
// finalized-only windows (today's provisional day excluded), the WoW delta math per
// metric kind, and the cohort-transition path. Seeded UsageMetricDaily / UsageCohortSnapshot
// / UsageAlertRule (FakeDb) → episode transitions + delivery. No BullMQ, no real DB.
import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";
import {
  UsageAlertService,
  isBreach,
  runUsageAlertEval,
  __setUsageAlertService,
} from "~/server/services/usageAlertService.js";
import { getAuditService } from "~/server/services/auditService.js";
import { UsageMetric } from "~/lib/usageMetrics.js";

beforeAll(() => stubValidEnv());

const APP = "saleswitch";
// "Now" is 2026-07-13T06:00Z (a Monday morning). Finalized "this week" = the 7 whole UTC
// days BEFORE today = 2026-07-06..07-12; "last week" = 2026-06-29..07-05.
const NOW = new Date("2026-07-13T06:00:00.000Z");

function svc(db: FakeDb): UsageAlertService {
  return new UsageAlertService(db as never, getAuditService());
}

function seedRule(
  db: FakeDb,
  over: Partial<{
    id: string;
    key: string;
    metricKind: string;
    metric: string;
    dimension: string;
    comparison: string;
    threshold: number;
    enabled: boolean;
  }> = {},
): string {
  const id = over.id ?? `uar_${db.store.usageAlertRule.length + 1}`;
  db.store.usageAlertRule.push({
    id,
    appKey: APP,
    key: over.key ?? "rule",
    label: `Rule ${id}`,
    metricKind: over.metricKind ?? "METRIC_WOW_POINTS",
    metric: over.metric ?? UsageMetric.FUNNEL_STAGE,
    dimension: over.dimension ?? "completed",
    comparison: over.comparison ?? "DROP_GT",
    threshold: over.threshold ?? 0.1,
    enabled: over.enabled ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

function seedMetric(db: FakeDb, date: string, metric: string, dimension: string, value: number): void {
  db.store.usageMetricDaily.push({
    id: `umd_${db.store.usageMetricDaily.length + 1}`,
    appKey: APP,
    date: new Date(date),
    metric,
    dimension,
    value,
    createdAt: new Date(date),
    updatedAt: new Date(date),
  });
}

function seedCohort(db: FakeDb, shop: string, lifecycle: string, computedAt: string): void {
  db.store.usageCohortSnapshot.push({
    id: `ucs_${db.store.usageCohortSnapshot.length + 1}`,
    appKey: APP,
    shop,
    lifecycle,
    intensity: "REGULAR",
    personaTags: [],
    activityScore: 1,
    computedAt: new Date(computedAt),
    createdAt: new Date(computedAt),
  });
}

/** A WoW completion DROP: this week (avg) far below last week, exceeding 0.1 points. */
function seedFunnelDrop(db: FakeDb): void {
  // last week: completed conversion ~0.5
  seedMetric(db, "2026-06-30", UsageMetric.FUNNEL_STAGE, "completed", 0.5);
  seedMetric(db, "2026-07-02", UsageMetric.FUNNEL_STAGE, "completed", 0.5);
  // this week: ~0.2 → delta = 0.2 - 0.5 = -0.3 → drop of 0.3 > threshold 0.1 ⇒ breach.
  seedMetric(db, "2026-07-07", UsageMetric.FUNNEL_STAGE, "completed", 0.2);
  seedMetric(db, "2026-07-09", UsageMetric.FUNNEL_STAGE, "completed", 0.2);
}

/** A recovered week: this week back to ~0.5 (delta ~0 → within threshold). */
function seedFunnelRecovered(db: FakeDb): void {
  db.store.usageMetricDaily.length = 0; // replace the metric rows
  seedMetric(db, "2026-06-30", UsageMetric.FUNNEL_STAGE, "completed", 0.5);
  seedMetric(db, "2026-07-07", UsageMetric.FUNNEL_STAGE, "completed", 0.5);
}

describe("isBreach (pure)", () => {
  it("DROP_GT breaches on a decline larger than the threshold", () => {
    expect(isBreach("DROP_GT", -0.3, 0.1)).toBe(true); // dropped 0.3 > 0.1
    expect(isBreach("DROP_GT", -0.05, 0.1)).toBe(false); // small drop
    expect(isBreach("DROP_GT", 0.2, 0.1)).toBe(false); // a RISE never breaches a DROP rule
  });
  it("RISE_GT breaches on a spike larger than the threshold", () => {
    expect(isBreach("RISE_GT", 0.3, 0.25)).toBe(true);
    expect(isBreach("RISE_GT", 0.1, 0.25)).toBe(false);
    expect(isBreach("RISE_GT", -0.3, 0.25)).toBe(false);
  });
});

describe("UsageAlertService.evaluate — breach episode semantics", () => {
  it("fires exactly ONE alert on OK→BREACHED and stays silent while breached", async () => {
    const db = new FakeDb();
    seedRule(db, { key: "wizard-drop", threshold: 0.1 });
    seedFunnelDrop(db);

    const first = await svc(db).evaluate(APP, NOW);
    expect(first.alertsFired).toBe(1);
    expect(first.evaluations[0]!.action).toBe("alert");
    expect(db.store.auditLog.filter((a) => a.action === "usage.alert.fired")).toHaveLength(1);

    // Re-evaluate the SAME still-breached condition four more times → no new alerts.
    for (let i = 0; i < 4; i += 1) {
      const again = await svc(db).evaluate(APP, NOW);
      expect(again.alertsFired).toBe(0);
      expect(again.evaluations[0]!.action).toBe("none");
    }
    expect(db.store.auditLog.filter((a) => a.action === "usage.alert.fired")).toHaveLength(1);
    // Episode state persisted as BREACHED.
    expect(db.store.usageAlertState).toHaveLength(1);
    expect(db.store.usageAlertState[0]!.state).toBe("BREACHED");
  });

  it("fires exactly ONE recovery notice on BREACHED→OK, then stays silent", async () => {
    const db = new FakeDb();
    const ruleId = seedRule(db, { key: "wizard-drop", threshold: 0.1 });
    seedFunnelDrop(db);
    await svc(db).evaluate(APP, NOW); // open the episode (BREACHED)
    expect(db.store.usageAlertState[0]!.state).toBe("BREACHED");

    // Condition recovers.
    seedFunnelRecovered(db);
    const recovered = await svc(db).evaluate(APP, NOW);
    expect(recovered.recoveriesFired).toBe(1);
    expect(recovered.evaluations[0]!.action).toBe("recovery");
    expect(db.store.auditLog.filter((a) => a.action === "usage.alert.recovered")).toHaveLength(1);
    expect(db.store.usageAlertState.find((s) => s.ruleId === ruleId)!.state).toBe("OK");
    expect(db.store.usageAlertState.find((s) => s.ruleId === ruleId)!.breachedAt).toBeNull();

    // Still OK next run → silent.
    const stillOk = await svc(db).evaluate(APP, NOW);
    expect(stillOk.recoveriesFired).toBe(0);
    expect(stillOk.evaluations[0]!.action).toBe("none");
  });

  it("only evaluates ENABLED rules", async () => {
    const db = new FakeDb();
    seedRule(db, { key: "disabled-rule", enabled: false });
    seedFunnelDrop(db);
    const res = await svc(db).evaluate(APP, NOW);
    expect(res.evaluatedRules).toBe(0);
    expect(res.alertsFired).toBe(0);
  });
});

describe("UsageAlertService.evaluate — finalized-only windows", () => {
  it("ignores today's provisional day (only finalized days count)", async () => {
    const db = new FakeDb();
    seedRule(db, { key: "wizard-drop", threshold: 0.1 });
    // Finalized weeks look healthy (no drop).
    seedMetric(db, "2026-06-30", UsageMetric.FUNNEL_STAGE, "completed", 0.5);
    seedMetric(db, "2026-07-07", UsageMetric.FUNNEL_STAGE, "completed", 0.5);
    // A catastrophic value on TODAY (2026-07-13) must NOT be read — it's provisional.
    seedMetric(db, "2026-07-13", UsageMetric.FUNNEL_STAGE, "completed", 0.0);

    const res = await svc(db).evaluate(APP, NOW);
    expect(res.alertsFired).toBe(0); // today's crash was excluded → no breach
    expect(res.evaluations[0]!.breached).toBe(false);
  });
});

describe("UsageAlertService.evaluate — metric kinds", () => {
  it("METRIC_WOW_PERCENT computes a signed fraction and breaches on a drop", async () => {
    const db = new FakeDb();
    seedRule(db, {
      key: "wau-drop",
      metricKind: "METRIC_WOW_PERCENT",
      metric: UsageMetric.WAU,
      dimension: "",
      comparison: "DROP_GT",
      threshold: 0.2,
    });
    seedMetric(db, "2026-06-30", UsageMetric.WAU, "", 100);
    seedMetric(db, "2026-07-07", UsageMetric.WAU, "", 70); // -30% > 20% drop ⇒ breach
    const res = await svc(db).evaluate(APP, NOW);
    expect(res.alertsFired).toBe(1);
    expect(res.evaluations[0]!.observed).toBeCloseTo(-0.3, 5);
  });

  it("COHORT_TRANSITION counts lifecycle entries WoW and breaches on a spike", async () => {
    const db = new FakeDb();
    seedRule(db, {
      key: "dormant-spike",
      metricKind: "COHORT_TRANSITION",
      metric: "DORMANT",
      dimension: "",
      comparison: "RISE_GT",
      threshold: 1, // more than +1 DORMANT shop WoW
    });
    // Last week's newest run: 1 DORMANT shop.
    seedCohort(db, "a.myshopify.com", "DORMANT", "2026-07-01T02:00:00Z");
    seedCohort(db, "b.myshopify.com", "ENGAGED", "2026-07-01T02:00:00Z");
    // This week's newest run: 3 DORMANT shops → delta +2 > threshold 1 ⇒ breach.
    seedCohort(db, "a.myshopify.com", "DORMANT", "2026-07-10T02:00:00Z");
    seedCohort(db, "b.myshopify.com", "DORMANT", "2026-07-10T02:00:00Z");
    seedCohort(db, "c.myshopify.com", "DORMANT", "2026-07-10T02:00:00Z");

    const res = await svc(db).evaluate(APP, NOW);
    expect(res.evaluations[0]!.observed).toBe(2); // 3 this week − 1 last week
    expect(res.alertsFired).toBe(1);
  });
});

describe("runUsageAlertEval (worker entry, via the singleton seam)", () => {
  it("evaluates through the singleton without throwing", async () => {
    const db = new FakeDb();
    seedRule(db, { key: "wizard-drop", threshold: 0.1 });
    seedFunnelDrop(db);
    __setUsageAlertService(svc(db));
    await expect(runUsageAlertEval(APP, NOW)).resolves.toBeUndefined();
    __setUsageAlertService(null);
    expect(db.store.auditLog.some((a) => a.action === "usage.alert.fired")).toBe(true);
  });
});
