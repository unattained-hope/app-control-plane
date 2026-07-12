// app/server/services/usageCohortService.ts
// Nightly per-shop cohort assignment (usage-analytics Phase 3). For every shop known
// to the mirror it derives, from behavioral facts only (design.md Decision 4/5):
//   • lifecycle stage  — install/activation/recency precedence (pure `assignLifecycle`)
//   • usage intensity  — a weighted 30-day score bucketed by the day's percentile
//   • feature personas — configured rule thresholds over the 30-day feature vector
// and APPENDS one `UsageCohortSnapshot` row per shop so the HISTORY of segment
// movement is preserved (spec: "Segment movement visible over time"). Impersonated
// events contribute to nothing (shared `NOT_IMPERSONATED` predicate).
//
// Reads the CP-OWNED mirror via Prisma findMany (never raw SQL / app primary) over a
// bounded trailing window; writes only the CP-owned snapshot table. DB surface is
// narrow + DI'd so FakeDb drives the unit tests (usageIngestService pattern).

import { getDb } from "../db.js";
import { captureError } from "~/lib/observability.js";
import {
  Ev,
  FEATURE_EVENT_NAMES,
  MARKETS_SYNC_SETTING_KEY,
  NOT_IMPERSONATED,
  assignLifecycle,
  assignPersonas,
  intensityScore,
  intensityBand,
  utcDayStart,
  type IntensityCounts,
  type LifecycleSignals,
  type PersonaCounts,
} from "~/lib/usageMetrics.js";

/** A mirrored row as the cohort service reads it (subset of `UsageEvent`). */
interface MirrorRow {
  readonly shopDomain: string;
  readonly name: string;
  readonly properties: unknown;
  readonly occurredAt: Date;
}

/** Narrow DB surface — kept small so FakeDb satisfies it. */
export interface CohortDb {
  usageEvent: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, "asc" | "desc">;
    }): Promise<MirrorRow[]>;
  };
  usageCohortSnapshot: {
    createMany(args: { data: readonly Record<string, unknown>[] }): Promise<{ count: number }>;
  };
}

export interface CohortAssignment {
  readonly shop: string;
  readonly lifecycle: string;
  readonly intensity: string;
  readonly personaTags: string[];
  readonly activityScore: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class UsageCohortService {
  constructor(private readonly db: CohortDb = getDb() as unknown as CohortDb) {}

  /**
   * Compute the cohort assignment for every known shop and append a snapshot per shop.
   * Returns the assignments (also useful in tests). `now` fixes the run instant.
   */
  async runAssignment(appKey: string, now: Date = new Date()): Promise<CohortAssignment[]> {
    const assignments = await this.computeAssignments(appKey, now);
    if (assignments.length > 0) {
      await this.db.usageCohortSnapshot.createMany({
        data: assignments.map((a) => ({
          appKey,
          shop: a.shop,
          lifecycle: a.lifecycle,
          intensity: a.intensity,
          personaTags: a.personaTags,
          activityScore: a.activityScore,
          computedAt: now,
        })),
      });
    }
    return assignments;
  }

  /**
   * Pure-ish derivation (reads the mirror, then all-in-memory). Intensity bucketing is
   * two-pass: score every shop, then bucket each by the percentile of the NON-ZERO
   * score population — so the bands reflect the cohort's own distribution.
   */
  async computeAssignments(appKey: string, now: Date): Promise<CohortAssignment[]> {
    // Lifecycle needs full history for install/first-activation; scoring needs only 30d.
    // Read the full non-impersonated history once (mirror is retention-bounded) and
    // partition in memory.
    const all = await this.db.usageEvent.findMany({
      where: { appKey, ...NOT_IMPERSONATED },
      orderBy: { occurredAt: "asc" },
    });
    const win30Start = new Date(utcDayStart(now).getTime() + DAY_MS - 30 * DAY_MS); // trailing 30d incl. today

    const byShop = new Map<string, MirrorRow[]>();
    for (const r of all) (byShop.get(r.shopDomain) ?? byShop.set(r.shopDomain, []).get(r.shopDomain)!).push(r);

    // First pass: signals, counts, and raw intensity score per shop.
    const scored: Array<{ shop: string; lifecycle: string; score: number; counts: PersonaCounts }> = [];
    for (const [shop, rows] of byShop) {
      const lifecycle = assignLifecycle(this.lifecycleSignals(rows, now, win30Start), now);
      const window = rows.filter((r) => r.occurredAt >= win30Start);
      const iCounts = this.intensityCounts(window);
      const pCounts = this.personaCounts(window);
      scored.push({ shop, lifecycle, score: intensityScore(iCounts), counts: pCounts });
    }

    // Percentile population = non-zero scores, ascending.
    const nonZero = scored
      .map((s) => s.score)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);

    // Second pass: band + personas.
    return scored.map((s) => ({
      shop: s.shop,
      lifecycle: s.lifecycle,
      intensity: intensityBand(s.score, nonZero),
      personaTags: assignPersonas(s.counts),
      activityScore: s.score,
    }));
  }

  // ── signal/count extraction (pure over a shop's rows) ──────────────────────

  private lifecycleSignals(rows: readonly MirrorRow[], _now: Date, win30Start: Date): LifecycleSignals {
    let installedAt: Date | null = null;
    let lastInstallAt: Date | null = null;
    let lastUninstallAt: Date | null = null;
    let firstActivationAt: Date | null = null;
    let activeInTrailing30d = false;
    for (const r of rows) {
      if (r.occurredAt >= win30Start) activeInTrailing30d = true;
      if (r.name === Ev.APP_INSTALLED) {
        if (!installedAt) installedAt = r.occurredAt;
        if (!lastInstallAt || r.occurredAt > lastInstallAt) lastInstallAt = r.occurredAt;
      } else if (r.name === Ev.APP_UNINSTALLED) {
        if (!lastUninstallAt || r.occurredAt > lastUninstallAt) lastUninstallAt = r.occurredAt;
      } else if (r.name === Ev.CAMPAIGN_ACTIVATED && !firstActivationAt) {
        firstActivationAt = r.occurredAt;
      }
    }
    // Currently uninstalled = a terminal uninstall not followed by a reinstall.
    const uninstalled =
      lastUninstallAt != null && (lastInstallAt == null || lastUninstallAt >= lastInstallAt);
    return { installedAt, uninstalled, firstActivationAt, activeInTrailing30d };
  }

  private intensityCounts(window: readonly MirrorRow[]): IntensityCounts {
    let campaignsActivated = 0;
    let wizardSessions = 0;
    let templateEdits = 0;
    const days = new Set<string>();
    const badgeNames = new Set(FEATURE_EVENT_NAMES.badges);
    const bannerNames = new Set(FEATURE_EVENT_NAMES.banner);
    for (const r of window) {
      days.add(r.occurredAt.toISOString().slice(0, 10));
      if (r.name === Ev.CAMPAIGN_ACTIVATED) campaignsActivated += 1;
      else if (r.name === Ev.WIZARD_STARTED) wizardSessions += 1;
      else if (badgeNames.has(r.name) || bannerNames.has(r.name)) templateEdits += 1;
    }
    return { campaignsActivated, wizardSessions, templateEdits, activeDays: days.size };
  }

  private personaCounts(window: readonly MirrorRow[]): PersonaCounts {
    let campaignsActivated = 0;
    let badgeEvents = 0;
    let bannerEvents = 0;
    let recurrenceEvents = 0;
    let flowEvents = 0;
    let marketsSyncEnabled = false;
    const badgeNames = new Set(FEATURE_EVENT_NAMES.badges);
    const bannerNames = new Set(FEATURE_EVENT_NAMES.banner);
    const recurrenceNames = new Set(FEATURE_EVENT_NAMES.recurrence);
    const flowNames = new Set(FEATURE_EVENT_NAMES.flow);
    const offerNames = new Set(FEATURE_EVENT_NAMES.offers);
    let touchedOffers = false;
    for (const r of window) {
      if (r.name === Ev.CAMPAIGN_ACTIVATED) campaignsActivated += 1;
      if (badgeNames.has(r.name)) badgeEvents += 1;
      if (bannerNames.has(r.name)) bannerEvents += 1;
      if (recurrenceNames.has(r.name)) recurrenceEvents += 1;
      if (flowNames.has(r.name)) flowEvents += 1;
      if (offerNames.has(r.name)) touchedOffers = true;
      if (r.name === Ev.SETTING_SAVED && readStringProp(r.properties, "key") === MARKETS_SYNC_SETTING_KEY) {
        marketsSyncEnabled = true;
      }
    }
    // Feature-breadth for MINIMALIST: distinct adoption features touched in-window.
    let distinctFeatures = 0;
    if (campaignsActivated > 0) distinctFeatures += 1; // discount_codes proxy
    if (badgeEvents > 0) distinctFeatures += 1;
    if (bannerEvents > 0) distinctFeatures += 1;
    if (recurrenceEvents > 0) distinctFeatures += 1;
    if (flowEvents > 0) distinctFeatures += 1;
    if (touchedOffers) distinctFeatures += 1;
    if (marketsSyncEnabled) distinctFeatures += 1;
    return {
      campaignsActivated,
      badgeEvents,
      bannerEvents,
      recurrenceEvents,
      flowEvents,
      marketsSyncEnabled,
      distinctFeatures,
      active: window.length > 0,
    };
  }
}

function readStringProp(properties: unknown, key: string): string | null {
  if (properties && typeof properties === "object" && key in properties) {
    const v = (properties as Record<string, unknown>)[key];
    return typeof v === "string" ? v : null;
  }
  return null;
}

let instance: UsageCohortService | null = null;
export function getUsageCohortService(): UsageCohortService {
  if (instance === null) instance = new UsageCohortService();
  return instance;
}

/** Test seam. */
export function __setUsageCohortService(fake: UsageCohortService | null): void {
  instance = fake;
}

/** Worker call site — wraps errors for BullMQ retry. */
export async function runUsageCohortAssignment(appKey: string, now: Date = new Date()): Promise<void> {
  try {
    await getUsageCohortService().runAssignment(appKey, now);
  } catch (err) {
    captureError(err, { job: "usage-cohort", appKey });
    throw err;
  }
}
