import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";
import { storeChatAttachmentFile, readChatAttachmentFile } from "~/server/services/chatAttachmentStorage.js";

beforeAll(() => stubValidEnv());

const { ConversationService } = await import("~/server/services/conversationService.js");

function seedConversation(db: FakeDb, id: string, status: "OPEN" | "SNOOZED" | "CLOSED" = "OPEN"): void {
  db.store.conversation.push({
    id,
    appKey: "saleswitch",
    shop: "craft-theme.myshopify.com",
    status,
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

describe("P1 Core Workflow & Composer Essentials", () => {
  describe("ConversationService.setStatus", () => {
    it("updates status from OPEN to CLOSED and appends an audit log", async () => {
      const db = new FakeDb();
      seedConversation(db, "conv-1", "OPEN");
      const svc = new ConversationService(db as never);

      const actor = {
        actorUserId: "agent-1",
        actorEmail: "agent@apoaap.com",
        appKey: "saleswitch",
        ip: "127.0.0.1",
        userAgent: "vitest",
      };

      const result = await svc.setStatus(actor, "conv-1", "CLOSED");
      expect(result.status).toBe("CLOSED");

      const inDb = await db.conversation.findUnique({ where: { id: "conv-1" } });
      expect(inDb?.status).toBe("CLOSED");

      // Verify audit log
      const auditLogs = db.store.auditLog;
      expect(auditLogs).toHaveLength(1);
      const log = auditLogs[0];
      expect(log?.action).toBe("conversation.status.update");
      expect(log?.target).toBe("conv-1");
      expect(log?.actorUserId).toBe("agent-1");
      expect(log?.before).toEqual({ status: "OPEN" });
      expect(log?.after).toEqual({ status: "CLOSED" });
    });

    it("updates status from CLOSED to OPEN (reopen)", async () => {
      const db = new FakeDb();
      seedConversation(db, "conv-2", "CLOSED");
      const svc = new ConversationService(db as never);

      const actor = {
        actorUserId: "agent-1",
        actorEmail: "agent@apoaap.com",
        appKey: "saleswitch",
      };

      const result = await svc.setStatus(actor, "conv-2", "OPEN");
      expect(result.status).toBe("OPEN");

      const inDb = await db.conversation.findUnique({ where: { id: "conv-2" } });
      expect(inDb?.status).toBe("OPEN");
    });

    it("is idempotent when setting already existing status", async () => {
      const db = new FakeDb();
      seedConversation(db, "conv-3", "OPEN");
      const svc = new ConversationService(db as never);

      const actor = {
        actorUserId: "agent-1",
        appKey: "saleswitch",
      };

      const result = await svc.setStatus(actor, "conv-3", "OPEN");
      expect(result.status).toBe("OPEN");
      expect(db.store.auditLog).toHaveLength(0);
    });
  });

  describe("Internal note with attachment", () => {
    it("persists attachmentUrl on internal notes", async () => {
      const db = new FakeDb();
      seedConversation(db, "conv-4", "OPEN");
      const svc = new ConversationService(db as never);

      const note = await svc.postInternalNote(
        "conv-4",
        "agent-1",
        "Check this screenshot",
        "/api/chat/assets/conv-4/screenshot-123.png",
      );

      expect(note.internal).toBe(true);
      expect(note.attachmentUrl).toBe("/api/chat/assets/conv-4/screenshot-123.png");

      const history = await svc.history("conv-4");
      expect(history).toHaveLength(1);
      expect(history[0]?.attachmentUrl).toBe("/api/chat/assets/conv-4/screenshot-123.png");
    });
  });

  describe("chatAttachmentStorage", () => {
    it("stores and reads attachment files safely", async () => {
      const conversationId = "test-conv-attach";
      const filename = "test-debug.log";
      const content = new TextEncoder().encode("log output line 1\nlog output line 2");

      const url = await storeChatAttachmentFile(conversationId, filename, content, "text/plain");
      expect(url).toContain(`/api/chat/assets/${conversationId}/`);

      const storedFilename = decodeURIComponent(url.split("/").pop()!);
      const readResult = await readChatAttachmentFile(conversationId, storedFilename);

      expect(readResult.mimeType).toBe("text/plain");
      expect(readResult.data.toString()).toBe("log output line 1\nlog output line 2");
      expect(readResult.etag).toBeTruthy();
    });

    it("rejects files exceeding max bytes", async () => {
      const conversationId = "test-conv-attach-large";
      const filename = "huge.bin";
      const hugeData = new Uint8Array(20 * 1024 * 1024); // 20MB (exceeds 15MB cap)

      await expect(
        storeChatAttachmentFile(conversationId, filename, hugeData, "application/octet-stream"),
      ).rejects.toThrow(/exceeds maximum upload size/i);
    });
  });
});
