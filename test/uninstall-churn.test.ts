import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => {
  stubValidEnv();
  // Exercise the gated retention purge ON path in this file.
  process.env.CHURN_RETENTION_PURGE_ENABLED = "true";
});

const { LifecycleService } = await import("~/server/services/lifecycleService.js");
const { getAuditService } = await import("~/server/services/auditService.js");

function makeSvc(db: FakeDb, onRollup?: () => void) {
  const kpi = { runRollup: async () => { onRollup?.(); return 0; } };
  return new LifecycleService(db as never, getAuditService(), kpi);
}

function uninstallEvent(shop = "gone.myshopify.com") {
  return { id: "whe_1", appKey: "saleswitch", topic: "app/uninstalled", shop, payload: {} } as never;
}

/** cp-uninstall-churn — record uninstall + audit (same tx), idempotent, churn recompute, gated purge. */
describe("LifecycleService", () => {
  it("records one UNINSTALL event + audit in the same transaction", async () => {
    const db = new FakeDb();
    let rolled = false;
    await makeSvc(db, () => { rolled = true; }).handleWebhook(uninstallEvent());
    expect(db.store.merchantLifecycleEvent).toHaveLength(1);
    expect(db.store.merchantLifecycleEvent[0]!.kind).toBe("UNINSTALL");
    const audit = db.store.auditLog.find((a) => a.action === "merchant.uninstalled");
    expect(audit).toBeTruthy();
    expect(audit!.actorType).toBe("SYSTEM");
    expect(audit!.source).toBe("JOB");
    expect(rolled).toBe(true); // churn KPI recomputed
  });

  it("rolls the record back when the same-tx audit insert fails", async () => {
    const db = new FakeDb();
    db.failAudit = true;
    // The failing audit aborts the tx (so the webhook worker retries) and the lifecycle
    // event is rolled back — no event exists without its audit row.
    await expect(makeSvc(db).handleWebhook(uninstallEvent())).rejects.toThrow();
    expect(db.store.merchantLifecycleEvent).toHaveLength(0);
  });

  it("dedupes a duplicate delivery (no double-count)", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    await svc.handleWebhook(uninstallEvent());
    await svc.handleWebhook(uninstallEvent()); // latest is already UNINSTALL → no-op
    expect(db.store.merchantLifecycleEvent).toHaveLength(1);
  });

  it("records a REINSTALL only when the latest lifecycle is UNINSTALL", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    const t1 = new Date("2026-06-01T00:00:00.000Z");
    const t2 = new Date("2026-06-02T00:00:00.000Z");
    // No prior lifecycle → not a churned shop → no reinstall.
    expect(await svc.recordReinstall("saleswitch", "fresh.myshopify.com", t2)).toBe(false);
    // After an uninstall, a reappearance is a reinstall.
    await svc.recordUninstall("saleswitch", "back.myshopify.com", t1);
    expect(await svc.recordReinstall("saleswitch", "back.myshopify.com", t2)).toBe(true);
    expect(
      db.store.merchantLifecycleEvent.some((e) => e.kind === "REINSTALL"),
    ).toBe(true);
    expect(db.store.auditLog.some((a) => a.action === "merchant.reinstalled")).toBe(true);
  });

  it("lists churned shops (latest lifecycle is UNINSTALL)", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    const t1 = new Date("2026-06-01T00:00:00.000Z");
    const t2 = new Date("2026-06-02T00:00:00.000Z");
    await svc.recordUninstall("saleswitch", "a.com", t1);
    await svc.recordUninstall("saleswitch", "b.com", t1);
    await svc.recordReinstall("saleswitch", "b.com", t2); // b came back
    const churned = await svc.churnedShops("saleswitch");
    expect(churned).toEqual(["a.com"]);
  });

  it("purges CP-owned PII for a redacted shop but never the audit log", async () => {
    const db = new FakeDb();
    db.store.merchantNote.push({ id: "mn1", appKey: "saleswitch", shop: "gone.com", body: "x" });
    db.store.conversation.push({ id: "cv1", appKey: "saleswitch", shop: "gone.com", status: "CLOSED" });
    db.store.auditLog.push({ id: "aud_keep", appKey: "saleswitch", action: "merchant.uninstalled" });

    const result = await makeSvc(db).purgeForRedactedShop("saleswitch", "gone.com");

    expect(result.purged).toBe(true);
    expect(db.store.merchantNote).toHaveLength(0);
    expect(db.store.conversation).toHaveLength(0);
    // The append-only audit log is preserved (plus a new purge audit row).
    expect(db.store.auditLog.some((a) => a.id === "aud_keep")).toBe(true);
  });
});
