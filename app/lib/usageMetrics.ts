import { getConfig } from "./config.js";

/**
 * Pure usage-analytics vocabulary + scorers (usage-analytics Phase 3). This module
 * is the ONE reviewed place where product judgment lives: the metric-name catalog,
 * the feature→event-name map, the shared impersonation predicate, and the pure
 * lifecycle / intensity / persona rules. No DB and no direct env access (config is
 * the single env reader) — so every rule is trivially unit-testable, exactly like
 * `healthScore.ts`.
 *
 * Event `name`/`category` values and property keys were cross-checked against
 * Badgy's shipped `shared/enums.ts` (`UsageEventName`) and its emission sites
 * (`dispatchWizardAction.ts`, `app.settings.tsx`, the campaign audit→usage bridge).
 * NO event name is invented here.
 */

// ─── Metric-name catalog ─────────────────────────────────────────────────────
// Stored in `UsageMetricDaily.metric`; the `dimension` column carries the series
// key (stage / feature / event name / rule id / `cohortWeek:weekN`), "" for scalars.

export const UsageMetric = {
  // Activity (scalars; dimension "").
  DAU: "usage.active.dau",
  WAU: "usage.active.wau", // trailing 7 days (inclusive of `date`)
  MAU: "usage.active.mau", // trailing 30 days (inclusive of `date`)
  EVENTS_TOTAL: "usage.events.total",
  // Per-event-name action counts (dimension = event `name`).
  ACTION_COUNT: "usage.action.count",
  // Wizard funnel (dimension = stage: started|basics|selector|discount|labels|theme|completed).
  FUNNEL_STAGE: "usage.funnel.stage",
  // Top wizard validation-failure rules (dimension = rule id).
  FUNNEL_VALIDATION_RULE: "usage.funnel.validation_rule",
  // Feature adoption numerators (dimension = feature) over trailing 30 / 90 days.
  ADOPTION_D30: "usage.adoption.d30",
  ADOPTION_D90: "usage.adoption.d90",
  // Adoption denominators: distinct active shops in the same window (dimension "").
  ACTIVE_SHOPS_D30: "usage.active_shops.d30",
  ACTIVE_SHOPS_D90: "usage.active_shops.d90",
  // Weekly install-cohort retention (dimension = `cohortWeek:weekN`), keyed by the
  // ISO install week which is encoded in the metric via the row's `date` = week-0 Monday.
  RETENTION_COHORT: "usage.retention.cohort",
  RETENTION_COHORT_SIZE: "usage.retention.cohort_size",
  // Median (p50) step dwell in MILLISECONDS per wizard step (dimension = step), computed
  // from `wizard_step_saved` events carrying a numeric `properties.durationMs` — the
  // Phase-5 dwell beacon (rows without it are ignored, never faked). Written per
  // (date, usage.funnel.dwell, step).
  FUNNEL_DWELL: "usage.funnel.dwell",
} as const;

export type UsageMetricName = (typeof UsageMetric)[keyof typeof UsageMetric];

/** Headline scalars ALSO appended to `KpiSnapshot` so existing dashboard tiles work. */
export const KPI_USAGE_METRICS = {
  WAU: UsageMetric.WAU,
  MAU: UsageMetric.MAU,
  EVENTS_PER_DAY: "usage.events.per_day",
} as const;

// ─── Shipped Badgy event names this rollup groups on ─────────────────────────
// Mirror of `UsageEventName` values (subset actually consumed). Kept as a local
// const map — the control plane deliberately does NOT import Badgy source.

export const Ev = {
  APP_INSTALLED: "app_installed",
  APP_UNINSTALLED: "app_uninstalled",
  WIZARD_STARTED: "wizard_started",
  WIZARD_STEP_SAVED: "wizard_step_saved",
  WIZARD_VALIDATION_FAILED: "wizard_validation_failed",
  WIZARD_COMPLETED: "wizard_completed",
  CAMPAIGN_ACTIVATED: "campaign_activated",
  CAMPAIGN_ACTIVATION_BLOCKED: "campaign_activation_blocked",
  CAMPAIGN_RECURRENCE_STOPPED: "campaign_recurrence_stopped",
  CAMPAIGN_MARKETS_APPLIED: "campaign_markets_applied",
  BADGE_TEMPLATE_CREATED: "badge_template_created",
  BADGE_TEMPLATE_EDITED: "badge_template_edited",
  BADGE_TEMPLATE_DUPLICATED: "badge_template_duplicated",
  BADGE_TEMPLATE_DELETED: "badge_template_deleted",
  BANNER_TEMPLATE_CREATED: "banner_template_created",
  BANNER_TEMPLATE_EDITED: "banner_template_edited",
  BANNER_TEMPLATE_DUPLICATED: "banner_template_duplicated",
  BANNER_TEMPLATE_DELETED: "banner_template_deleted",
  FLOW_ACTION_INVOKED: "flow_action_invoked",
  OFFER_LINK_MINTED: "offer_link_minted",
  SETTING_SAVED: "setting_saved",
} as const;

/** Wizard funnel stages in order. `started`/`completed` come from their own events;
 * the middle stages are `wizard_step_saved` with `properties.step` ∈ these values
 * (verified against Badgy's `WRITE_COMMAND_STEP` map). */
export const WIZARD_STEP_STAGES = ["basics", "selector", "discount", "labels", "theme"] as const;
export const FUNNEL_STAGES = ["started", ...WIZARD_STEP_STAGES, "completed"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/**
 * Feature key → the event names whose presence counts a shop as "using" that feature
 * in a window. Dimension values for the adoption metrics. Recurrence has no dedicated
 * "used" event in the shipped set, so `campaign_recurrence_stopped` (a recurring
 * series existed) is the available signal; markets-sync is `setting_saved` with
 * `properties.key = "markets_sync"` (handled specially below, not by name).
 */
export const FEATURE_EVENT_NAMES: Readonly<Record<string, readonly string[]>> = {
  badges: [
    Ev.BADGE_TEMPLATE_CREATED,
    Ev.BADGE_TEMPLATE_EDITED,
    Ev.BADGE_TEMPLATE_DUPLICATED,
    Ev.BADGE_TEMPLATE_DELETED,
  ],
  banner: [
    Ev.BANNER_TEMPLATE_CREATED,
    Ev.BANNER_TEMPLATE_EDITED,
    Ev.BANNER_TEMPLATE_DUPLICATED,
    Ev.BANNER_TEMPLATE_DELETED,
  ],
  recurrence: [Ev.CAMPAIGN_RECURRENCE_STOPPED],
  flow: [Ev.FLOW_ACTION_INVOKED],
  offers: [Ev.OFFER_LINK_MINTED],
  discount_codes: [Ev.CAMPAIGN_ACTIVATED], // discount campaigns; refined in a later phase
};

/** The `setting_saved` property key that marks the markets-sync (multi-market) feature. */
export const MARKETS_SYNC_SETTING_KEY = "markets_sync";
/** All adoption feature dimensions (event-driven + the settings-driven markets_sync). */
export const ADOPTION_FEATURES = [...Object.keys(FEATURE_EVENT_NAMES), "markets_sync"] as const;

// ─── Shared impersonation predicate ──────────────────────────────────────────

/**
 * The ONE place the impersonation exclusion is expressed, so it can't be forgotten
 * per-metric (design.md Decision 6). Spread into every mirror-read `where`. Support
 * activity performed via impersonation (`impersonated = true`) contributes to no
 * metric and no cohort score.
 */
export const NOT_IMPERSONATED = { impersonated: false } as const;

// ─── Lifecycle assignment (pure) ─────────────────────────────────────────────

export type LifecycleStage =
  | "NEW"
  | "ONBOARDING"
  | "ACTIVATED"
  | "ENGAGED"
  | "DORMANT"
  | "CHURNED";

/** The observable facts a shop's lifecycle is derived from (all from mirror events). */
export interface LifecycleSignals {
  /** First `app_installed` for the shop, or null if never seen. */
  readonly installedAt: Date | null;
  /** Latest `app_uninstalled` at/after the latest install (i.e. currently uninstalled). */
  readonly uninstalled: boolean;
  /** First `campaign_activated`, or null if never activated. */
  readonly firstActivationAt: Date | null;
  /** Any non-impersonated event in the trailing 30 days. */
  readonly activeInTrailing30d: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / DAY_MS;
}

/**
 * Assign exactly one lifecycle stage with deterministic precedence
 * (cp usage-cohort-assignment). Order matters:
 *   CHURNED (uninstalled) > NEW (installed <7d) > ONBOARDING (never activated)
 *   > ACTIVATED (first activation within its first 30 days of activity)
 *   > ENGAGED (events in last 30d) > DORMANT (installed, silent 30d).
 */
export function assignLifecycle(signals: LifecycleSignals, now: Date): LifecycleStage {
  if (signals.uninstalled) return "CHURNED";
  // An unknown shop with no install record but recent activity is treated as ENGAGED;
  // with no signals at all it is DORMANT (installed-but-silent is the safe default).
  if (signals.installedAt && daysBetween(signals.installedAt, now) < 7) return "NEW";
  if (!signals.firstActivationAt) return "ONBOARDING";
  if (daysBetween(signals.firstActivationAt, now) <= 30) return "ACTIVATED";
  if (signals.activeInTrailing30d) return "ENGAGED";
  return "DORMANT";
}

// ─── Usage-intensity scoring (pure) ──────────────────────────────────────────

export type IntensityBand = "POWER" | "REGULAR" | "LIGHT" | "INACTIVE";

/** Trailing-30-day behavioral counts (impersonated excluded upstream). */
export interface IntensityCounts {
  readonly campaignsActivated: number;
  readonly wizardSessions: number; // `wizard_started` count
  readonly templateEdits: number; // badge+banner template events
  readonly activeDays: number; // distinct UTC days with any event
}

/** Weighted 30-day activity score (higher = more intense). Weights from config. */
export function intensityScore(counts: IntensityCounts): number {
  const cfg = getConfig();
  return (
    counts.campaignsActivated * cfg.USAGE_INTENSITY_WEIGHT_CAMPAIGN_ACTIVATED +
    counts.wizardSessions * cfg.USAGE_INTENSITY_WEIGHT_WIZARD_SESSION +
    counts.templateEdits * cfg.USAGE_INTENSITY_WEIGHT_TEMPLATE_EDIT +
    counts.activeDays * cfg.USAGE_INTENSITY_WEIGHT_ACTIVE_DAY
  );
}

/**
 * Bucket one shop's score into an intensity band by percentile of the day's
 * NON-ZERO population. `sortedNonZero` MUST be ascending. A zero score is always
 * INACTIVE. The percentile cut-points come from config. Using the population's own
 * distribution (not absolute thresholds) keeps the bands meaningful as usage scales.
 */
export function intensityBand(score: number, sortedNonZero: readonly number[]): IntensityBand {
  if (score <= 0) return "INACTIVE";
  const cfg = getConfig();
  if (sortedNonZero.length === 0) return "LIGHT";
  const powerCut = percentileValue(sortedNonZero, cfg.USAGE_INTENSITY_PERCENTILE_POWER);
  const regularCut = percentileValue(sortedNonZero, cfg.USAGE_INTENSITY_PERCENTILE_REGULAR);
  if (score >= powerCut) return "POWER";
  if (score >= regularCut) return "REGULAR";
  return "LIGHT";
}

/** Nearest-rank percentile value from an ascending array. `p` ∈ [0,1]. */
export function percentileValue(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const clamped = Math.min(1, Math.max(0, p));
  // Nearest-rank: rank = ceil(p * N), 1-indexed.
  const rank = Math.max(1, Math.ceil(clamped * sortedAsc.length));
  return sortedAsc[rank - 1]!;
}

/**
 * Deterministic median (p50) of a numeric sample. Sorts a COPY ascending and takes the
 * middle element (odd count) or the average of the two middles (even count). Returns
 * null for an empty sample so callers can skip a step with no dwell data rather than
 * emit a fabricated 0. Pure — the dwell metric's numeric core, unit-tested directly.
 * (A separate p50 from `percentileValue`, which is nearest-rank and never averages.)
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// ─── Feature-persona assignment (pure) ───────────────────────────────────────

export type PersonaTag =
  | "DISCOUNT_ORCHESTRATOR"
  | "BADGE_DESIGNER"
  | "BANNER_BROADCASTER"
  | "AUTOMATION_USER"
  | "MULTI_MARKET"
  | "MINIMALIST";

/** Trailing-30-day per-feature usage counts a shop's personas are derived from. */
export interface PersonaCounts {
  readonly campaignsActivated: number;
  readonly badgeEvents: number;
  readonly bannerEvents: number;
  readonly recurrenceEvents: number;
  readonly flowEvents: number;
  readonly marketsSyncEnabled: boolean;
  /** Count of distinct adoption features touched (for the MINIMALIST breadth rule). */
  readonly distinctFeatures: number;
  /** Whether the shop had any activity at all in the window (gates MINIMALIST). */
  readonly active: boolean;
}

/**
 * Zero-or-more persona tags from configured rule thresholds
 * (cp usage-cohort-assignment). AUTOMATION_USER fires on recurrence OR Flow ≥ its
 * threshold; MULTI_MARKET on markets-sync enabled; MINIMALIST when active with breadth
 * at/under the configured max. All thresholds are config, so operators tune with no
 * code change.
 */
export function assignPersonas(counts: PersonaCounts): PersonaTag[] {
  const cfg = getConfig();
  const tags: PersonaTag[] = [];
  if (counts.campaignsActivated >= cfg.USAGE_PERSONA_DISCOUNT_ORCHESTRATOR_MIN) {
    tags.push("DISCOUNT_ORCHESTRATOR");
  }
  if (counts.badgeEvents >= cfg.USAGE_PERSONA_BADGE_DESIGNER_MIN) tags.push("BADGE_DESIGNER");
  if (counts.bannerEvents >= cfg.USAGE_PERSONA_BANNER_BROADCASTER_MIN) {
    tags.push("BANNER_BROADCASTER");
  }
  if (
    counts.recurrenceEvents >= cfg.USAGE_PERSONA_AUTOMATION_USER_MIN ||
    counts.flowEvents >= cfg.USAGE_PERSONA_AUTOMATION_USER_MIN
  ) {
    tags.push("AUTOMATION_USER");
  }
  if (counts.marketsSyncEnabled) tags.push("MULTI_MARKET");
  if (counts.active && counts.distinctFeatures <= cfg.USAGE_PERSONA_MINIMALIST_MAX_FEATURES) {
    tags.push("MINIMALIST");
  }
  return tags;
}

// ─── UTC day helpers ─────────────────────────────────────────────────────────

/** Truncate an instant to its UTC day (midnight UTC) — the `UsageMetricDaily.date` grain. */
export function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Exclusive end of the UTC day (next midnight). */
export function utcDayEnd(d: Date): Date {
  const start = utcDayStart(d);
  return new Date(start.getTime() + DAY_MS);
}

/** Monday (UTC) of the ISO week containing `d` — the week-0 key for install cohorts. */
export function isoWeekStart(d: Date): Date {
  const day = utcDayStart(d);
  // getUTCDay: 0=Sun..6=Sat; ISO weeks start Monday. Shift Sunday(0) back 6, else back (day-1).
  const dow = day.getUTCDay();
  const offset = dow === 0 ? 6 : dow - 1;
  return new Date(day.getTime() - offset * DAY_MS);
}

/** Whole ISO-week offset from cohort week-0 start to an event instant (0 = same week). */
export function weekOffset(cohortWeekStart: Date, at: Date): number {
  return Math.floor((utcDayStart(at).getTime() - cohortWeekStart.getTime()) / (7 * DAY_MS));
}
