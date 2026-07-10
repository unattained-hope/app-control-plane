import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => stubValidEnv());

const { ConversationService } = await import("~/server/services/conversationService.js");

function seedConversation(db: FakeDb, id: string): void {
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
    lastMessageAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/** cp-canned-replies — internal notes are agent-only; the merchant never sees them. */
describe("internal notes", () => {
  it("merchant history omits internal notes; agent history includes them", async () => {
    const db = new FakeDb();
    seedConversation(db, "c1");
    const svc = new ConversationService(db as never);

    await svc.persistMessage({
      conversationId: "c1",
      senderType: "MERCHANT",
      senderId: "shop.myshopify.com",
      body: "hello",
    });
    await svc.postInternalNote("c1", "u1", "secret context for the team");
    await svc.persistMessage({
      conversationId: "c1",
      senderType: "AGENT",
      senderId: "u1",
      body: "public reply",
    });

    const agentView = await svc.history("c1");
    const merchantView = await svc.merchantHistory("c1");

    expect(agentView.map((m) => m.body)).toContain("secret context for the team");
    expect(merchantView.map((m) => m.body)).not.toContain("secret context for the team");
    expect(merchantView).toHaveLength(2); // merchant message + public reply
    expect(agentView.some((m) => m.internal)).toBe(true);
  });
});
