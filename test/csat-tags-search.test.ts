import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => stubValidEnv());

const { CsatService, InvalidCsatScoreError } = await import("~/server/services/csatService.js");
const { ConversationTagService } = await import("~/server/services/conversationTagService.js");
const { ConversationService } = await import("~/server/services/conversationService.js");

function seedConversation(db: FakeDb, id: string, over: Record<string, unknown> = {}): void {
  db.store.conversation.push({
    id,
    appKey: "saleswitch",
    shop: "shop.myshopify.com",
    status: "OPEN",
    assignedTo: null,
    subject: null,
    unreadCount: 0,
    priority: "NONE",
    slaState: "ON_TRACK",
    firstReplyAt: null,
    firstResponseDueAt: null,
    resolutionDueAt: null,
    csatScore: null,
    csatComment: null,
    lastMessageAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });
}

const tagCtx = {
  actorUserId: "u1",
  actorEmail: "agent@apoaap.com",
  appKey: "saleswitch",
  ip: null,
  userAgent: null,
};

describe("CsatService", () => {
  it("validates the score range", async () => {
    const db = new FakeDb();
    seedConversation(db, "c1");
    await expect(new CsatService(db as never).record("c1", 6)).rejects.toBeInstanceOf(
      InvalidCsatScoreError,
    );
  });

  it("records a score and is idempotent (no overwrite)", async () => {
    const db = new FakeDb();
    seedConversation(db, "c1");
    const svc = new CsatService(db as never);
    const first = await svc.record("c1", 5, "great");
    expect(first.recorded).toBe(true);
    expect(db.store.conversation[0]!.csatScore).toBe(5);

    const second = await svc.record("c1", 1, "changed mind");
    expect(second.recorded).toBe(false);
    expect(db.store.conversation[0]!.csatScore).toBe(5); // preserved
    expect(db.store.auditLog.filter((a) => a.action === "conversation.csat.recorded")).toHaveLength(1);
  });
});

describe("ConversationTagService", () => {
  it("adds a tag and treats a duplicate as a no-op", async () => {
    const db = new FakeDb();
    seedConversation(db, "c1");
    const svc = new ConversationTagService(db as never);
    await svc.addTag(tagCtx, "c1", "refund");
    await svc.addTag(tagCtx, "c1", "refund"); // duplicate → no-op
    expect(db.store.conversationTag.filter((t) => t.label === "refund")).toHaveLength(1);
  });

  it("removes a tag", async () => {
    const db = new FakeDb();
    seedConversation(db, "c1");
    const svc = new ConversationTagService(db as never);
    await svc.addTag(tagCtx, "c1", "vip");
    await svc.removeTag(tagCtx, "c1", "vip");
    expect(await svc.list("c1")).toEqual([]);
  });
});

describe("ConversationService.search", () => {
  it("matches by message body and by tag, and bounds the page", async () => {
    const db = new FakeDb();
    seedConversation(db, "c-body", { shop: "alpha.myshopify.com" });
    seedConversation(db, "c-tag", { shop: "beta.myshopify.com" });
    seedConversation(db, "c-none", { shop: "gamma.myshopify.com" });
    db.store.message.push({
      id: "m1",
      conversationId: "c-body",
      senderType: "MERCHANT",
      senderId: "alpha",
      body: "my CHECKOUT is broken",
      internal: false,
      createdAt: new Date(),
    });
    db.store.conversationTag.push({
      id: "t1",
      appKey: "saleswitch",
      conversationId: "c-tag",
      label: "checkout",
      createdAt: new Date(),
    });

    const svc = new ConversationService(db as never);
    const byBody = await svc.search("saleswitch", { query: "checkout" });
    expect(byBody.rows.map((r) => r.id).sort()).toEqual(["c-body", "c-tag"]);

    const paged = await svc.search("saleswitch", { pageSize: 2, page: 1 });
    expect(paged.rows).toHaveLength(2);
    expect(paged.total).toBe(3);
    expect(paged.truncated).toBe(true);
  });
});

describe("ConversationService.unreadTotal", () => {
  it("sums unread counts across open conversations only", async () => {
    const db = new FakeDb();
    seedConversation(db, "c1", { unreadCount: 2 });
    seedConversation(db, "c2", { unreadCount: 3 });
    seedConversation(db, "c3", { unreadCount: 5, status: "CLOSED" });

    const svc = new ConversationService(db as never);
    expect(await svc.unreadTotal("saleswitch")).toBe(5);
  });
});
