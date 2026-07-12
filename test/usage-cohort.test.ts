// test/usage-cohort.test.ts
// Cohort assignment (usage-analytics Phase 3): lifecycle precedence at its boundaries,
// weighted-intensity bucketing across shops, multi-persona assignment, append-only
// snapshot writes, and impersonation exclusion. Driven through UsageCohortService +
// FakeDb (in-memory) — no BullMQ, no real DB.
import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";
import { UsageCohortService } from "~/server/services/usageCohortService.js";

beforeAll(() => stubValidEnv());

const APP = "saleswitch";
const NOW = new Date("2026-07-11T12:00:00.000Z");
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function seed(
  db: FakeDb,
  over: {
    shopDomain: string;
    name: string;
    occurredAt: Date;
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
    properties: over.properties ?? null,
    impersonated: over.impersonated ?? false,
    ingestedAt: new Date(),
    ...over,
  });
}

function svc(db: FakeDb): UsageCohortService {
  return new UsageCohortService(db as never);
}

/** Find one shop's assignment from the returned list. */
function forShop(list: Awaited<ReturnType<UsageCohortService["runAssignment"]>>, shop: string) {
  return list.find((a) => a.shop === shop)!;
}

describe("UsageCohortService lifecycle boundaries", () => {
  it("assigns each shop the right lifecycle stage", async () => {
    const db = new FakeDb();
    // NEW: installed 3 days ago, no activation.
    seed(db, { shopDomain: "new.myshopify.com", name: "app_installed", occurredAt: daysAgo(3) });
    // ONBOARDING: installed 40 days ago, never activated, but active recently.
    seed(db, { shopDomain: "onboard.myshopify.com", name: "app_installed", occurredAt: daysAgo(40) });
    seed(db, { shopDomain: "onboard.myshopify.com", name: "page_viewed", occurredAt: daysAgo(2) });
    // ACTIVATED: installed 40d ago, first activation 10 days ago (within first 30d).
    seed(db, { shopDomain: "activated.myshopify.com", name: "app_installed", occurredAt: daysAgo(40) });
    seed(db, { shopDomain: "activated.myshopify.com", name: "campaign_activated", occurredAt: daysAgo(10) });
    // ENGAGED: activated 60 days ago, active in the last 30 days.
    seed(db, { shopDomain: "engaged.myshopify.com", name: "app_installed", occurredAt: daysAgo(120) });
    seed(db, { shopDomain: "engaged.myshopify.com", name: "campaign_activated", occurredAt: daysAgo(60) });
    seed(db, { shopDomain: "engaged.myshopify.com", name: "page_viewed", occurredAt: daysAgo(5) });
    // DORMANT: installed + activated long ago, silent 30 days.
    seed(db, { shopDomain: "dormant.myshopify.com", name: "app_installed", occurredAt: daysAgo(200) });
    seed(db, { shopDomain: "dormant.myshopify.com", name: "campaign_activated", occurredAt: daysAgo(100) });
    // CHURNED: uninstalled, no reinstall after.
    seed(db, { shopDomain: "churned.myshopify.com", name: "app_installed", occurredAt: daysAgo(50) });
    seed(db, { shopDomain: "churned.myshopify.com", name: "app_uninstalled", occurredAt: daysAgo(5) });

    const list = await svc(db).runAssignment(APP, NOW);

    expect(forShop(list, "new.myshopify.com").lifecycle).toBe("NEW");
    expect(forShop(list, "onboard.myshopify.com").lifecycle).toBe("ONBOARDING");
    expect(forShop(list, "activated.myshopify.com").lifecycle).toBe("ACTIVATED");
    expect(forShop(list, "engaged.myshopify.com").lifecycle).toBe("ENGAGED");
    expect(forShop(list, "dormant.myshopify.com").lifecycle).toBe("DORMANT");
    expect(forShop(list, "churned.myshopify.com").lifecycle).toBe("CHURNED");
  });

  it("a reinstall after an uninstall is not CHURNED", async () => {
    const db = new FakeDb();
    seed(db, { shopDomain: "back.myshopify.com", name: "app_installed", occurredAt: daysAgo(50) });
    seed(db, { shopDomain: "back.myshopify.com", name: "app_uninstalled", occurredAt: daysAgo(20) });
    seed(db, { shopDomain: "back.myshopify.com", name: "app_installed", occurredAt: daysAgo(3) });
    const list = await svc(db).runAssignment(APP, NOW);
    // The latest install (3d ago) follows the uninstall, so the shop is currently
    // installed → NOT CHURNED. The NEW window keys off the FIRST install (50d ago),
    // so a long-tenured shop that never activated resolves to ONBOARDING, not NEW.
    expect(forShop(list, "back.myshopify.com").lifecycle).toBe("ONBOARDING");
  });
});

describe("UsageCohortService intensity + personas", () => {
  it("scores by weighted 30-day counts and buckets by percentile", async () => {
    const db = new FakeDb();
    // Power shop: 4 campaigns (×5=20) + several sessions → high score.
    for (let i = 0; i < 4; i += 1) {
      seed(db, { shopDomain: "power.myshopify.com", name: "campaign_activated", occurredAt: daysAgo(i + 1) });
    }
    for (let i = 0; i < 3; i += 1) {
      seed(db, { shopDomain: "power.myshopify.com", name: "wizard_started", occurredAt: daysAgo(i + 1) });
    }
    // A spread of lighter shops to populate the percentile distribution.
    for (const s of ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"]) {
      seed(db, { shopDomain: `${s}.myshopify.com`, name: "page_viewed", occurredAt: daysAgo(2) });
    }
    // An inactive shop (installed but no 30d activity) → INACTIVE.
    seed(db, { shopDomain: "idle.myshopify.com", name: "app_installed", occurredAt: daysAgo(200) });

    const list = await svc(db).runAssignment(APP, NOW);
    const power = forShop(list, "power.myshopify.com");
    expect(power.activityScore).toBeGreaterThan(0);
    expect(power.intensity).toBe("POWER");
    expect(forShop(list, "idle.myshopify.com").intensity).toBe("INACTIVE");
    expect(forShop(list, "idle.myshopify.com").activityScore).toBe(0);
  });

  it("assigns multiple personas for a broad heavy user", async () => {
    const db = new FakeDb();
    const shop = "broad.myshopify.com";
    seed(db, { shopDomain: shop, name: "app_installed", occurredAt: daysAgo(60) });
    // 3 campaigns → DISCOUNT_ORCHESTRATOR.
    for (let i = 0; i < 3; i += 1) seed(db, { shopDomain: shop, name: "campaign_activated", occurredAt: daysAgo(i + 1) });
    // 3 badge edits → BADGE_DESIGNER.
    for (let i = 0; i < 3; i += 1) seed(db, { shopDomain: shop, name: "badge_template_edited", occurredAt: daysAgo(i + 1) });
    // 2 recurrence signals → AUTOMATION_USER.
    for (let i = 0; i < 2; i += 1) seed(db, { shopDomain: shop, name: "campaign_recurrence_stopped", occurredAt: daysAgo(i + 1) });
    // markets sync → MULTI_MARKET.
    seed(db, { shopDomain: shop, name: "setting_saved", occurredAt: daysAgo(1), properties: { key: "markets_sync", enabled: true } });

    const list = await svc(db).runAssignment(APP, NOW);
    const tags = forShop(list, shop).personaTags;
    expect(tags).toEqual(expect.arrayContaining([
      "DISCOUNT_ORCHESTRATOR",
      "BADGE_DESIGNER",
      "AUTOMATION_USER",
      "MULTI_MARKET",
    ]));
    // Broad user is NOT a minimalist.
    expect(tags).not.toContain("MINIMALIST");
  });

  it("excludes impersonated events from scoring and personas", async () => {
    const db = new FakeDb();
    const shop = "target.myshopify.com";
    seed(db, { shopDomain: shop, name: "app_installed", occurredAt: daysAgo(40) });
    // All the "activity" is support impersonation → must not raise the score/personas.
    for (let i = 0; i < 5; i += 1) {
      seed(db, { shopDomain: shop, name: "campaign_activated", occurredAt: daysAgo(i + 1), impersonated: true });
    }
    const list = await svc(db).runAssignment(APP, NOW);
    const a = forShop(list, shop);
    expect(a.activityScore).toBe(0);
    expect(a.intensity).toBe("INACTIVE");
    expect(a.personaTags).not.toContain("DISCOUNT_ORCHESTRATOR");
    // With no non-impersonated activation, lifecycle is ONBOARDING (installed, never activated).
    expect(a.lifecycle).toBe("ONBOARDING");
  });
});

describe("UsageCohortService snapshot persistence", () => {
  it("appends one snapshot row per shop per run (history preserved)", async () => {
    const db = new FakeDb();
    seed(db, { shopDomain: "a.myshopify.com", name: "page_viewed", occurredAt: daysAgo(2) });
    seed(db, { shopDomain: "b.myshopify.com", name: "page_viewed", occurredAt: daysAgo(2) });

    await svc(db).runAssignment(APP, NOW);
    expect(db.store.usageCohortSnapshot.length).toBe(2);

    // A later run appends again — both runs' rows coexist.
    const LATER = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
    await svc(db).runAssignment(APP, LATER);
    expect(db.store.usageCohortSnapshot.length).toBe(4);
    // Every row carries its computedAt (movement over time is queryable).
    const times = new Set(db.store.usageCohortSnapshot.map((r) => (r.computedAt as Date).getTime()));
    expect(times.size).toBe(2);
  });
});
