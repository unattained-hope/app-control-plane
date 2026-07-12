// test/usage-digest.test.ts
// Weekly usage digest (cp usage-alerts-digest, P5): delta math against seeded metrics
// (WAU/MAU movers, biggest funnel move, top/bottom adoption movers, cohort transitions),
// and graceful rendering in the first weeks when last-week data is missing. Reads only
// pre-rolled UsageMetricDaily / UsageCohortSnapshot rows (FakeDb) — no raw events.
import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";
import {
  UsageDigestService,
  runUsageWeeklyDigest,
  __setUsageDigestService,
} from "~/server/services/usageDigestService.js";
import { UsageMetric } from "~/lib/usageMetrics.js";

beforeAll(() => stubValidEnv());

const APP = "saleswitch";
// Monday 2026-07-13; this week = 2026-07-06..07-12, last week = 2026-06-29..07-05.
const NOW = new Date("2026-07-13T06:00:00.000Z");

function svc(db: FakeDb): UsageDigestService {
  return new UsageDigestService(db as never);
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

describe("UsageDigestService.compose — delta math", () => {
  it("computes WAU/MAU movers, biggest funnel move, and adoption movers", async () => {
    const db = new FakeDb();
    // WAU: last week avg 100, this week avg 120 → +20.
    seedMetric(db, "2026-06-30", UsageMetric.WAU, "", 100);
    seedMetric(db, "2026-07-07", UsageMetric.WAU, "", 120);
    // MAU: last week 300, this week 330 → +30.
    seedMetric(db, "2026-06-30", UsageMetric.MAU, "", 300);
    seedMetric(db, "2026-07-07", UsageMetric.MAU, "", 330);
    // Funnel stage `completed` reach: last week sum 10, this week sum 40 → +30 (biggest).
    seedMetric(db, "2026-06-30", UsageMetric.FUNNEL_STAGE, "completed", 10);
    seedMetric(db, "2026-07-07", UsageMetric.FUNNEL_STAGE, "completed", 40);
    // Funnel stage `started`: last 100, this 105 → +5 (smaller move).
    seedMetric(db, "2026-06-30", UsageMetric.FUNNEL_STAGE, "started", 100);
    seedMetric(db, "2026-07-07", UsageMetric.FUNNEL_STAGE, "started", 105);
    // Adoption: badges up (2→9 → +7 top), banner down (8→3 → -5 bottom).
    seedMetric(db, "2026-06-30", UsageMetric.ADOPTION_D30, "badges", 2);
    seedMetric(db, "2026-07-07", UsageMetric.ADOPTION_D30, "badges", 9);
    seedMetric(db, "2026-06-30", UsageMetric.ADOPTION_D30, "banner", 8);
    seedMetric(db, "2026-07-07", UsageMetric.ADOPTION_D30, "banner", 3);

    const d = await svc(db).compose(APP, NOW);

    expect(d.missingLastWeek).toBe(false);
    expect(d.wau.delta).toBe(20);
    expect(d.mau.delta).toBe(30);
    expect(d.biggestFunnelMove?.name).toBe("completed");
    expect(d.biggestFunnelMove?.delta).toBe(30);
    expect(d.topAdoptionMovers[0]).toMatchObject({ name: "badges", delta: 7 });
    expect(d.bottomAdoptionMovers[0]).toMatchObject({ name: "banner", delta: -5 });
    expect(d.weekStart).toBe("2026-07-06");
    expect(d.body).toContain("Weekly usage digest");
    expect(d.body).toContain("badges");
  });

  it("counts cohort transitions from the newest run in each week", async () => {
    const db = new FakeDb();
    // Last week newest run: 1 DORMANT. This week newest run: 3 DORMANT → +2 entering.
    seedCohort(db, "a.myshopify.com", "DORMANT", "2026-07-01T02:00:00Z");
    seedCohort(db, "a.myshopify.com", "DORMANT", "2026-07-10T02:00:00Z");
    seedCohort(db, "b.myshopify.com", "DORMANT", "2026-07-10T02:00:00Z");
    seedCohort(db, "c.myshopify.com", "DORMANT", "2026-07-10T02:00:00Z");

    const d = await svc(db).compose(APP, NOW);
    const dormant = d.cohortTransitions.find((t) => t.name === "DORMANT")!;
    expect(dormant.thisWeek).toBe(3);
    expect(dormant.lastWeek).toBe(1);
    expect(dormant.delta).toBe(2);
  });
});

describe("UsageDigestService.compose — missing last week (first weeks)", () => {
  it("renders gracefully with null deltas when there is no prior week", async () => {
    const db = new FakeDb();
    // Only THIS week has data.
    seedMetric(db, "2026-07-07", UsageMetric.WAU, "", 42);
    seedMetric(db, "2026-07-08", UsageMetric.ADOPTION_D30, "badges", 5);

    const d = await svc(db).compose(APP, NOW);
    expect(d.missingLastWeek).toBe(true);
    expect(d.wau.thisWeek).toBe(42);
    expect(d.wau.delta).toBeNull(); // no prior week ⇒ no delta
    // No positive/negative movers when deltas are unknown (delta null sorts out).
    expect(d.topAdoptionMovers).toHaveLength(0);
    expect(d.bottomAdoptionMovers).toHaveLength(0);
    // Body still renders and states the first-week caveat.
    expect(d.body).toContain("First full week of history");
    expect(d.body).toContain("no prior week");
  });

  it("handles a completely empty week without throwing", async () => {
    const db = new FakeDb();
    const d = await svc(db).compose(APP, NOW);
    expect(d.missingLastWeek).toBe(true);
    expect(d.wau.thisWeek).toBe(0);
    expect(d.biggestFunnelMove).toBeNull();
    expect(d.body).toContain("No funnel movement to report");
  });
});

describe("runUsageWeeklyDigest (worker entry, via the singleton seam)", () => {
  it("composes + delivers through the singleton without throwing", async () => {
    const db = new FakeDb();
    seedMetric(db, "2026-07-07", UsageMetric.WAU, "", 10);
    __setUsageDigestService(svc(db));
    await expect(runUsageWeeklyDigest(APP, NOW)).resolves.toBeUndefined();
    __setUsageDigestService(null);
  });
});
