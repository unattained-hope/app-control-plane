import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => stubValidEnv());

const { AuditService, getAuditService } = await import("~/server/services/auditService.js");
const { AuditActions } = await import("~/lib/auditActions.js");

/** cp-audit-taxonomy — structured actor/source defaults + append-only structure. */
describe("AuditService structured fields", () => {
  it("defaults a UI staff write to INTERNAL/UI and records actorEmail", async () => {
    const db = new FakeDb();
    await new AuditService().append(
      {
        actorUserId: "u1",
        actorEmail: "agent@apoaap.com",
        appKey: "saleswitch",
        action: AuditActions.MerchantNoteAdd,
      },
      db as never,
    );
    const row = db.store.auditLog[0]!;
    expect(row.actorType).toBe("INTERNAL");
    expect(row.source).toBe("UI");
    expect(row.actorEmail).toBe("agent@apoaap.com");
  });

  it("records a background-job write as SYSTEM/JOB", async () => {
    const db = new FakeDb();
    await new AuditService().append(
      {
        actorUserId: "system:sla-sweep",
        actorType: "SYSTEM",
        source: "JOB",
        appKey: "saleswitch",
        action: AuditActions.ConversationSlaBreached,
      },
      db as never,
    );
    const row = db.store.auditLog[0]!;
    expect(row.actorType).toBe("SYSTEM");
    expect(row.source).toBe("JOB");
  });

  it("exposes no update/delete path (append-only)", () => {
    const svc = getAuditService() as unknown as Record<string, unknown>;
    expect(typeof svc.append).toBe("function");
    expect(typeof svc.query).toBe("function");
    expect(svc.update).toBeUndefined();
    expect(svc.delete).toBeUndefined();
  });

  it("uses the typed taxonomy constants (no free-text drift)", () => {
    expect(AuditActions.ConversationAssigned).toBe("conversation.assigned");
    expect(AuditActions.ConversationSlaBreached).toBe("conversation.sla.breached");
    expect(AuditActions.MerchantPiiView).toBe("merchant.pii.view");
  });
});
