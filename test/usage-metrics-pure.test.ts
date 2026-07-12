// test/usage-metrics-pure.test.ts
// The pure usage-analytics vocabulary + scorers (usage-analytics Phase 3): lifecycle
// precedence, intensity weighting + percentile bucketing, persona rules, and the
// UTC-day / ISO-week helpers. No DB — config is stubbed with defaults.
import { describe, it, expect, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import {
  assignLifecycle,
  assignPersonas,
  intensityScore,
  intensityBand,
  percentileValue,
  median,
  utcDayStart,
  utcDayEnd,
  isoWeekStart,
  weekOffset,
  daysBetween,
  type LifecycleSignals,
  type PersonaCounts,
} from "~/lib/usageMetrics.js";

beforeAll(() => stubValidEnv());

const NOW = new Date("2026-07-11T12:00:00.000Z"); // a Saturday
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function lifecycle(over: Partial<LifecycleSignals>): LifecycleSignals {
  return {
    installedAt: daysAgo(100),
    uninstalled: false,
    firstActivationAt: daysAgo(90),
    activeInTrailing30d: true,
    ...over,
  };
}

describe("assignLifecycle precedence", () => {
  it("CHURNED wins over everything when uninstalled", () => {
    expect(assignLifecycle(lifecycle({ uninstalled: true, installedAt: daysAgo(1) }), NOW)).toBe(
      "CHURNED",
    );
  });

  it("NEW at the 6-day edge, ONBOARDING/other past 7 days", () => {
    // 6 days installed, never activated → NEW (recency beats the no-activation rule).
    expect(
      assignLifecycle(lifecycle({ installedAt: daysAgo(6), firstActivationAt: null }), NOW),
    ).toBe("NEW");
    // 7 days installed, never activated → no longer NEW → ONBOARDING.
    expect(
      assignLifecycle(lifecycle({ installedAt: daysAgo(7), firstActivationAt: null }), NOW),
    ).toBe("ONBOARDING");
  });

  it("ONBOARDING when installed but never activated (past the NEW window)", () => {
    expect(
      assignLifecycle(lifecycle({ installedAt: daysAgo(40), firstActivationAt: null }), NOW),
    ).toBe("ONBOARDING");
  });

  it("ACTIVATED within 30 days of first activation, then ENGAGED", () => {
    expect(
      assignLifecycle(lifecycle({ installedAt: daysAgo(40), firstActivationAt: daysAgo(30) }), NOW),
    ).toBe("ACTIVATED"); // exactly 30 days → still ACTIVATED (inclusive)
    expect(
      assignLifecycle(lifecycle({ installedAt: daysAgo(60), firstActivationAt: daysAgo(31) }), NOW),
    ).toBe("ENGAGED"); // past 30 days, still active in last 30d
  });

  it("DORMANT when installed + activated long ago and silent 30 days", () => {
    expect(
      assignLifecycle(
        lifecycle({
          installedAt: daysAgo(120),
          firstActivationAt: daysAgo(100),
          activeInTrailing30d: false,
        }),
        NOW,
      ),
    ).toBe("DORMANT");
  });
});

describe("intensityScore + intensityBand", () => {
  it("weights counts per the configured defaults (5/2/1/1)", () => {
    // 2 campaigns (×5) + 3 wizard sessions (×2) + 4 edits (×1) + 5 active days (×1) = 25.
    expect(
      intensityScore({
        campaignsActivated: 2,
        wizardSessions: 3,
        templateEdits: 4,
        activeDays: 5,
      }),
    ).toBe(2 * 5 + 3 * 2 + 4 + 5);
  });

  it("zero score is always INACTIVE, regardless of population", () => {
    expect(intensityBand(0, [10, 20, 30])).toBe("INACTIVE");
  });

  it("buckets by percentile of the non-zero population (P90 POWER / P50 REGULAR)", () => {
    // Ascending scores 1..10; nearest-rank P90 = ceil(0.9*10)=9th value = 9 (POWER cut);
    // P50 = ceil(0.5*10)=5th value = 5 (REGULAR cut).
    const pop = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(intensityBand(10, pop)).toBe("POWER"); // >= P90 cut (9)
    expect(intensityBand(9, pop)).toBe("POWER"); // exactly the P90 cut
    expect(intensityBand(8, pop)).toBe("REGULAR"); // >= P50 (5), < P90 (9)
    expect(intensityBand(5, pop)).toBe("REGULAR"); // exactly P50 cut
    expect(intensityBand(4, pop)).toBe("LIGHT"); // below P50 cut
  });

  it("percentileValue uses nearest-rank on an ascending array", () => {
    expect(percentileValue([10, 20, 30, 40], 0.5)).toBe(20); // ceil(2)=2 → idx1
    expect(percentileValue([10, 20, 30, 40], 0.9)).toBe(40);
    expect(percentileValue([], 0.5)).toBe(0);
  });
});

describe("median (deterministic p50 for the dwell metric)", () => {
  it("returns the middle element for an odd count (order-independent)", () => {
    expect(median([1000, 3000, 2000])).toBe(2000); // hand-computed fixture
    expect(median([5])).toBe(5);
  });

  it("averages the two middles for an even count", () => {
    expect(median([1000, 2000])).toBe(1500); // hand-computed fixture
    expect(median([4, 1, 3, 2])).toBe(2.5); // sorted [1,2,3,4] → (2+3)/2
  });

  it("returns null for an empty sample (so callers skip, never fake a 0)", () => {
    expect(median([])).toBeNull();
  });
});

describe("assignPersonas rule thresholds", () => {
  function counts(over: Partial<PersonaCounts>): PersonaCounts {
    return {
      campaignsActivated: 0,
      badgeEvents: 0,
      bannerEvents: 0,
      recurrenceEvents: 0,
      flowEvents: 0,
      marketsSyncEnabled: false,
      distinctFeatures: 0,
      active: true,
      ...over,
    };
  }

  it("multi-persona: heavy badges + recurrence → BADGE_DESIGNER + AUTOMATION_USER", () => {
    const tags = assignPersonas(counts({ badgeEvents: 5, recurrenceEvents: 2, distinctFeatures: 2 }));
    expect(tags).toContain("BADGE_DESIGNER");
    expect(tags).toContain("AUTOMATION_USER");
  });

  it("AUTOMATION_USER fires on Flow ≥2 even without recurrence", () => {
    expect(assignPersonas(counts({ flowEvents: 2, distinctFeatures: 1 }))).toContain(
      "AUTOMATION_USER",
    );
    expect(assignPersonas(counts({ flowEvents: 1, distinctFeatures: 1 }))).not.toContain(
      "AUTOMATION_USER",
    );
  });

  it("MULTI_MARKET on markets-sync; DISCOUNT_ORCHESTRATOR at the ≥3 threshold", () => {
    expect(assignPersonas(counts({ marketsSyncEnabled: true, distinctFeatures: 1 }))).toContain(
      "MULTI_MARKET",
    );
    expect(assignPersonas(counts({ campaignsActivated: 3, distinctFeatures: 1 }))).toContain(
      "DISCOUNT_ORCHESTRATOR",
    );
  });

  it("MINIMALIST only when active and breadth ≤ max (default 1)", () => {
    // Active, one feature (a single campaign) → MINIMALIST.
    expect(assignPersonas(counts({ campaignsActivated: 1, distinctFeatures: 1 }))).toContain(
      "MINIMALIST",
    );
    // Two features → not minimalist.
    expect(assignPersonas(counts({ distinctFeatures: 2 }))).not.toContain("MINIMALIST");
    // Inactive → never minimalist even at zero breadth.
    expect(assignPersonas(counts({ active: false, distinctFeatures: 0 }))).not.toContain(
      "MINIMALIST",
    );
  });
});

describe("UTC-day + ISO-week helpers", () => {
  it("utcDayStart/utcDayEnd bracket the UTC day", () => {
    expect(utcDayStart(NOW).toISOString()).toBe("2026-07-11T00:00:00.000Z");
    expect(utcDayEnd(NOW).toISOString()).toBe("2026-07-12T00:00:00.000Z");
  });

  it("isoWeekStart returns the Monday of the ISO week", () => {
    // 2026-07-11 is a Saturday; its ISO week Monday is 2026-07-06.
    expect(isoWeekStart(NOW).toISOString()).toBe("2026-07-06T00:00:00.000Z");
    // A Sunday maps back to the previous Monday.
    expect(isoWeekStart(new Date("2026-07-12T10:00:00Z")).toISOString()).toBe(
      "2026-07-06T00:00:00.000Z",
    );
    // The Monday maps to itself.
    expect(isoWeekStart(new Date("2026-07-06T23:00:00Z")).toISOString()).toBe(
      "2026-07-06T00:00:00.000Z",
    );
  });

  it("weekOffset counts whole ISO weeks from cohort week-0", () => {
    const wk0 = isoWeekStart(NOW); // 2026-07-06
    expect(weekOffset(wk0, new Date("2026-07-08T00:00:00Z"))).toBe(0); // same week
    expect(weekOffset(wk0, new Date("2026-07-13T00:00:00Z"))).toBe(1); // next Monday
    expect(weekOffset(wk0, new Date("2026-07-27T00:00:00Z"))).toBe(3);
  });

  it("daysBetween is a signed fractional day count", () => {
    expect(daysBetween(daysAgo(5), NOW)).toBeCloseTo(5, 5);
  });
});
