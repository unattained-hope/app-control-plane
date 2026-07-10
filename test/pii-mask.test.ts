import { describe, it, expect } from "vitest";
import { maskEmail } from "~/lib/pii.js";

/** cp-pii-governance — email is masked by default; the raw local part never leaks. */
describe("maskEmail", () => {
  it("keeps the first char + domain, masks the rest", () => {
    expect(maskEmail("founder@aurora.com")).toBe("f•••@aurora.com");
  });

  it("fully masks a single-character local part", () => {
    expect(maskEmail("a@b.com")).toBe("•••@b.com");
  });

  it("returns null for null/undefined/empty", () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail(undefined)).toBeNull();
    expect(maskEmail("")).toBeNull();
  });

  it("never returns the raw local part", () => {
    const masked = maskEmail("sensitive.person@example.com");
    expect(masked).not.toContain("sensitive");
    expect(masked).toContain("@example.com");
  });
});
