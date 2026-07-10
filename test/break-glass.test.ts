import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => stubValidEnv());

const { BreakGlassService, BreakGlassRequiredError, BreakGlassReasonRequiredError } =
  await import("~/server/services/breakGlassService.js");
const { getAuditService } = await import("~/server/services/auditService.js");

const NOW = new Date("2026-06-28T12:00:00.000Z");
const actor = { id: "u1", email: "agent@apoaap.io", ip: null, userAgent: null };

function makeSvc(db: FakeDb) {
  return new BreakGlassService(db as never, getAuditService());
}

/** cp-break-glass-rbac — justified, time-boxed grants gating PII reveal + impersonation. */
describe("BreakGlassService", () => {
  it("requires a reason", async () => {
    const db = new FakeDb();
    await expect(
      makeSvc(db).request(actor, { appKey: "saleswitch", scope: "PII_REVEAL", reason: "  " }),
    ).rejects.toBeInstanceOf(BreakGlassReasonRequiredError);
    expect(db.store.breakGlassGrant).toHaveLength(0);
  });

  it("self-activates a non-sensitive PII grant with a TTL expiry, audited", async () => {
    const db = new FakeDb();
    const grant = await makeSvc(db).request(
      actor,
      { appKey: "saleswitch", scope: "PII_REVEAL", targetShop: "aurora.myshopify.com", reason: "support case #12" },
      NOW,
    );
    expect(grant.status).toBe("ACTIVE");
    expect((grant.expiresAt as Date).getTime()).toBe(NOW.getTime() + 30 * 60_000);
    expect(db.store.auditLog.some((a) => a.action === "breakglass.activated")).toBe(true);
  });

  it("holds a sensitive impersonation grant for approval", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    const grant = await svc.request(
      { ...actor, id: "admin1" },
      { appKey: "saleswitch", scope: "IMPERSONATION", reason: "debug a stuck session" },
      NOW,
    );
    expect(grant.status).toBe("REQUESTED");
    expect(db.store.auditLog.some((a) => a.action === "breakglass.requested")).toBe(true);

    const approved = await svc.approve({ ...actor, id: "admin2" }, "saleswitch", grant.id, NOW);
    expect(approved.status).toBe("ACTIVE");
    expect(approved.approverUserId).toBe("admin2");
    expect(db.store.auditLog.some((a) => a.action === "breakglass.approved")).toBe(true);
  });

  it("rolls back a request when the same-tx audit insert fails", async () => {
    const db = new FakeDb();
    db.failAudit = true;
    await expect(
      makeSvc(db).request(actor, { appKey: "saleswitch", scope: "PII_REVEAL", reason: "x" }),
    ).rejects.toThrow();
    expect(db.store.breakGlassGrant).toHaveLength(0);
  });

  it("requireActiveGrant authorizes only with a live, covering grant", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);

    // No grant → forbidden.
    await expect(
      svc.requireActiveGrant("saleswitch", "u1", "PII_REVEAL", "aurora.myshopify.com", NOW),
    ).rejects.toBeInstanceOf(BreakGlassRequiredError);

    // An active grant for the shop → authorized.
    await svc.request(
      actor,
      { appKey: "saleswitch", scope: "PII_REVEAL", targetShop: "aurora.myshopify.com", reason: "ok" },
      NOW,
    );
    const grant = await svc.requireActiveGrant(
      "saleswitch",
      "u1",
      "PII_REVEAL",
      "aurora.myshopify.com",
      NOW,
    );
    expect(grant.status).toBe("ACTIVE");
  });

  it("an expired grant no longer authorizes", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    await svc.request(
      actor,
      { appKey: "saleswitch", scope: "PII_REVEAL", targetShop: "aurora.myshopify.com", reason: "ok" },
      NOW,
    );
    // 31 minutes later, the 30-minute grant has lapsed.
    const later = new Date(NOW.getTime() + 31 * 60_000);
    await expect(
      svc.requireActiveGrant("saleswitch", "u1", "PII_REVEAL", "aurora.myshopify.com", later),
    ).rejects.toBeInstanceOf(BreakGlassRequiredError);
  });

  it("sweeps expired ACTIVE grants to EXPIRED, audited SYSTEM/JOB", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    await svc.request(
      actor,
      { appKey: "saleswitch", scope: "PII_REVEAL", reason: "ok" },
      NOW,
    );
    const later = new Date(NOW.getTime() + 31 * 60_000);

    const swept = await svc.sweepExpired("saleswitch", later);

    expect(swept).toBe(1);
    expect(db.store.breakGlassGrant[0]!.status).toBe("EXPIRED");
    const audit = db.store.auditLog.find((a) => a.action === "breakglass.expired");
    expect(audit).toBeTruthy();
    expect(audit!.actorType).toBe("SYSTEM");
    expect(audit!.source).toBe("JOB");
  });
});
