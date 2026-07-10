import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => stubValidEnv());

const { RoutingService } = await import("~/server/services/routingService.js");
const { getAuditService } = await import("~/server/services/auditService.js");

function presenceWith(online: string[]) {
  const set = new Set(online);
  return {
    isOnline: (id: string) => set.has(id),
    anyAgentOnline: () => set.size > 0,
    agentConnected: () => {},
    agentDisconnected: () => {},
    onlineCount: () => set.size,
  };
}

function seedRule(db: FakeDb, over: Record<string, unknown>): void {
  db.store.assignmentRule.push({
    id: (over.id as string) ?? `ar_${db.store.assignmentRule.length}`,
    appKey: "saleswitch",
    order: 1,
    matchField: "KEYWORD",
    matchValue: "billing",
    assignTo: null,
    setPriority: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });
}

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
    lastMessageAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });
}

const ctx = {
  actorUserId: "u1",
  actorEmail: "agent@apoaap.com",
  appKey: "saleswitch",
  ip: null,
  userAgent: null,
};

/** cp-conversation-routing — first-match-wins, presence-aware, audited assignment. */
describe("RoutingService.route", () => {
  it("applies the first matching rule by order", async () => {
    const db = new FakeDb();
    seedRule(db, { id: "r2", order: 2, matchValue: "billing", assignTo: "agentB" });
    seedRule(db, { id: "r1", order: 1, matchValue: "billing", assignTo: "agentA" });
    const svc = new RoutingService(db as never, getAuditService(), presenceWith(["agentA", "agentB"]) as never);
    const outcome = await svc.route("saleswitch", { shop: "s", firstMessageBody: "I have a billing issue" });
    expect(outcome.assignTo).toBe("agentA");
    expect(outcome.matchedRuleId).toBe("r1");
  });

  it("queues (no assignment) when the target agent is offline", async () => {
    const db = new FakeDb();
    seedRule(db, { matchValue: "billing", assignTo: "agentOffline" });
    const svc = new RoutingService(db as never, getAuditService(), presenceWith([]) as never);
    const outcome = await svc.route("saleswitch", { shop: "s", firstMessageBody: "billing help" });
    expect(outcome.assignTo).toBeNull();
    expect(outcome.matchedRuleId).not.toBeNull();
  });

  it("leaves the conversation unassigned when no rule matches", async () => {
    const db = new FakeDb();
    seedRule(db, { matchValue: "billing", assignTo: "agentA" });
    const svc = new RoutingService(db as never, getAuditService(), presenceWith(["agentA"]) as never);
    const outcome = await svc.route("saleswitch", { shop: "s", firstMessageBody: "general question" });
    expect(outcome.assignTo).toBeNull();
    expect(outcome.matchedRuleId).toBeNull();
  });
});

describe("RoutingService.assign", () => {
  it("audits the (re)assignment in the same transaction", async () => {
    const db = new FakeDb();
    seedConversation(db, "c1", { assignedTo: "agentA" });
    const svc = new RoutingService(db as never, getAuditService(), presenceWith([]) as never);
    await svc.assign(ctx, "c1", "agentB");
    expect(db.store.conversation[0]!.assignedTo).toBe("agentB");
    const audit = db.store.auditLog.find((a) => a.action === "conversation.assigned");
    expect(audit).toBeTruthy();
    expect(audit!.before).toEqual({ assignedTo: "agentA" });
    expect(audit!.after).toEqual({ assignedTo: "agentB" });
  });

  it("rolls back the assignment when the same-tx audit insert fails", async () => {
    const db = new FakeDb();
    db.failAudit = true;
    seedConversation(db, "c1", { assignedTo: "agentA" });
    const svc = new RoutingService(db as never, getAuditService(), presenceWith([]) as never);
    await expect(svc.assign(ctx, "c1", "agentB")).rejects.toThrow();
    expect(db.store.conversation[0]!.assignedTo).toBe("agentA"); // unchanged
    expect(db.store.auditLog).toHaveLength(0);
  });
});
