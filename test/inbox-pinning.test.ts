import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => stubValidEnv());

const { ConversationService } = await import("~/server/services/conversationService.js");

describe("Conversation sorting and pinning", () => {
  let db: FakeDb;
  let service: InstanceType<typeof ConversationService>;

  beforeEach(() => {
    db = new FakeDb();
    service = new ConversationService(db as any);
  });

  it("sorts conversations by recency (most recent lastMessageAt first)", async () => {
    const c1 = await db.conversation.create({
      data: {
        appKey: "saleswitch",
        shop: "shop1.myshopify.com",
        status: "OPEN",
        lastMessageAt: new Date("2026-08-01T10:00:00Z"),
      },
    });

    const c2 = await db.conversation.create({
      data: {
        appKey: "saleswitch",
        shop: "shop2.myshopify.com",
        status: "OPEN",
        lastMessageAt: new Date("2026-08-01T12:00:00Z"),
      },
    });

    const c3 = await db.conversation.create({
      data: {
        appKey: "saleswitch",
        shop: "shop3.myshopify.com",
        status: "OPEN",
        lastMessageAt: new Date("2026-08-01T11:00:00Z"),
      },
    });

    const res = await service.listConversations("saleswitch");
    expect(res.map((c) => c.shop)).toEqual([
      "shop2.myshopify.com", // 12:00
      "shop3.myshopify.com", // 11:00
      "shop1.myshopify.com", // 10:00
    ]);
  });

  it("places pinned conversations at the highest priority above newer unpinned conversations", async () => {
    const c1 = await db.conversation.create({
      data: {
        appKey: "saleswitch",
        shop: "old-pinned.myshopify.com",
        status: "OPEN",
        pinned: true,
        pinnedAt: new Date("2026-08-01T08:00:00Z"),
        lastMessageAt: new Date("2026-08-01T08:00:00Z"),
      },
    });

    const c2 = await db.conversation.create({
      data: {
        appKey: "saleswitch",
        shop: "new-unpinned.myshopify.com",
        status: "OPEN",
        pinned: false,
        lastMessageAt: new Date("2026-08-01T15:00:00Z"),
      },
    });

    const c3 = await db.conversation.create({
      data: {
        appKey: "saleswitch",
        shop: "new-pinned.myshopify.com",
        status: "OPEN",
        pinned: true,
        pinnedAt: new Date("2026-08-01T10:00:00Z"),
        lastMessageAt: new Date("2026-08-01T10:00:00Z"),
      },
    });

    const res = await service.listConversations("saleswitch");
    expect(res.map((c) => c.shop)).toEqual([
      "new-pinned.myshopify.com", // pinned (10:00)
      "old-pinned.myshopify.com", // pinned (08:00)
      "new-unpinned.myshopify.com", // unpinned (15:00)
    ]);
  });

  it("toggles pin status and audits the change", async () => {
    const c = await db.conversation.create({
      data: {
        appKey: "saleswitch",
        shop: "toggle-test.myshopify.com",
        status: "OPEN",
        pinned: false,
      },
    });

    const actor = {
      actorUserId: "agent-1",
      actorEmail: "agent@apoaap.com",
      appKey: "saleswitch",
    };

    const pinned = await service.setPinned(actor, c.id, true);
    expect(pinned.pinned).toBe(true);
    expect(db.store.conversation[0]!.pinned).toBe(true);

    const audit = db.store.auditLog.find((a) => a.action === "conversation.pin.update");
    expect(audit).toBeDefined();
    expect(audit!.before).toEqual({ pinned: false });
    expect(audit!.after).toEqual({ pinned: true });

    // Unpin
    const unpinned = await service.setPinned(actor, c.id, false);
    expect(unpinned.pinned).toBe(false);
  });
});
