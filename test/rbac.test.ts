import { describe, it, expect } from "vitest";
import { roleCan, defineAbilityFor } from "~/server/rbac.js";
import type { Action } from "~/server/rbac.js";

/** cp-auth-rbac — the RBAC matrix (PRD §4), enforced via CASL. */
describe("RBAC matrix", () => {
  const all: Action[] = [
    "view",
    "reply",
    "action:nondangerous",
    "action:dangerous",
    "audit:view",
    "roles:manage",
    "pii:view",
    "compliance:manage",
    "canned:manage",
    "ops:view",
    "impersonate",
    "flags:manage",
    "announcements:manage",
  ];

  it("VIEWER can only view", () => {
    expect(roleCan("VIEWER", "view")).toBe(true);
    for (const a of all.filter((x) => x !== "view")) {
      expect(roleCan("VIEWER", a)).toBe(false);
    }
  });

  it("SUPPORT can view + reply + non-dangerous + pii:view, but not dangerous/audit/roles/compliance", () => {
    expect(roleCan("SUPPORT", "view")).toBe(true);
    expect(roleCan("SUPPORT", "reply")).toBe(true);
    expect(roleCan("SUPPORT", "action:nondangerous")).toBe(true);
    expect(roleCan("SUPPORT", "pii:view")).toBe(true); // audited reveal path
    expect(roleCan("SUPPORT", "action:dangerous")).toBe(false);
    expect(roleCan("SUPPORT", "audit:view")).toBe(false);
    expect(roleCan("SUPPORT", "roles:manage")).toBe(false);
    expect(roleCan("SUPPORT", "compliance:manage")).toBe(false);
  });

  it("compliance:manage is ADMIN-only", () => {
    expect(roleCan("ADMIN", "compliance:manage")).toBe(true);
    expect(roleCan("SUPPORT", "compliance:manage")).toBe(false);
    expect(roleCan("VIEWER", "compliance:manage")).toBe(false);
  });

  it("canned:manage is ADMIN-only (SUPPORT may use, not manage)", () => {
    expect(roleCan("ADMIN", "canned:manage")).toBe(true);
    expect(roleCan("SUPPORT", "canned:manage")).toBe(false);
    expect(roleCan("VIEWER", "canned:manage")).toBe(false);
    // SUPPORT may still USE canned replies (reply-gated) and reply-class actions.
    expect(roleCan("SUPPORT", "reply")).toBe(true);
    // VIEWER cannot perform any reply-class action (priority/tags/internal note).
    expect(roleCan("VIEWER", "reply")).toBe(false);
  });

  it("ops:view is ADMIN + SUPPORT, not VIEWER (cp-ops-monitoring)", () => {
    expect(roleCan("ADMIN", "ops:view")).toBe(true);
    expect(roleCan("SUPPORT", "ops:view")).toBe(true);
    expect(roleCan("VIEWER", "ops:view")).toBe(false);
  });

  it("impersonate is ADMIN-only (cp-break-glass-rbac)", () => {
    expect(roleCan("ADMIN", "impersonate")).toBe(true);
    expect(roleCan("SUPPORT", "impersonate")).toBe(false);
    expect(roleCan("VIEWER", "impersonate")).toBe(false);
  });

  it("flags:manage + announcements:manage are ADMIN-only (cp-feature-flags / cp-announcements-nps)", () => {
    for (const a of ["flags:manage", "announcements:manage"] as Action[]) {
      expect(roleCan("ADMIN", a)).toBe(true);
      expect(roleCan("SUPPORT", a)).toBe(false);
      expect(roleCan("VIEWER", a)).toBe(false);
    }
    // Health reads (the 360 panel + at-risk list) stay under `view` for every role.
    expect(roleCan("VIEWER", "view")).toBe(true);
  });

  it("ADMIN can do everything", () => {
    for (const a of all) expect(roleCan("ADMIN", a)).toBe(true);
  });

  it("defineAbilityFor returns a usable CASL ability", () => {
    const ability = defineAbilityFor("ADMIN");
    expect(ability.can("audit:view", "all")).toBe(true);
    expect(defineAbilityFor("VIEWER").can("audit:view", "all")).toBe(false);
  });
});
