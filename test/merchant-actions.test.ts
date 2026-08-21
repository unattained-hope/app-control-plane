import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";
import { AuditActions } from "~/lib/auditActions.js";

beforeAll(() => stubValidEnv());

const { MerchantActionService, ConfirmationError } = await import(
  "~/server/services/merchantActionService.js"
);

const ACTOR = {
  id: "u1",
  email: "admin@apoaap.dev",
  name: "Admin User",
  role: "ADMIN" as const,
};

function makeCtx(confirmText = "shop.myshopify.com", appKey = "saleswitch") {
  return {
    actor: ACTOR,
    appKey,
    ip: "127.0.0.1",
    userAgent: "vitest",
    confirmText,
  };
}

describe("MerchantActionService — Notes and Tags", () => {
  it("adds, edits, and deletes notes in same transaction with audit", async () => {
    const db = new FakeDb();
    const svc = new MerchantActionService(db as never);

    // 1. Add note
    const { id } = await svc.addNote(makeCtx(), "shop.myshopify.com", "First customer note");
    expect(id).toBeDefined();
    expect(db.store.merchantNote).toHaveLength(1);
    expect(db.store.merchantNote[0]!.body).toBe("First customer note");
    expect(db.store.merchantNote[0]!.authorId).toBe("admin@apoaap.dev");
    expect(db.store.auditLog.some((a) => a.action === AuditActions.MerchantNoteAdd)).toBe(true);

    // 2. Edit note
    await svc.editNote(makeCtx(), id, "Updated customer note");
    expect(db.store.merchantNote[0]!.body).toBe("Updated customer note");
    expect(db.store.auditLog.some((a) => a.action === AuditActions.MerchantNoteEdit)).toBe(true);

    // 3. Delete note
    await svc.deleteNote(makeCtx(), id);
    expect(db.store.merchantNote).toHaveLength(0);
    expect(db.store.auditLog.some((a) => a.action === AuditActions.MerchantNoteDelete)).toBe(true);
  });

  it("adds and removes tags with deduplication and audit", async () => {
    const db = new FakeDb();
    const svc = new MerchantActionService(db as never);

    // 1. Add tag
    await svc.addTag(makeCtx(), "shop.myshopify.com", "vip");
    expect(db.store.merchantTag).toHaveLength(1);
    expect(db.store.merchantTag[0]!.label).toBe("vip");
    expect(db.store.auditLog.some((a) => a.action === AuditActions.MerchantTagAdd)).toBe(true);

    // 2. Add duplicate tag (idempotent no-op)
    await svc.addTag(makeCtx(), "shop.myshopify.com", "vip");
    expect(db.store.merchantTag).toHaveLength(1);

    // 3. Remove tag
    await svc.removeTag(makeCtx(), "shop.myshopify.com", "vip");
    expect(db.store.merchantTag).toHaveLength(0);
    expect(db.store.auditLog.some((a) => a.action === AuditActions.MerchantTagRemove)).toBe(true);
  });

  it("fails when confirmation text is mismatched if explicitly provided", async () => {
    const db = new FakeDb();
    const svc = new MerchantActionService(db as never);

    await expect(
      svc.addNote(makeCtx("wrong.myshopify.com"), "shop.myshopify.com", "Fails note"),
    ).rejects.toBeInstanceOf(ConfirmationError);

    await expect(
      svc.addTag(makeCtx("wrong.myshopify.com"), "shop.myshopify.com", "vip"),
    ).rejects.toBeInstanceOf(ConfirmationError);
  });
});
