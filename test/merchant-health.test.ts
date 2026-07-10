import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => stubValidEnv());

const { scoreHealth } = await import("~/lib/healthScore.js");
const { MerchantHealthService } = await import("~/server/services/merchantHealthService.js");
const { getAuditService } = await import("~/server/services/auditService.js");

const NOW = new Date("2026-06-28T12:00:00.000Z");

function stubBilling(status: "active" | "trial" | "cancelled" | "none") {
  return { getSubscription: async () => ({ status }) } as never;
}

function makeSvc(db: FakeDb, status: "active" | "trial" | "cancelled" | "none" = "active") {
  return new MerchantHealthService(db as never, getAuditService(), stubBilling(status));
}

/** cp-merchant-health — a transparent weighted score → band, persisted + read latest. */
describe("healthScore (pure)", () => {
  it("scores a healthy active merchant at zero / HEALTHY", () => {
    const r = scoreHealth({
      subscription: "active",
      capAlert: false,
      uninstalled: false,
      openConversations: 0,
      latestCsat: null,
    });
    expect(r.score).toBe(0);
    expect(r.band).toBe("HEALTHY");
    expect(r.factors).toHaveLength(0);
  });

  it("bands a cancelled subscription AT_RISK (default cutoffs)", () => {
    const r = scoreHealth({
      subscription: "cancelled",
      capAlert: false,
      uninstalled: false,
      openConversations: 0,
      latestCsat: null,
    });
    expect(r.score).toBe(50); // HEALTH_WEIGHT_CANCELLED
    expect(r.band).toBe("AT_RISK"); // 50 ∈ [25, 60)
  });

  it("bands an uninstalled merchant CRITICAL", () => {
    const r = scoreHealth({
      subscription: "none",
      capAlert: false,
      uninstalled: true,
      openConversations: 0,
      latestCsat: null,
    });
    expect(r.band).toBe("CRITICAL"); // 100 (+30) ≥ 60
    expect(r.factors.some((f) => f.key === "uninstalled")).toBe(true);
  });

  it("compounds cancelled + low CSAT into CRITICAL", () => {
    const r = scoreHealth({
      subscription: "cancelled",
      capAlert: false,
      uninstalled: false,
      openConversations: 0,
      latestCsat: 1,
    });
    expect(r.score).toBe(70); // 50 + 20
    expect(r.band).toBe("CRITICAL");
  });
});

describe("MerchantHealthService", () => {
  it("evaluates from the connector (billing) + CP tables", async () => {
    const db = new FakeDb();
    const result = await makeSvc(db, "active").evaluate("saleswitch", "aurora.myshopify.com");
    expect(result.band).toBe("HEALTHY");
  });

  it("treats a shop with the latest lifecycle UNINSTALL as uninstalled", async () => {
    const db = new FakeDb();
    db.store.merchantLifecycleEvent.push({
      id: "mle_x",
      appKey: "saleswitch",
      shop: "gone.myshopify.com",
      kind: "UNINSTALL",
      occurredAt: NOW,
    });
    const signals = await makeSvc(db, "none").gatherSignals("saleswitch", "gone.myshopify.com");
    expect(signals.uninstalled).toBe(true);
  });

  it("persists a snapshot and audits the band on first score (read latest-per-shop)", async () => {
    const db = new FakeDb();
    await makeSvc(db, "cancelled").refreshAndPersist("saleswitch", "shop1.myshopify.com", NOW);
    expect(db.store.merchantHealthSnapshot).toHaveLength(1);
    const latest = await makeSvc(db, "cancelled").latestForShop("saleswitch", "shop1.myshopify.com");
    expect(latest?.band).toBe("AT_RISK");
    expect(db.store.auditLog.some((a) => a.action === "merchant.health.evaluated")).toBe(true);
  });

  it("ranks the at-risk list CRITICAL → AT_RISK → HEALTHY then by score", async () => {
    const db = new FakeDb();
    db.store.merchantHealthSnapshot.push(
      { id: "s1", appKey: "saleswitch", shop: "healthy.com", score: 0, band: "HEALTHY", factors: [], asOf: NOW },
      { id: "s2", appKey: "saleswitch", shop: "risky.com", score: 40, band: "AT_RISK", factors: [], asOf: NOW },
      { id: "s3", appKey: "saleswitch", shop: "critical.com", score: 120, band: "CRITICAL", factors: [], asOf: NOW },
    );
    const list = await makeSvc(db).atRisk("saleswitch");
    expect(list.map((r) => r.shop)).toEqual(["critical.com", "risky.com", "healthy.com"]);
  });
});
