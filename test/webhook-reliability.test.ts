import { describe, it, expect, beforeAll, vi } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => stubValidEnv());

const { WebhookService } = await import("~/server/services/webhookService.js");
const { getAuditService } = await import("~/server/services/auditService.js");

const BASE = {
  webhookId: "wh-1",
  topic: "customers/redact",
  shop: "aurora.myshopify.com",
  appKey: "saleswitch",
  raw: JSON.stringify({ shop_domain: "aurora.myshopify.com" }),
};

function makeSvc(db: FakeDb) {
  const enqueue = vi.fn(async () => {});
  const reenqueue = vi.fn(async () => {});
  const svc = new WebhookService(db as never, enqueue, reenqueue, getAuditService());
  return { svc, enqueue, reenqueue };
}

const actor = { id: "u1", email: "admin@apoaap.io", ip: null, userAgent: null };

/** cp-webhook-reliability — content-hash dedupe, dead-letter, audited replay. */
describe("WebhookService reliability", () => {
  it("dedupes a same-body redelivery that carries a fresh webhook id", async () => {
    const db = new FakeDb();
    const { svc, enqueue } = makeSvc(db);

    const first = await svc.ingest(BASE);
    const second = await svc.ingest({ ...BASE, webhookId: "wh-2" }); // new id, same body

    expect(first).toEqual({ enqueued: true });
    expect(second).toEqual({ enqueued: false });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(db.store.webhookEvent).toHaveLength(1);
  });

  it("does not collapse genuinely distinct bodies", async () => {
    const db = new FakeDb();
    const { svc, enqueue } = makeSvc(db);

    await svc.ingest(BASE);
    const other = await svc.ingest({
      ...BASE,
      webhookId: "wh-2",
      raw: JSON.stringify({ shop_domain: "other.myshopify.com" }),
    });

    expect(other).toEqual({ enqueued: true });
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(db.store.webhookEvent).toHaveLength(2);
  });

  it("dead-letters an exhausted event and audits it with job provenance", async () => {
    const db = new FakeDb();
    const { svc } = makeSvc(db);
    db.store.webhookEvent.push({
      id: "whe_dl",
      appKey: "saleswitch",
      topic: "customers/redact",
      shop: "aurora.myshopify.com",
      status: "FAILED",
      attempts: 5,
    });

    await svc.deadLetter("whe_dl", new Error("boom"));

    expect(db.store.webhookEvent[0]!.status).toBe("DEAD_LETTER");
    const audit = db.store.auditLog.find((a) => a.action === "webhook.dead_lettered");
    expect(audit).toBeTruthy();
    expect(audit!.actorType).toBe("SYSTEM");
    expect(audit!.source).toBe("JOB");
  });

  it("dead-letter is idempotent", async () => {
    const db = new FakeDb();
    const { svc } = makeSvc(db);
    db.store.webhookEvent.push({ id: "x", appKey: "saleswitch", shop: null, status: "DEAD_LETTER", attempts: 5 });
    await svc.deadLetter("x", new Error("again"));
    // No second audit row for an already-dead-lettered event.
    expect(db.store.auditLog.filter((a) => a.action === "webhook.dead_lettered")).toHaveLength(0);
  });

  it("replays a dead-lettered event: resets to RECEIVED, re-enqueues, audits in-tx", async () => {
    const db = new FakeDb();
    const { svc, reenqueue } = makeSvc(db);
    db.store.webhookEvent.push({
      id: "whe_r",
      appKey: "saleswitch",
      topic: "customers/redact",
      shop: "aurora.myshopify.com",
      status: "DEAD_LETTER",
      attempts: 5,
    });

    await svc.replay(actor, "saleswitch", "whe_r");

    expect(db.store.webhookEvent[0]!.status).toBe("RECEIVED");
    expect(db.store.webhookEvent[0]!.attempts).toBe(5); // kept for the record
    expect(reenqueue).toHaveBeenCalledWith("whe_r");
    expect(db.store.auditLog.some((a) => a.action === "webhook.replayed")).toBe(true);
  });

  it("rolls back a replay (and does not re-enqueue) when the audit insert fails", async () => {
    const db = new FakeDb();
    const { svc, reenqueue } = makeSvc(db);
    db.store.webhookEvent.push({ id: "whe_f", appKey: "saleswitch", shop: null, status: "DEAD_LETTER", attempts: 5 });
    db.failAudit = true;

    await expect(svc.replay(actor, "saleswitch", "whe_f")).rejects.toThrow();

    expect(db.store.webhookEvent[0]!.status).toBe("DEAD_LETTER"); // unchanged
    expect(reenqueue).not.toHaveBeenCalled(); // re-enqueue is after the committed tx
  });

  it("refuses to replay an event from another app", async () => {
    const db = new FakeDb();
    const { svc } = makeSvc(db);
    db.store.webhookEvent.push({ id: "whe_o", appKey: "other-app", shop: null, status: "DEAD_LETTER", attempts: 5 });
    await expect(svc.replay(actor, "saleswitch", "whe_o")).rejects.toThrow();
  });

  it("listFailed returns FAILED + DEAD_LETTER, newest first, paginated", async () => {
    const db = new FakeDb();
    const { svc } = makeSvc(db);
    const base = { appKey: "saleswitch", topic: "customers/redact", shop: null, attempts: 1 };
    db.store.webhookEvent.push({ id: "a", ...base, status: "FAILED", receivedAt: new Date("2026-06-01") });
    db.store.webhookEvent.push({ id: "b", ...base, status: "DEAD_LETTER", receivedAt: new Date("2026-06-02") });
    db.store.webhookEvent.push({ id: "c", ...base, status: "PROCESSED", receivedAt: new Date("2026-06-03") });

    const out = await svc.listFailed({ appKey: "saleswitch" });
    expect(out.map((r) => r.id)).toEqual(["b", "a"]); // PROCESSED excluded, newest first
  });
});
