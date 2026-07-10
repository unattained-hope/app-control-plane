import { describe, it, expect, beforeAll, vi } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => stubValidEnv());

const { BillingMonitor } = await import("~/server/services/billingMonitor.js");

function event(topic: string): never {
  return {
    id: "whe-1",
    appKey: "saleswitch",
    topic,
    shop: "aurora.myshopify.com",
    payload: {},
  } as never;
}

/** cp-billing-monitoring — cap alert + KPI-delta nudge on subscription webhooks. */
describe("BillingMonitor", () => {
  it("raises exactly one alert + audit on approaching_capped_amount", async () => {
    const db = new FakeDb();
    const audit = { append: vi.fn(async (_input: { action: string }) => {}) };
    const kpi = { runRollup: vi.fn(async () => 6) };
    const mon = new BillingMonitor(db as never, audit as never, kpi as never);

    await mon.handleWebhook(event("app_subscriptions/approaching_capped_amount"));

    expect(db.store.billingAlert).toHaveLength(1);
    expect(db.store.billingAlert[0]!.kind).toBe("CAP_APPROACHING");
    expect(audit.append).toHaveBeenCalledTimes(1);
    expect(audit.append.mock.calls[0]![0].action).toBe("billing.cap.approaching");
    expect(kpi.runRollup).not.toHaveBeenCalled();
  });

  it("appends a fresh KPI snapshot + audit on subscription update", async () => {
    const db = new FakeDb();
    const audit = { append: vi.fn(async (_input: { action: string }) => {}) };
    const kpi = { runRollup: vi.fn(async () => 6) };
    const mon = new BillingMonitor(db as never, audit as never, kpi as never);

    await mon.handleWebhook(event("app_subscriptions/update"));

    expect(kpi.runRollup).toHaveBeenCalledWith("saleswitch");
    expect(audit.append).toHaveBeenCalledTimes(1);
    expect(audit.append.mock.calls[0]![0].action).toBe("billing.subscription.updated");
  });
});
