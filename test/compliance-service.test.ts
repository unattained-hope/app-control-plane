import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => stubValidEnv());

const { ComplianceService, SLA_DAYS } = await import(
  "~/server/services/complianceService.js"
);
const { ConfirmationError } = await import(
  "~/server/services/merchantActionService.js"
);

const DAY_MS = 24 * 60 * 60 * 1000;

function makeService(db: FakeDb) {
  return new ComplianceService(db as never);
}

/** Seed a complianceRequest row directly into the fake store. */
function seed(db: FakeDb, over: Record<string, unknown>): void {
  db.store.complianceRequest.push({
    id: "seed",
    appKey: "saleswitch",
    topic: "CUSTOMERS_REDACT",
    shop: "shop.myshopify.com",
    status: "RECEIVED",
    payload: {},
    receivedAt: new Date(),
    dueAt: new Date(),
    dispatchedAt: null,
    completedAt: null,
    ...over,
  });
}

/** cp-compliance-dsr — SLA timer, same-transaction audit, breach query, confirm. */
describe("ComplianceService", () => {
  it("sets dueAt = receivedAt + 30 days and audits receipt in the same tx", async () => {
    const db = new FakeDb();
    const receivedAt = new Date("2026-06-01T00:00:00.000Z");
    const req = await makeService(db).record({
      appKey: "saleswitch",
      topic: "CUSTOMERS_REDACT",
      shop: "aurora.myshopify.com",
      payload: {},
      receivedAt,
    });
    expect((req.dueAt as Date).getTime() - receivedAt.getTime()).toBe(SLA_DAYS * DAY_MS);
    expect(db.store.complianceRequest).toHaveLength(1);
    expect(db.store.auditLog).toHaveLength(1);
    expect(db.store.auditLog[0]!.action).toBe("compliance.request.received");
  });

  it("rolls back the request when the same-tx audit insert fails", async () => {
    const db = new FakeDb();
    db.failAudit = true;
    await expect(
      makeService(db).record({
        appKey: "saleswitch",
        topic: "SHOP_REDACT",
        shop: "x.myshopify.com",
        payload: {},
      }),
    ).rejects.toThrow();
    // Atomicity: neither the request nor an audit row survives.
    expect(db.store.complianceRequest).toHaveLength(0);
    expect(db.store.auditLog).toHaveLength(0);
  });

  it("listBreaching returns only open requests within the threshold or overdue", async () => {
    const db = new FakeDb();
    const now = new Date("2026-06-27T00:00:00.000Z");
    seed(db, { id: "near", dueAt: new Date(now.getTime() + 2 * DAY_MS) }); // within 5d
    seed(db, { id: "overdue", status: "IN_PROGRESS", dueAt: new Date(now.getTime() - DAY_MS) });
    seed(db, { id: "far", dueAt: new Date(now.getTime() + 20 * DAY_MS) }); // not breaching
    seed(db, { id: "done", status: "COMPLETED", dueAt: new Date(now.getTime() + DAY_MS) });

    const out = await makeService(db).listBreaching("saleswitch", 5, now);
    expect(out.map((r) => r.id).sort()).toEqual(["near", "overdue"]);
  });

  it("markCompleted requires the shop as confirm text and audits completion", async () => {
    const db = new FakeDb();
    seed(db, { id: "r1", shop: "shop.myshopify.com", status: "RECEIVED" });
    const ctx = { actorUserId: "u1", appKey: "saleswitch", ip: null, userAgent: null };

    await expect(makeService(db).markCompleted(ctx, "r1", "wrong")).rejects.toBeInstanceOf(
      ConfirmationError,
    );
    expect(db.store.complianceRequest[0]!.status).toBe("RECEIVED"); // unchanged

    await makeService(db).markCompleted(ctx, "r1", "shop.myshopify.com");
    expect(db.store.complianceRequest[0]!.status).toBe("COMPLETED");
    expect(db.store.auditLog.some((a) => a.action === "compliance.completed")).toBe(true);
  });
});
