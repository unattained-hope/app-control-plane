import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => stubValidEnv());

const { CannedReplyService, DuplicateShortcutError, renderCannedBody } = await import(
  "~/server/services/cannedReplyService.js"
);

const ctx = {
  actorUserId: "admin1",
  actorEmail: "admin@apoaap.com",
  appKey: "saleswitch",
  ip: null,
  userAgent: null,
};

/** cp-canned-replies — unique shortcut, audited create, server-side substitution. */
describe("CannedReplyService", () => {
  it("enforces an app-scoped unique shortcut", async () => {
    const db = new FakeDb();
    const svc = new CannedReplyService(db as never);
    await svc.create(ctx, { shortcut: "/welcome", title: "Welcome", body: "Hi" });
    await expect(
      svc.create(ctx, { shortcut: "/welcome", title: "Dup", body: "Hi again" }),
    ).rejects.toBeInstanceOf(DuplicateShortcutError);
    expect(db.store.cannedReply).toHaveLength(1);
  });

  it("audits creation", async () => {
    const db = new FakeDb();
    await new CannedReplyService(db as never).create(ctx, {
      shortcut: "/refund",
      title: "Refund",
      body: "Your refund is processed.",
    });
    expect(db.store.auditLog.some((a) => a.action === "canned.reply.create")).toBe(true);
  });
});

describe("renderCannedBody", () => {
  it("substitutes known variables and preserves unknown placeholders", () => {
    const out = renderCannedBody(
      "Hi {{merchant_name}} at {{shop}}, — {{agent_name}}. Ref {{ticket_id}}",
      { shop: "acme.myshopify.com", merchantName: "Acme", agentName: "Sam" },
    );
    expect(out).toBe("Hi Acme at acme.myshopify.com, — Sam. Ref {{ticket_id}}");
  });

  it("leaves a known variable blank when its value is absent, unknowns intact", () => {
    const out = renderCannedBody("{{shop}} / {{unknown}}", { shop: null });
    expect(out).toBe(" / {{unknown}}");
  });
});
