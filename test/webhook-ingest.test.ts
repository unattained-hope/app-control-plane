import { describe, it, expect, beforeAll, vi } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => stubValidEnv());

const { WebhookService } = await import("~/server/services/webhookService.js");

/** cp-webhook-ingestion — idempotent persist + enqueue; invalid → recorded, not enqueued. */
describe("WebhookService ingestion", () => {
  const input = {
    webhookId: "wh-1",
    topic: "customers/redact",
    shop: "aurora.myshopify.com",
    appKey: "saleswitch",
    raw: JSON.stringify({ shop_domain: "aurora.myshopify.com" }),
  };

  it("ingests a unique delivery once and enqueues once", async () => {
    const db = new FakeDb();
    const enqueue = vi.fn(async () => {});
    const svc = new WebhookService(db as never, enqueue);

    const first = await svc.ingest(input);
    const second = await svc.ingest(input); // duplicate delivery (same webhookId)

    expect(first).toEqual({ enqueued: true });
    expect(second).toEqual({ enqueued: false });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(db.store.webhookEvent).toHaveLength(1);
    const row = db.store.webhookEvent[0]!;
    expect(row.hmacValid).toBe(true);
    expect(row.status).toBe("RECEIVED");
  });

  it("records an invalid-HMAC delivery without enqueuing", async () => {
    const db = new FakeDb();
    const enqueue = vi.fn(async () => {});
    const svc = new WebhookService(db as never, enqueue);

    await svc.recordInvalid({ ...input, webhookId: "bad-1", raw: "not-json" });

    expect(enqueue).not.toHaveBeenCalled();
    expect(db.store.webhookEvent).toHaveLength(1);
    const row = db.store.webhookEvent[0]!;
    expect(row.hmacValid).toBe(false);
    expect(row.status).toBe("FAILED");
    expect(row.payload).toEqual({ _raw: "not-json" });
  });

  it("swallows a duplicate invalid delivery", async () => {
    const db = new FakeDb();
    const svc = new WebhookService(db as never, vi.fn(async () => {}));
    await svc.recordInvalid({ ...input, webhookId: "bad-2" });
    await svc.recordInvalid({ ...input, webhookId: "bad-2" });
    expect(db.store.webhookEvent).toHaveLength(1);
  });
});
