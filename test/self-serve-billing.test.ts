import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => stubValidEnv());

const { PlanChangeService } = await import("~/server/services/planChangeService.js");
const { ConversationService } = await import("~/server/services/conversationService.js");
const { getAuditService } = await import("~/server/services/auditService.js");

const staleSub = {
  shop: "aurora.myshopify.com",
  planName: null,
  status: "none" as const,
  price: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  stale: true,
};
const billing = { getSubscription: async () => staleSub } as never;

function makeSvc(
  db: FakeDb,
  opts: { configured: boolean; dispatch?: () => Promise<{ ok: boolean; confirmationUrl?: string | null; error?: string | null }> },
) {
  const dispatcher = {
    dispatch: opts.dispatch ?? (async () => ({ ok: true, confirmationUrl: "https://admin.shopify.com/confirm" })),
  };
  return new PlanChangeService(
    db as never,
    getAuditService(),
    billing,
    new ConversationService(db as never),
    dispatcher as never,
    () => opts.configured,
  );
}

/** cp-self-serve-billing — record + dispatch to the app admin API; ticket fallback; no direct mutation. */
describe("PlanChangeService", () => {
  it("records and dispatches when the app admin API is configured", async () => {
    const db = new FakeDb();
    const result = await makeSvc(db, { configured: true }).requestChange(
      "saleswitch",
      "aurora.myshopify.com",
      "Pro",
    );
    expect(result.status).toBe("DISPATCHED");
    expect(result.confirmationUrl).toBe("https://admin.shopify.com/confirm");
    expect(db.store.planChangeRequest).toHaveLength(1);
    expect(db.store.auditLog.some((a) => a.action === "billing.plan.change.requested")).toBe(true);
    expect(db.store.auditLog.some((a) => a.action === "billing.plan.change.dispatched")).toBe(true);
    // No direct billing mutation exists — only the request record + audit.
  });

  it("marks FAILED + audits when the dispatch fails", async () => {
    const db = new FakeDb();
    const result = await makeSvc(db, {
      configured: true,
      dispatch: async () => ({ ok: false, error: "HTTP 502" }),
    }).requestChange("saleswitch", "aurora.myshopify.com", "Pro");
    expect(result.status).toBe("FAILED");
    expect(db.store.auditLog.some((a) => a.action === "billing.plan.change.failed")).toBe(true);
  });

  it("falls back to a support conversation when no admin API is configured", async () => {
    const db = new FakeDb();
    const result = await makeSvc(db, { configured: false }).requestChange(
      "saleswitch",
      "aurora.myshopify.com",
      "Pro",
    );
    expect(result.status).toBe("REQUESTED");
    expect(result.conversationId).toBeTruthy();
    // A support conversation + SYSTEM message captured the request; no mutation attempted.
    expect(db.store.conversation).toHaveLength(1);
    expect(db.store.message.some((m) => m.senderType === "SYSTEM")).toBe(true);
  });

  it("degrades gracefully on a stale/unavailable subscription read", async () => {
    const db = new FakeDb();
    const options = await makeSvc(db, { configured: true }).getOptions("aurora.myshopify.com");
    expect(options.current.stale).toBe(true);
    expect(options.plans.length).toBeGreaterThan(0);
  });
});
