import { describe, expect, it } from "vitest";
import {
  buildMerchantCampaignMonitor,
  type CampaignMonitorCampaignRow,
} from "~/server/connectors/badgyReplicaSource.js";

function campaign(
  id: string,
  status: string,
  startAt: string | null = null,
): CampaignMonitorCampaignRow {
  return {
    id,
    name: `Campaign ${id}`,
    status,
    type: id === "recurring" ? "RECURRING" : "ONE_TIME",
    start_at: startAt ? new Date(startAt) : null,
    end_at: null,
    recurrence_rule: id === "recurring" ? { frequency: "WEEKLY" } : null,
    product_count: 25,
  };
}

const base = {
  subscriptionId: null,
  subscriptionStatus: null,
  subscriptionCurrentPeriodEnd: null,
  buckets: [],
} as const;

describe("merchant campaign monitor replica mapper", () => {
  it("aggregates campaign states and returns the next ten scheduled campaigns", () => {
    const scheduled = Array.from({ length: 12 }, (_, index) =>
      campaign(`s${index}`, "SCHEDULED", `2026-09-${String(index + 1).padStart(2, "0")}T10:00:00Z`),
    );
    const monitor = buildMerchantCampaignMonitor(
      "shop.myshopify.com",
      {
        ...base,
        planKey: "FREE",
        campaigns: [campaign("active", "ACTIVE"), campaign("recurring", "PAUSED"), ...scheduled],
      },
      "2026-08-15T00:00:00.000Z",
    );

    expect(monitor.total).toBe(14);
    expect(monitor.counts.ACTIVE).toBe(1);
    expect(monitor.counts.SCHEDULED).toBe(12);
    expect(monitor.counts.PAUSED).toBe(1);
    expect(monitor.scheduled).toHaveLength(10);
    expect(monitor.scheduled[0]?.id).toBe("s0");
    expect(monitor.nextScheduledAt).toBe("2026-09-01T10:00:00.000Z");
    expect(monitor.listLimit).toBe(10);
  });

  it("uses durable Free lifetime buckets and clamps exhausted allowances", () => {
    const monitor = buildMerchantCampaignMonitor("free.myshopify.com", {
      ...base,
      planKey: "free",
      campaigns: [],
      buckets: [
        { metric: "CAMPAIGN_LAUNCH", window_key: "lifetime", used: 12n },
        { metric: "PRODUCT_VARIANT_UPDATE", window_key: "lifetime", used: 9_250n },
        { metric: "AI_CREDIT", window_key: "lifetime", used: 3n },
      ],
    });

    expect(monitor.allowances).toEqual([
      expect.objectContaining({ metric: "CAMPAIGN_LAUNCH", used: 12, limit: 10, remaining: 0, window: "LIFETIME" }),
      expect.objectContaining({ metric: "PRODUCT_VARIANT_UPDATE", used: 9250, limit: 10000, remaining: 750 }),
      expect.objectContaining({ metric: "AI_CREDIT", used: 3, limit: 10, remaining: 7 }),
    ]);
  });

  it("uses Essential's current billing-period product bucket and reports suspension", () => {
    const periodEnd = new Date("2026-09-01T00:00:00.000Z");
    const monitor = buildMerchantCampaignMonitor("essential.myshopify.com", {
      planKey: "ESSENTIAL",
      subscriptionId: "sub-1",
      subscriptionStatus: "FROZEN",
      subscriptionCurrentPeriodEnd: periodEnd,
      campaigns: [],
      buckets: [
        { metric: "PRODUCT_VARIANT_UPDATE", window_key: "lifetime", used: 50_000n },
        { metric: "PRODUCT_VARIANT_UPDATE", window_key: `billing:sub-1:${periodEnd.toISOString()}`, used: 4_000n },
      ],
    });

    expect(monitor.billingSuspended).toBe(true);
    expect(monitor.allowances[0]).toMatchObject({ metric: "CAMPAIGN_LAUNCH", limit: null, window: "UNLIMITED" });
    expect(monitor.allowances[1]).toMatchObject({
      metric: "PRODUCT_VARIANT_UPDATE",
      used: 4000,
      limit: 10000,
      remaining: 6000,
      window: "BILLING_PERIOD",
      windowEndsAt: periodEnd.toISOString(),
    });
  });

  it("represents Pro allowances as unlimited and ignores unknown statuses", () => {
    const monitor = buildMerchantCampaignMonitor("pro.myshopify.com", {
      ...base,
      planKey: "PRO",
      campaigns: [campaign("active", "ACTIVE"), campaign("legacy", "UNKNOWN")],
    });

    expect(monitor.total).toBe(1);
    expect(monitor.allowances.every((allowance) => allowance.limit === null)).toBe(true);
    expect(monitor.allowances.every((allowance) => allowance.remaining === null)).toBe(true);
  });
});
