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
  ];

  it("VIEWER can only view", () => {
    expect(roleCan("VIEWER", "view")).toBe(true);
    for (const a of all.filter((x) => x !== "view")) {
      expect(roleCan("VIEWER", a)).toBe(false);
    }
  });

  it("SUPPORT can view + reply + non-dangerous, but not dangerous/audit/roles", () => {
    expect(roleCan("SUPPORT", "view")).toBe(true);
    expect(roleCan("SUPPORT", "reply")).toBe(true);
    expect(roleCan("SUPPORT", "action:nondangerous")).toBe(true);
    expect(roleCan("SUPPORT", "action:dangerous")).toBe(false);
    expect(roleCan("SUPPORT", "audit:view")).toBe(false);
    expect(roleCan("SUPPORT", "roles:manage")).toBe(false);
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
