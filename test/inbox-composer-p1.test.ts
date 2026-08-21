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
  describe("ConversationService.assign", () => {
    it("audits the (re)assignment in the same transaction", async () => {
      const db = new FakeDb();
      seedConversation(db, "conv-assign-1", "OPEN");
      db.store.conversation[0]!.assignedTo = "agentA";
      const svc = new ConversationService(db as never);

      const actor = {
        actorUserId: "u1",
        actorEmail: "agent@apoaap.com",
        appKey: "saleswitch",
        ip: null,
        userAgent: null,
      };

      await svc.assign(actor, "conv-assign-1", "agentB");
      expect(db.store.conversation[0]!.assignedTo).toBe("agentB");
      const audit = db.store.auditLog.find((a) => a.action === "conversation.assigned");
      expect(audit).toBeTruthy();
      expect(audit!.before).toEqual({ assignedTo: "agentA" });
      expect(audit!.after).toEqual({ assignedTo: "agentB" });
    });

    it("rolls back the assignment when the same-tx audit insert fails", async () => {
      const db = new FakeDb();
      db.failAudit = true;
      seedConversation(db, "conv-assign-2", "OPEN");
      db.store.conversation[0]!.assignedTo = "agentA";
      const svc = new ConversationService(db as never);

      const actor = {
        actorUserId: "u1",
        actorEmail: "agent@apoaap.com",
        appKey: "saleswitch",
        ip: null,
        userAgent: null,
      };

      await expect(svc.assign(actor, "conv-assign-2", "agentB")).rejects.toThrow();
      expect(db.store.conversation[0]!.assignedTo).toBe("agentA"); // unchanged
      expect(db.store.auditLog).toHaveLength(0);
    });
  });

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

  describe("api.chat.upload action handler", () => {
    it("accepts uploads from authenticated agents", async () => {
      const { setDbForTesting } = await import("~/server/db.js");
      const db = new FakeDb();
      db.store.adminUser.push({
        id: "agent-1",
        email: "agent@apoaap.com",
        name: "Dev Support",
        role: "SUPPORT",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      setDbForTesting(db as never);

      const { action } = await import("~/routes/api.chat.upload.js");
      const fileData = new TextEncoder().encode("screenshot data");
      const file = new File([fileData], "screenshot.png", { type: "image/png" });

      const formData = new FormData();
      formData.append("file", file);

      const req = new Request("http://localhost:3000/api/chat/upload?conversationId=conv-upload-agent", {
        method: "POST",
        headers: {
          "x-admin-role": "SUPPORT",
          "x-admin-email": "agent@apoaap.com",
        },
        body: formData,
      });

      const res = await action({ request: req, params: {}, context: {} } as never);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.attachmentUrl).toContain("/api/chat/assets/conv-upload-agent/");
      expect(json.filename).toBe("screenshot.png");
      expect(json.mimeType).toBe("image/png");
    });

    it("accepts uploads from merchants with valid shop token", async () => {
      const { setDbForTesting } = await import("~/server/db.js");
      const db = new FakeDb();
      setDbForTesting(db as never);

      const { action } = await import("~/routes/api.chat.upload.js");
      const { mintShopToken } = await import("~/server/realtime/sessionToken.js");
      const token = mintShopToken("test-shop.myshopify.com", "saleswitch");

      const fileData = new TextEncoder().encode("merchant log file");
      const file = new File([fileData], "error.log", { type: "text/plain" });

      const formData = new FormData();
      formData.append("file", file);

      const req = new Request(`http://localhost:3000/api/chat/upload?conversationId=conv-upload-merchant&token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: {
          "x-shop-token": token,
        },
        body: formData,
      });

      const res = await action({ request: req, params: {}, context: {} } as never);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.attachmentUrl).toContain("/api/chat/assets/conv-upload-merchant/");
      expect(json.filename).toBe("error.log");
    });

    it("rejects unauthorized uploads without agent credentials or shop token", async () => {
      const { setDbForTesting } = await import("~/server/db.js");
      const db = new FakeDb();
      setDbForTesting(db as never);

      const { action } = await import("~/routes/api.chat.upload.js");
      const formData = new FormData();
      formData.append("file", new File(["test"], "test.txt", { type: "text/plain" }));

      const req = new Request("http://localhost:3000/api/chat/upload?conversationId=conv-unauth", {
        method: "POST",
        body: formData,
      });

      const res = await action({ request: req, params: {}, context: {} } as never);
      expect(res.status).toBe(403);
    });
  });
});
