import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => stubValidEnv());

const { SlaService } = await import("~/server/services/slaService.js");
const { ConversationService } = await import("~/server/services/conversationService.js");

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60_000;

function seedConversation(db: FakeDb, over: Record<string, unknown>): string {
  const id = (over.id as string) ?? `cv_seed_${db.store.conversation.length}`;
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
  return id;
}

const ctx = {
  actorUserId: "u1",
  actorEmail: "agent@apoaap.com",
  appKey: "saleswitch",
  ip: null,
  userAgent: null,
};

describe("SlaService.setPriority", () => {
  it("computes due-times and audits the change (INTERNAL/UI) in the same tx", async () => {
    const db = new FakeDb();
    const id = seedConversation(db, { id: "c1" });
    await new SlaService(db as never).setPriority(ctx, "c1", "HIGH");

    const row = db.store.conversation[0]!;
    expect(row.priority).toBe("HIGH");
    expect(row.firstResponseDueAt).not.toBeNull();
    expect(row.resolutionDueAt).not.toBeNull();
    const audit = db.store.auditLog.find((a) => a.action === "conversation.priority.set");
    expect(audit).toBeTruthy();
    expect(audit!.actorType).toBe("INTERNAL");
    expect(audit!.source).toBe("UI");
    expect(audit!.actorEmail).toBe("agent@apoaap.com");
    expect(id).toBe("c1");
  });

  it("clears the SLA when priority is set to NONE", async () => {
    const db = new FakeDb();
    seedConversation(db, {
      id: "c1",
      priority: "HIGH",
      firstResponseDueAt: new Date(),
      resolutionDueAt: new Date(),
    });
    await new SlaService(db as never).setPriority(ctx, "c1", "NONE");
    const row = db.store.conversation[0]!;
    expect(row.priority).toBe("NONE");
    expect(row.firstResponseDueAt).toBeNull();
    expect(row.resolutionDueAt).toBeNull();
  });
});

describe("SlaService.sweep", () => {
  it("marks overdue→BREACHED, near-due→BREACHING; ignores NONE and replied/on-track", async () => {
    const db = new FakeDb();
    const now = new Date("2026-06-01T12:00:00.000Z");
    seedConversation(db, {
      id: "overdue",
      priority: "HIGH",
      firstResponseDueAt: new Date(now.getTime() - 1 * MIN_MS),
    });
    seedConversation(db, {
      id: "near",
      priority: "HIGH",
      firstResponseDueAt: new Date(now.getTime() + 10 * MIN_MS), // within 30-min warning
    });
    seedConversation(db, {
      id: "replied",
      priority: "HIGH",
      firstReplyAt: new Date(now.getTime() - DAY_MS),
      resolutionDueAt: new Date(now.getTime() + DAY_MS), // resolution far off
    });
    seedConversation(db, {
      id: "noprio",
      priority: "NONE",
      firstResponseDueAt: new Date(now.getTime() - DAY_MS),
    });

    const result = await new SlaService(db as never).sweep("saleswitch", now);
    expect(result).toEqual({ breaching: 1, breached: 1 });

    const byId = Object.fromEntries(db.store.conversation.map((c) => [c.id, c.slaState]));
    expect(byId.overdue).toBe("BREACHED");
    expect(byId.near).toBe("BREACHING");
    expect(byId.replied).toBe("ON_TRACK");
    expect(byId.noprio).toBe("ON_TRACK");

    // System/job attribution on the breach audit rows.
    const breach = db.store.auditLog.find((a) => a.action === "conversation.sla.breached");
    expect(breach!.actorType).toBe("SYSTEM");
    expect(breach!.source).toBe("JOB");
  });
});

describe("ConversationService first-reply stamping", () => {
  it("stamps firstReplyAt once on the first non-internal agent reply and marks MET", async () => {
    const db = new FakeDb();
    seedConversation(db, {
      id: "c1",
      priority: "HIGH",
      firstResponseDueAt: new Date(Date.now() + 60 * MIN_MS),
    });
    const svc = new ConversationService(db as never);

    await svc.persistMessage({
      conversationId: "c1",
      senderType: "AGENT",
      senderId: "u1",
      body: "first reply",
    });
    const afterFirst = db.store.conversation[0]!;
    const stamped = afterFirst.firstReplyAt as Date | null;
    expect(stamped).not.toBeNull();
    expect(afterFirst.slaState).toBe("MET");

    await svc.persistMessage({
      conversationId: "c1",
      senderType: "AGENT",
      senderId: "u1",
      body: "second reply",
    });
    expect((db.store.conversation[0]!.firstReplyAt as Date).getTime()).toBe(stamped!.getTime());
  });

  it("does not stamp firstReplyAt for an internal note", async () => {
    const db = new FakeDb();
    seedConversation(db, { id: "c1", priority: "HIGH" });
    const svc = new ConversationService(db as never);
    await svc.postInternalNote("c1", "u1", "internal only");
    expect(db.store.conversation[0]!.firstReplyAt).toBeNull();
  });
});
