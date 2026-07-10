import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";

beforeAll(() => stubValidEnv());

const { addBusinessMinutes, computeDueTimes, budgetFor } = await import(
  "~/server/services/slaPolicy.js"
);

/**
 * cp-inbox-sla — the office-hours due-time calculator. Default policy (UTC, 09:00–
 * 17:00, Mon–Fri) since no BUSINESS_* env is set.
 */
describe("slaPolicy office-hours calculator", () => {
  it("accrues budget only during business hours, rolling to the next day", () => {
    // Mon 2026-06-01 15:00Z; 240 business minutes. 120 left today (→17:00), then
    // 120 on Tue from 09:00 → 11:00Z.
    const due = addBusinessMinutes(new Date("2026-06-01T15:00:00.000Z"), 240);
    expect(due.toISOString()).toBe("2026-06-02T11:00:00.000Z");
  });

  it("skips the weekend", () => {
    // Fri 2026-06-05 16:00Z; 120 min. 60 left Fri (→17:00), skip Sat/Sun, 60 on
    // Mon from 09:00 → 10:00Z.
    const due = addBusinessMinutes(new Date("2026-06-05T16:00:00.000Z"), 120);
    expect(due.toISOString()).toBe("2026-06-08T10:00:00.000Z");
  });

  it("no priority ⇒ no SLA (null due-times, null budget)", () => {
    expect(computeDueTimes("NONE", new Date("2026-06-01T10:00:00.000Z"))).toBeNull();
    expect(budgetFor("NONE")).toBeNull();
  });

  it("computes both first-response and resolution due-times for a priority", () => {
    const due = computeDueTimes("URGENT", new Date("2026-06-01T09:00:00.000Z"));
    expect(due).not.toBeNull();
    // URGENT: 60-min first response → 10:00Z; 240-min resolution → 13:00Z.
    expect(due!.firstResponseDueAt.toISOString()).toBe("2026-06-01T10:00:00.000Z");
    expect(due!.resolutionDueAt.toISOString()).toBe("2026-06-01T13:00:00.000Z");
  });
});
