import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => stubValidEnv());

const { UsageReadService } = await import("~/server/services/usageReadService.js");
const { usageRouter } = await import("~/server/trpc/routers/usage.js");
const { __setUsageReadService } = await import("~/server/services/usageReadService.js");
const { defineAbilityFor } = await import("~/server/rbac.js");
const { UsageMetric, KPI_USAGE_METRICS } = await import("~/lib/usageMetrics.js");

const APP = "saleswitch";
const D = (s: string) => new Date(s);

/** Seed a UsageMetricDaily row into the fake store. */
function metric(
  db: FakeDb,
  date: string,
  m: string,
  dimension: string,
  value: number,
  updatedAt = date,
): void {
  db.store.usageMetricDaily.push({
    id: `umd_${db.store.usageMetricDaily.length + 1}`,
    appKey: APP,
    date: D(date),
    metric: m,
    dimension,
    value,
    createdAt: D(date),
    updatedAt: D(updatedAt),
  });
}

function kpi(db: FakeDb, m: string, value: number, asOf: string): void {
  db.store.kpiSnapshot.push({
    id: `kpi_${db.store.kpiSnapshot.length + 1}`,
    appKey: APP,
    metric: m,
    value,
    asOf: D(asOf),
    createdAt: D(asOf),
  });
}

function cohort(
  db: FakeDb,
  shop: string,
  lifecycle: string,
  intensity: string,
  personaTags: string[],
  activityScore: number,
  computedAt: string,
): void {
  db.store.usageCohortSnapshot.push({
    id: `ucs_${db.store.usageCohortSnapshot.length + 1}`,
    appKey: APP,
    shop,
    lifecycle,
    intensity,
    personaTags,
    activityScore,
    computedAt: D(computedAt),
    createdAt: D(computedAt),
  });
}

function event(
  db: FakeDb,
  shopDomain: string,
  seq: bigint,
  name: string,
  occurredAt: string,
  impersonated = false,
  properties: unknown = null,
): void {
  db.store.usageEvent.push({
    id: `ue_${db.store.usageEvent.length + 1}`,
    appKey: APP,
    sourceEventId: `src_${seq}`,
    sourceSeq: seq,
    shopDomain,
    userId: null,
    name,
    category: "wizard",
    source: "app",
    properties,
    impersonated,
    occurredAt: D(occurredAt),
    ingestedAt: D(occurredAt),
  });
}

function svc(db: FakeDb) {
  return new UsageReadService(db as never);
}

// ── RBAC: every usage procedure is `view`-gated and read-only ─────────────────

describe("usage router RBAC + surface", () => {
  it("gates every procedure on the `view` ability (VIEWER passes)", () => {
    // Structurally assert the router exposes exactly the five read procedures and no
    // mutation. tRPC procedures carry their type in `_def`.
    const defs = usageRouter._def.procedures as Record<
      string,
      { _def: { type?: string; query?: boolean; mutation?: boolean } }
    >;
    const names = Object.keys(defs).sort();
    expect(names).toEqual(["activity", "features", "funnel", "overview", "shops"]);
    for (const name of names) {
      const type = defs[name]!._def.type ?? (defs[name]!._def.mutation ? "mutation" : "query");
      expect(type, `${name} must be a query`).not.toBe("mutation");
    }
  });

  it("VIEWER has the `view` ability the procedures require (SUPPORT/ADMIN too)", () => {
    expect(defineAbilityFor("VIEWER").can("view", "all")).toBe(true);
    expect(defineAbilityFor("SUPPORT").can("view", "all")).toBe(true);
    expect(defineAbilityFor("ADMIN").can("view", "all")).toBe(true);
  });
});

// ── overview ──────────────────────────────────────────────────────────────────

describe("UsageReadService.overview", () => {
  it("serves tiles/trend/top-actions/funnel from snapshot rows only", async () => {
    const db = new FakeDb();
    // Headline KPIs (latest per metric wins).
    kpi(db, KPI_USAGE_METRICS.WAU, 40, "2026-07-10T00:00:00Z");
    kpi(db, KPI_USAGE_METRICS.WAU, 42, "2026-07-11T00:00:00Z"); // newer → used
    kpi(db, KPI_USAGE_METRICS.MAU, 120, "2026-07-11T00:00:00Z");
    kpi(db, KPI_USAGE_METRICS.EVENTS_PER_DAY, 500, "2026-07-11T00:00:00Z");
    // DAU + MAU metric rows on the latest day → stickiness = 30/120 = 0.25.
    metric(db, "2026-07-11", UsageMetric.DAU, "", 30);
    metric(db, "2026-07-11", UsageMetric.MAU, "", 120);
    // WAU daily series (active-shops trend).
    metric(db, "2026-07-09", UsageMetric.WAU, "", 38);
    metric(db, "2026-07-10", UsageMetric.WAU, "", 40);
    metric(db, "2026-07-11", UsageMetric.WAU, "", 42);
    // Top actions on the latest day.
    metric(db, "2026-07-11", UsageMetric.ACTION_COUNT, "wizard_started", 12);
    metric(db, "2026-07-11", UsageMetric.ACTION_COUNT, "campaign_activated", 7);
    // Latest cohort run → activation funnel from lifecycle distribution.
    cohort(db, "a.myshopify.com", "ENGAGED", "POWER", [], 20, "2026-07-11T02:00:00Z");
    cohort(db, "b.myshopify.com", "ACTIVATED", "REGULAR", [], 8, "2026-07-11T02:00:00Z");
    cohort(db, "c.myshopify.com", "ONBOARDING", "LIGHT", [], 1, "2026-07-11T02:00:00Z");

    const out = await svc(db).overview(APP, D("2026-07-12T09:00:00Z"));

    const tiles = new Map(out.tiles.map((t) => [t.key, t]));
    expect(tiles.get("wau")!.value).toBe(42);
    expect(tiles.get("mau")!.value).toBe(120);
    expect(tiles.get("stickiness")!.value).toBeCloseTo(0.25, 5);
    expect(tiles.get("eventsPerDay")!.value).toBe(500);
    // Time-to-first-campaign is intentionally deferred, not fabricated.
    expect(tiles.get("medianTimeToFirstCampaign")!.deferred).toBe(true);
    expect(tiles.get("medianTimeToFirstCampaign")!.value).toBeNull();

    expect(out.activeShops.map((p) => p.value)).toEqual([38, 40, 42]);
    // None of these dates is "today" (2026-07-12) → all finalized.
    expect(out.activeShops.every((p) => p.provisional === false)).toBe(true);

    expect(out.topActions[0]).toEqual({ name: "wizard_started", value: 12 });
    expect(out.topActions[1]).toEqual({ name: "campaign_activated", value: 7 });

    const funnel = new Map(out.activationFunnel.map((s) => [s.name, s.value]));
    expect(funnel.get("Installed")).toBe(3); // all shops
    expect(funnel.get("Activated")).toBe(2); // ACTIVATED + ENGAGED
    expect(funnel.get("Engaged")).toBe(1);

    expect(out.asOf).not.toBeNull();
    expect(out.collectingSince).toBe("2026-07-09");
  });

  it("marks the current UTC day provisional in the trend", async () => {
    const db = new FakeDb();
    metric(db, "2026-07-10", UsageMetric.WAU, "", 40);
    metric(db, "2026-07-11", UsageMetric.WAU, "", 42);
    const out = await svc(db).overview(APP, D("2026-07-11T09:00:00Z"));
    const byDate = new Map(out.activeShops.map((p) => [p.date, p.provisional]));
    expect(byDate.get("2026-07-10")).toBe(false);
    expect(byDate.get("2026-07-11")).toBe(true); // today → provisional
  });

  it("returns clean empty payload (null asOf, empty series) before any data", async () => {
    const out = await svc(new FakeDb()).overview(APP, D("2026-07-11T00:00:00Z"));
    expect(out.asOf).toBeNull();
    expect(out.collectingSince).toBeNull();
    expect(out.activeShops).toEqual([]);
    expect(out.topActions).toEqual([]);
    // Tiles still present (values null) so the page renders its empty state, not a crash.
    expect(out.tiles.find((t) => t.key === "wau")!.value).toBeNull();
  });
});

// ── features ──────────────────────────────────────────────────────────────────

describe("UsageReadService.features", () => {
  it("divides adoption numerators by the active-shops denominator per window", async () => {
    const db = new FakeDb();
    metric(db, "2026-07-11", UsageMetric.ACTIVE_SHOPS_D30, "", 50);
    metric(db, "2026-07-11", UsageMetric.ADOPTION_D30, "badges", 25); // 50%
    metric(db, "2026-07-11", UsageMetric.ADOPTION_D30, "banner", 10); // 20%
    metric(db, "2026-07-11", UsageMetric.ACTIVE_SHOPS_D90, "", 80);
    metric(db, "2026-07-11", UsageMetric.ADOPTION_D90, "badges", 40); // 50%

    const out = await svc(db).features(APP, D("2026-07-12T00:00:00Z"));
    const a30 = new Map(out.adoption30.map((r) => [r.feature, r]));
    expect(a30.get("badges")!.pct).toBeCloseTo(0.5, 5);
    expect(a30.get("badges")!.shops).toBe(25);
    expect(a30.get("badges")!.activeShops).toBe(50);
    expect(a30.get("banner")!.pct).toBeCloseTo(0.2, 5);
    // A feature with no numerator row is 0%, never NaN.
    expect(a30.get("offers")!.pct).toBe(0);

    const a90 = new Map(out.adoption90.map((r) => [r.feature, r]));
    expect(a90.get("badges")!.pct).toBeCloseTo(0.5, 5);

    // Discount/campaign mixes are empty until their dimensioned metric lands.
    expect(out.discountTypeMix).toEqual([]);
    expect(out.campaignTypeMix).toEqual([]);
  });
});

// ── funnel ────────────────────────────────────────────────────────────────────

describe("UsageReadService.funnel", () => {
  it("computes stage conversion and ranks validation rules", async () => {
    const db = new FakeDb();
    metric(db, "2026-07-11", UsageMetric.FUNNEL_STAGE, "started", 100);
    metric(db, "2026-07-11", UsageMetric.FUNNEL_STAGE, "basics", 80);
    metric(db, "2026-07-11", UsageMetric.FUNNEL_STAGE, "selector", 60);
    metric(db, "2026-07-11", UsageMetric.FUNNEL_STAGE, "completed", 30);
    metric(db, "2026-07-11", UsageMetric.FUNNEL_VALIDATION_RULE, "dateRange", 9);
    metric(db, "2026-07-11", UsageMetric.FUNNEL_VALIDATION_RULE, "productSelect", 15);

    const out = await svc(db).funnel(APP);
    const byStage = new Map(out.stages.map((s) => [s.stage, s]));
    expect(byStage.get("started")!.conversionFromStart).toBe(1);
    expect(byStage.get("basics")!.conversionFromStart).toBeCloseTo(0.8, 5);
    expect(byStage.get("basics")!.conversionFromPrev).toBeCloseTo(0.8, 5); // 80/100
    expect(byStage.get("selector")!.conversionFromPrev).toBeCloseTo(0.75, 5); // 60/80
    // Rules ranked by frequency, worst first.
    expect(out.topValidationRules[0]).toEqual({ name: "productSelect", value: 15 });
  });

  it("returns median step dwell from the newest day (Phase-5 beacon), ordered by funnel", async () => {
    const db = new FakeDb();
    metric(db, "2026-07-11", UsageMetric.FUNNEL_STAGE, "started", 10);
    // An older dwell day for `basics` must be superseded by the newest day's value.
    metric(db, "2026-07-10", UsageMetric.FUNNEL_DWELL, "basics", 9999);
    metric(db, "2026-07-11", UsageMetric.FUNNEL_DWELL, "discount", 1500);
    metric(db, "2026-07-11", UsageMetric.FUNNEL_DWELL, "basics", 2000);

    const out = await svc(db).funnel(APP);
    // Newest day only, ordered along the funnel (basics before discount).
    expect(out.stepDwell).toEqual([
      { stage: "basics", medianMs: 2000 },
      { stage: "discount", medianMs: 1500 },
    ]);
  });

  it("returns an empty stepDwell when no step has dwell data yet", async () => {
    const db = new FakeDb();
    metric(db, "2026-07-11", UsageMetric.FUNNEL_STAGE, "started", 10);
    const out = await svc(db).funnel(APP);
    expect(out.stepDwell).toEqual([]);
  });
});

// ── shops ─────────────────────────────────────────────────────────────────────

describe("UsageReadService.shops", () => {
  it("returns one aggregate row per shop from the LATEST cohort run only", async () => {
    const db = new FakeDb();
    // An older run for the same shop must be excluded.
    cohort(db, "a.myshopify.com", "ENGAGED", "REGULAR", ["BADGE_DESIGNER"], 5, "2026-07-10T02:00:00Z");
    cohort(db, "a.myshopify.com", "ENGAGED", "POWER", ["BADGE_DESIGNER"], 22, "2026-07-11T02:00:00Z");
    cohort(db, "b.myshopify.com", "DORMANT", "INACTIVE", [], 0, "2026-07-11T02:00:00Z");

    const out = await svc(db).shops(APP);
    expect(out.shops).toHaveLength(2);
    const a = out.shops.find((s) => s.shop === "a.myshopify.com")!;
    expect(a.intensity).toBe("POWER"); // newest run
    expect(a.activityScore).toBe(22);
    expect(a.personaTags).toEqual(["BADGE_DESIGNER"]);
    expect(a.tenureDays).toBeNull(); // reserved axis
  });
});

// ── activity feed (the one raw read) ──────────────────────────────────────────

describe("UsageReadService.activityFeed", () => {
  it("returns newest-first, hard-caps the page, and pages backwards by cursor", async () => {
    const db = new FakeDb();
    // 5 events for the shop, seq 1..5 (5 newest).
    for (let i = 1; i <= 5; i += 1) {
      event(db, "a.myshopify.com", BigInt(i), "wizard_step_saved", `2026-07-1${i}T00:00:00Z`);
    }
    // Another shop's event must not leak in.
    event(db, "other.myshopify.com", 99n, "wizard_started", "2026-07-19T00:00:00Z");

    // Ask for 2 → newest two (seq 5,4) + a nextCursor.
    const page1 = await svc(db).activityFeed(APP, "a.myshopify.com", { limit: 2 });
    expect(page1.events.map((e) => e.cursor)).toEqual(["5", "4"]);
    expect(page1.nextCursor).toBe("4");

    // Page backwards from cursor 4 → seq 3,2.
    const page2 = await svc(db).activityFeed(APP, "a.myshopify.com", {
      limit: 2,
      before: page1.nextCursor,
    });
    expect(page2.events.map((e) => e.cursor)).toEqual(["3", "2"]);
    expect(page2.nextCursor).toBe("2");

    // Last page → seq 1, exhausted.
    const page3 = await svc(db).activityFeed(APP, "a.myshopify.com", {
      limit: 2,
      before: page2.nextCursor,
    });
    expect(page3.events.map((e) => e.cursor)).toEqual(["1"]);
    expect(page3.nextCursor).toBeNull();
  });

  it("clamps an over-large requested limit to the hard cap", async () => {
    const db = new FakeDb();
    // Seed more events than the cap (default 50).
    for (let i = 1; i <= 60; i += 1) {
      event(db, "a.myshopify.com", BigInt(i), "setting_saved", "2026-07-11T00:00:00Z");
    }
    // Ask for 200 (schema max) → clamped to 50, and there IS an older page.
    const page = await svc(db).activityFeed(APP, "a.myshopify.com", { limit: 200 });
    expect(page.events).toHaveLength(50);
    expect(page.nextCursor).not.toBeNull();
  });

  it("includes impersonated events and flags them (support context, unlike metrics)", async () => {
    const db = new FakeDb();
    event(db, "a.myshopify.com", 1n, "campaign_activated", "2026-07-11T00:00:00Z", false);
    event(db, "a.myshopify.com", 2n, "setting_saved", "2026-07-11T01:00:00Z", true);
    const page = await svc(db).activityFeed(APP, "a.myshopify.com");
    const byCursor = new Map(page.events.map((e) => [e.cursor, e.impersonated]));
    expect(byCursor.get("2")).toBe(true);
    expect(byCursor.get("1")).toBe(false);
  });
});

// ── singleton seam ────────────────────────────────────────────────────────────

describe("getUsageReadService seam", () => {
  it("__setUsageReadService swaps the singleton (for route-level fakes)", async () => {
    const fake = new UsageReadService(new FakeDb() as never);
    __setUsageReadService(fake);
    const { getUsageReadService } = await import("~/server/services/usageReadService.js");
    expect(getUsageReadService()).toBe(fake);
    __setUsageReadService(null);
  });
});
