// test/usage-rollup.test.ts
// Metric correctness for the daily rollup (usage-analytics Phase 3): activity, wizard
// funnel (dedupe-per-day + validation rules), feature adoption windows, retention
// matrix, idempotent double-run, finalization of a late-arriving event, and the
// impersonation exclusion. Seeded mirror events (FakeDb) → expected UsageMetricDaily
// rows. No BullMQ, no real DB.
import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";
import {
  UsageRollupService,
  runUsageRollupFinalize,
  __setUsageRollupService,
} from "~/server/services/usageRollupService.js";
import {
  UsageAlertService,
  __setUsageAlertService,
} from "~/server/services/usageAlertService.js";
import { getAuditService } from "~/server/services/auditService.js";
import { UsageMetric } from "~/lib/usageMetrics.js";

beforeAll(() => stubValidEnv());

const APP = "saleswitch";
const DAY = new Date("2026-07-10T00:00:00.000Z"); // the rollup day (UTC)

/** Seed a mirror event row directly (bypasses ingest; matches the stored shape). */
function seed(
  db: FakeDb,
  over: {
    shopDomain: string;
    name: string;
    occurredAt: string;
    properties?: Record<string, unknown> | null;
    impersonated?: boolean;
  },
): void {
  db.store.usageEvent.push({
    id: `ue_${db.store.usageEvent.length + 1}`,
    appKey: APP,
    sourceEventId: `s${db.store.usageEvent.length + 1}`,
    sourceSeq: BigInt(db.store.usageEvent.length + 1),
    userId: null,
    category: "X",
    source: "UI",
    ingestedAt: new Date(),
    shopDomain: over.shopDomain,
    name: over.name,
    properties: over.properties ?? null,
    impersonated: over.impersonated ?? false,
    occurredAt: new Date(over.occurredAt),
  });
}

function svc(db: FakeDb): UsageRollupService {
  return new UsageRollupService(db as never);
}

/** Read a computed metric value for the day (dimension optional, defaults ""). */
function metricValue(db: FakeDb, metric: string, dimension = ""): number | undefined {
  const row = db.store.usageMetricDaily.find(
    (r) => r.metric === metric && r.dimension === dimension,
  );
  return row?.value as number | undefined;
}

describe("UsageRollupService.rollupDay — activity", () => {
  it("computes DAU/events/per-action counts + WAU/MAU over trailing windows", async () => {
    const db = new FakeDb();
    // Day-of activity: 2 distinct shops, 3 events.
    seed(db, { shopDomain: "a.myshopify.com", name: "page_viewed", occurredAt: "2026-07-10T01:00:00Z" });
    seed(db, { shopDomain: "a.myshopify.com", name: "campaign_activated", occurredAt: "2026-07-10T02:00:00Z" });
    seed(db, { shopDomain: "b.myshopify.com", name: "page_viewed", occurredAt: "2026-07-10T03:00:00Z" });
    // A third shop active 5 days earlier → counts for WAU/MAU, not DAU.
    seed(db, { shopDomain: "c.myshopify.com", name: "page_viewed", occurredAt: "2026-07-05T03:00:00Z" });
    // A fourth shop active 20 days earlier → MAU only.
    seed(db, { shopDomain: "d.myshopify.com", name: "page_viewed", occurredAt: "2026-06-20T03:00:00Z" });

    await svc(db).rollupDay(APP, DAY);

    expect(metricValue(db, UsageMetric.DAU)).toBe(2);
    expect(metricValue(db, UsageMetric.EVENTS_TOTAL)).toBe(3);
    expect(metricValue(db, UsageMetric.ACTION_COUNT, "page_viewed")).toBe(2);
    expect(metricValue(db, UsageMetric.ACTION_COUNT, "campaign_activated")).toBe(1);
    expect(metricValue(db, UsageMetric.WAU)).toBe(3); // a,b,c within 7d
    expect(metricValue(db, UsageMetric.MAU)).toBe(4); // a,b,c,d within 30d
  });

  it("appends the headline scalars into KpiSnapshot under usage.*", async () => {
    const db = new FakeDb();
    seed(db, { shopDomain: "a.myshopify.com", name: "page_viewed", occurredAt: "2026-07-10T01:00:00Z" });
    await svc(db).rollupDay(APP, DAY);
    const kpiMetrics = db.store.kpiSnapshot.map((r) => r.metric);
    expect(kpiMetrics).toContain("usage.active.wau");
    expect(kpiMetrics).toContain("usage.active.mau");
    expect(kpiMetrics).toContain("usage.events.per_day");
  });

  it("excludes impersonated events from every metric", async () => {
    const db = new FakeDb();
    seed(db, { shopDomain: "real.myshopify.com", name: "page_viewed", occurredAt: "2026-07-10T01:00:00Z" });
    // Support agent impersonating another shop the same day → must not count.
    seed(db, { shopDomain: "support-target.myshopify.com", name: "campaign_activated", occurredAt: "2026-07-10T02:00:00Z", impersonated: true });

    await svc(db).rollupDay(APP, DAY);

    expect(metricValue(db, UsageMetric.DAU)).toBe(1); // only the real shop
    expect(metricValue(db, UsageMetric.EVENTS_TOTAL)).toBe(1);
    expect(metricValue(db, UsageMetric.ACTION_COUNT, "campaign_activated")).toBeUndefined();
  });
});

describe("UsageRollupService.rollupDay — wizard funnel", () => {
  it("counts a shop once per stage even with repeated step saves", async () => {
    const db = new FakeDb();
    // One shop saves the discount step 3 times → counts once for the discount stage.
    for (const h of ["01", "02", "03"]) {
      seed(db, {
        shopDomain: "a.myshopify.com",
        name: "wizard_step_saved",
        occurredAt: `2026-07-10T${h}:00:00Z`,
        properties: { step: "discount" },
      });
    }
    seed(db, { shopDomain: "a.myshopify.com", name: "wizard_started", occurredAt: "2026-07-10T00:30:00Z" });
    seed(db, { shopDomain: "a.myshopify.com", name: "wizard_completed", occurredAt: "2026-07-10T04:00:00Z" });

    await svc(db).rollupDay(APP, DAY);

    expect(metricValue(db, UsageMetric.FUNNEL_STAGE, "discount")).toBe(1);
    expect(metricValue(db, UsageMetric.FUNNEL_STAGE, "started")).toBe(1);
    expect(metricValue(db, UsageMetric.FUNNEL_STAGE, "completed")).toBe(1);
  });

  it("aggregates top validation-failure rules by dimension = rule id", async () => {
    const db = new FakeDb();
    seed(db, { shopDomain: "a.myshopify.com", name: "wizard_validation_failed", occurredAt: "2026-07-10T01:00:00Z", properties: { step: "discount", rules: ["value_required", "value_positive"] } });
    seed(db, { shopDomain: "b.myshopify.com", name: "wizard_validation_failed", occurredAt: "2026-07-10T02:00:00Z", properties: { step: "discount", rules: ["value_required"] } });

    await svc(db).rollupDay(APP, DAY);

    expect(metricValue(db, UsageMetric.FUNNEL_VALIDATION_RULE, "value_required")).toBe(2);
    expect(metricValue(db, UsageMetric.FUNNEL_VALIDATION_RULE, "value_positive")).toBe(1);
  });

  it("computes median step dwell from durationMs, skipping saves without it", async () => {
    const db = new FakeDb();
    // `basics`: three saves WITH durations [1000, 3000, 2000] → median 2000 (odd count).
    seed(db, { shopDomain: "a.myshopify.com", name: "wizard_step_saved", occurredAt: "2026-07-10T01:00:00Z", properties: { step: "basics", durationMs: 1000 } });
    seed(db, { shopDomain: "b.myshopify.com", name: "wizard_step_saved", occurredAt: "2026-07-10T01:05:00Z", properties: { step: "basics", durationMs: 3000 } });
    seed(db, { shopDomain: "c.myshopify.com", name: "wizard_step_saved", occurredAt: "2026-07-10T01:10:00Z", properties: { step: "basics", durationMs: 2000 } });
    // `discount`: two saves WITH durations [1000, 2000] → median 1500 (even count avg).
    seed(db, { shopDomain: "a.myshopify.com", name: "wizard_step_saved", occurredAt: "2026-07-10T02:00:00Z", properties: { step: "discount", durationMs: 1000 } });
    seed(db, { shopDomain: "b.myshopify.com", name: "wizard_step_saved", occurredAt: "2026-07-10T02:05:00Z", properties: { step: "discount", durationMs: 2000 } });
    // `theme`: saves WITHOUT any durationMs → NO dwell row (honest gap, not a faked 0).
    seed(db, { shopDomain: "a.myshopify.com", name: "wizard_step_saved", occurredAt: "2026-07-10T03:00:00Z", properties: { step: "theme" } });

    await svc(db).rollupDay(APP, DAY);

    expect(metricValue(db, UsageMetric.FUNNEL_DWELL, "basics")).toBe(2000);
    expect(metricValue(db, UsageMetric.FUNNEL_DWELL, "discount")).toBe(1500);
    // A step with no usable durations produces no row at all.
    expect(metricValue(db, UsageMetric.FUNNEL_DWELL, "theme")).toBeUndefined();
  });

  it("ignores a non-numeric durationMs rather than faking a dwell value", async () => {
    const db = new FakeDb();
    seed(db, { shopDomain: "a.myshopify.com", name: "wizard_step_saved", occurredAt: "2026-07-10T01:00:00Z", properties: { step: "basics", durationMs: "oops" } });
    await svc(db).rollupDay(APP, DAY); // must not throw
    const dwellRows = db.store.usageMetricDaily.filter((r) => r.metric === UsageMetric.FUNNEL_DWELL);
    expect(dwellRows.length).toBe(0);
  });
});

describe("UsageRollupService.rollupDay — feature adoption", () => {
  it("computes 30/90-day distinct-shop numerators + active-shop denominators", async () => {
    const db = new FakeDb();
    // Badge usage: shop a within 30d, shop b at ~45d (90d only).
    seed(db, { shopDomain: "a.myshopify.com", name: "badge_template_created", occurredAt: "2026-07-01T00:00:00Z" });
    seed(db, { shopDomain: "b.myshopify.com", name: "badge_template_edited", occurredAt: "2026-05-26T00:00:00Z" });
    // markets_sync via setting_saved (settings-driven feature).
    seed(db, { shopDomain: "a.myshopify.com", name: "setting_saved", occurredAt: "2026-07-02T00:00:00Z", properties: { key: "markets_sync", enabled: true } });
    // A shop that saved a non-markets setting must NOT count for markets_sync.
    seed(db, { shopDomain: "c.myshopify.com", name: "setting_saved", occurredAt: "2026-07-03T00:00:00Z", properties: { key: "timezone" } });

    await svc(db).rollupDay(APP, DAY);

    expect(metricValue(db, UsageMetric.ADOPTION_D30, "badges")).toBe(1); // a only
    expect(metricValue(db, UsageMetric.ADOPTION_D90, "badges")).toBe(2); // a + b
    expect(metricValue(db, UsageMetric.ADOPTION_D30, "markets_sync")).toBe(1); // a only
    expect(metricValue(db, UsageMetric.ADOPTION_D90, "markets_sync")).toBe(1);
    // Denominator = distinct active shops in the window (a, b, c).
    expect(metricValue(db, UsageMetric.ACTIVE_SHOPS_D90)).toBe(3);
    expect(metricValue(db, UsageMetric.ACTIVE_SHOPS_D30)).toBe(2); // a, c (b is >30d)
  });
});

describe("UsageRollupService.rollupRetention", () => {
  it("builds a weekly install-cohort activity matrix showing retention decay", async () => {
    const db = new FakeDb();
    const NOW = new Date("2026-07-15T12:00:00Z"); // Wednesday
    // Two shops install in the same ISO week (week of 2026-06-29..07-05). The install
    // event itself is week-0 activity, so both are active in week 0.
    seed(db, { shopDomain: "a.myshopify.com", name: "app_installed", occurredAt: "2026-06-30T09:00:00Z" });
    seed(db, { shopDomain: "b.myshopify.com", name: "app_installed", occurredAt: "2026-07-01T09:00:00Z" });
    // Week 1 activity: only shop a returns; shop b churns silently (retention decay).
    seed(db, { shopDomain: "a.myshopify.com", name: "campaign_activated", occurredAt: "2026-07-08T09:00:00Z" });

    await svc(db).rollupRetention(APP, NOW);

    // Cohort week-0 Monday = 2026-06-29.
    const wk0 = db.store.usageMetricDaily.filter((r) => r.metric === UsageMetric.RETENTION_COHORT_SIZE);
    expect(wk0.length).toBe(1);
    expect(wk0[0]!.value).toBe(2); // 2 shops installed that week
    const cohortRow = (dim: string) =>
      db.store.usageMetricDaily.find((r) => r.metric === UsageMetric.RETENTION_COHORT && r.dimension === dim)?.value;
    expect(cohortRow("cohortWeek:week0")).toBe(2); // both active week 0 (install counts)
    expect(cohortRow("cohortWeek:week1")).toBe(1); // only a returns week 1
  });
});

describe("idempotency + finalization", () => {
  it("double-run produces identical rows (upsert, no duplicates)", async () => {
    const db = new FakeDb();
    seed(db, { shopDomain: "a.myshopify.com", name: "page_viewed", occurredAt: "2026-07-10T01:00:00Z" });
    seed(db, { shopDomain: "b.myshopify.com", name: "campaign_activated", occurredAt: "2026-07-10T02:00:00Z" });

    await svc(db).rollupDay(APP, DAY);
    const afterFirst = db.store.usageMetricDaily.length;
    const snapshot = new Map(db.store.usageMetricDaily.map((r) => [`${r.metric}::${r.dimension}`, r.value]));

    await svc(db).rollupDay(APP, DAY); // re-run

    expect(db.store.usageMetricDaily.length).toBe(afterFirst); // no new rows
    for (const r of db.store.usageMetricDaily) {
      expect(snapshot.get(`${r.metric}::${r.dimension}`)).toBe(r.value); // values unchanged
    }
  });

  it("finalize corrects a late-arriving event for yesterday", async () => {
    const db = new FakeDb();
    // "now" is just after midnight on the 11th; finalize recomputes the 10th.
    const NOW = new Date("2026-07-11T00:30:00Z");
    seed(db, { shopDomain: "a.myshopify.com", name: "page_viewed", occurredAt: "2026-07-10T23:00:00Z" });
    // First incremental pass on the 10th saw only 1 event.
    await svc(db).rollupDay(APP, new Date("2026-07-10T12:00:00Z"));
    expect(metricValue(db, UsageMetric.EVENTS_TOTAL)).toBe(1);

    // A second event for the 10th arrives late (ingestion lag), after midnight.
    seed(db, { shopDomain: "b.myshopify.com", name: "campaign_activated", occurredAt: "2026-07-10T23:30:00Z" });

    // Finalize uses the real singleton path; point both the rollup AND the chained
    // post-finalize alert eval at our FakeDb via their seams (P5 chains alert eval after
    // finalize). With no enabled rules seeded, the eval is a clean no-op.
    __setUsageRollupService(svc(db));
    __setUsageAlertService(new UsageAlertService(db as never, getAuditService()));
    await runUsageRollupFinalize(APP, NOW);
    __setUsageRollupService(null);
    __setUsageAlertService(null);

    // Yesterday's totals now include the late event, overwritten in place.
    expect(metricValue(db, UsageMetric.EVENTS_TOTAL)).toBe(2);
    expect(metricValue(db, UsageMetric.DAU)).toBe(2);
    // Still exactly one EVENTS_TOTAL row for that day (upsert, not append).
    const totalRows = db.store.usageMetricDaily.filter((r) => r.metric === UsageMetric.EVENTS_TOTAL);
    expect(totalRows.length).toBe(1);
  });
});
