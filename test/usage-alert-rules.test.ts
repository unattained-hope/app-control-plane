// test/usage-alert-rules.test.ts
// ADMIN management of the usage alert-rule registry (cp usage-alerts-digest, P5): CRUD +
// same-transaction audit at the service, and RBAC (`usage_alerts:manage` ADMIN-only) at
// the router. FakeDb drives the service; the router is exercised through defineAbilityFor.
import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";

beforeAll(() => stubValidEnv());

const { UsageAlertRuleService, UsageAlertRuleKeyConflictError, UsageAlertRuleNotFoundError } =
  await import("~/server/services/usageAlertRuleService.js");
const { getAuditService } = await import("~/server/services/auditService.js");
const { defineAbilityFor } = await import("~/server/rbac.js");

const APP = "saleswitch";
const actor = { id: "admin1", email: "admin@apoaap.io", ip: null, userAgent: null };

function makeSvc(db: FakeDb) {
  return new UsageAlertRuleService(db as never, getAuditService());
}

const sample = {
  key: "wizard-drop",
  label: "Wizard completion drop",
  metricKind: "METRIC_WOW_POINTS" as const,
  metric: "usage.funnel.stage",
  dimension: "completed",
  comparison: "DROP_GT" as const,
  threshold: 0.1,
};

describe("UsageAlertRuleService", () => {
  it("creates a rule (disabled by default) and audits usage.alert.rule.create", async () => {
    const db = new FakeDb();
    const rule = await makeSvc(db).create(actor, APP, sample);
    expect(rule.enabled).toBe(false);
    expect(db.store.usageAlertRule).toHaveLength(1);
    expect(db.store.auditLog.some((a) => a.action === "usage.alert.rule.create")).toBe(true);
  });

  it("rejects a duplicate key for the same app", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    await svc.create(actor, APP, sample);
    await expect(svc.create(actor, APP, sample)).rejects.toBeInstanceOf(
      UsageAlertRuleKeyConflictError,
    );
  });

  it("edits the threshold and audits usage.alert.rule.update", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    const rule = await svc.create(actor, APP, sample);
    const updated = await svc.update(actor, APP, rule.id, { threshold: 0.25 });
    expect(updated.threshold).toBe(0.25);
    expect(db.store.auditLog.some((a) => a.action === "usage.alert.rule.update")).toBe(true);
  });

  it("enables/disables with the specific audited transition", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    const rule = await svc.create(actor, APP, sample);
    await svc.setEnabled(actor, APP, rule.id, true);
    expect(db.store.usageAlertRule[0]!.enabled).toBe(true);
    expect(db.store.auditLog.some((a) => a.action === "usage.alert.rule.enable")).toBe(true);
    await svc.setEnabled(actor, APP, rule.id, false);
    expect(db.store.usageAlertRule[0]!.enabled).toBe(false);
    expect(db.store.auditLog.some((a) => a.action === "usage.alert.rule.disable")).toBe(true);
  });

  it("deletes a rule and audits usage.alert.rule.delete", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    const rule = await svc.create(actor, APP, sample);
    await svc.remove(actor, APP, rule.id);
    expect(db.store.usageAlertRule).toHaveLength(0);
    expect(db.store.auditLog.some((a) => a.action === "usage.alert.rule.delete")).toBe(true);
  });

  it("throws NotFound for a rule scoped to a different app", async () => {
    const db = new FakeDb();
    const svc = makeSvc(db);
    const rule = await svc.create(actor, APP, sample);
    await expect(svc.update(actor, "other-app", rule.id, { threshold: 1 })).rejects.toBeInstanceOf(
      UsageAlertRuleNotFoundError,
    );
  });

  it("rolls back the create when the audit write fails (same-transaction)", async () => {
    const db = new FakeDb();
    db.failAudit = true;
    await expect(makeSvc(db).create(actor, APP, sample)).rejects.toThrow();
    // The rule insert must have rolled back with the failed audit.
    expect(db.store.usageAlertRule).toHaveLength(0);
  });
});

describe("usage_alerts:manage RBAC (router gate)", () => {
  it("grants ADMIN and denies SUPPORT/VIEWER", () => {
    expect(defineAbilityFor("ADMIN").can("usage_alerts:manage", "all")).toBe(true);
    expect(defineAbilityFor("SUPPORT").can("usage_alerts:manage", "all")).toBe(false);
    expect(defineAbilityFor("VIEWER").can("usage_alerts:manage", "all")).toBe(false);
  });
});
