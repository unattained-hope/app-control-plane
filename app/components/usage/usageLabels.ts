/**
 * Presentation vocabulary for the usage dashboards (usage-analytics Phase 4). Maps the
 * raw metric/cohort keys the read layer returns to human labels + Tremor tones, so the
 * chart components stay dumb. These mirror the catalog in `docs/usage-metrics.md` and the
 * cohort enums in `app/lib/usageMetrics.ts` — labels only, no logic.
 */

/** Tremor's built-in categorical palette, used for multi-series charts (Donut/Line/Bar). */
export const CATEGORICAL_COLORS = [
  "blue",
  "emerald",
  "amber",
  "violet",
  "rose",
  "cyan",
  "indigo",
  "fuchsia",
  "lime",
  "orange",
] as const;

/** Human labels for the wizard funnel stages (FUNNEL_STAGES order). */
export const FUNNEL_STAGE_LABEL: Readonly<Record<string, string>> = {
  started: "Started",
  basics: "Basics",
  selector: "Products",
  discount: "Discount",
  labels: "Labels",
  theme: "Theme",
  completed: "Completed",
};

/** Human labels for adoption feature keys (ADOPTION_FEATURES). */
export const FEATURE_LABEL: Readonly<Record<string, string>> = {
  badges: "Badges",
  banner: "Banner",
  recurrence: "Recurrence",
  flow: "Flow",
  offers: "Offer links",
  discount_codes: "Discount campaigns",
  markets_sync: "Markets sync",
};

/** Lifecycle stage → label + Tremor badge tone. */
export const LIFECYCLE_META: Readonly<
  Record<string, { readonly label: string; readonly color: string }>
> = {
  NEW: { label: "New", color: "blue" },
  ONBOARDING: { label: "Onboarding", color: "cyan" },
  ACTIVATED: { label: "Activated", color: "emerald" },
  ENGAGED: { label: "Engaged", color: "green" },
  DORMANT: { label: "Dormant", color: "amber" },
  CHURNED: { label: "Churned", color: "rose" },
};

/** Intensity band → label + Tremor badge tone. */
export const INTENSITY_META: Readonly<
  Record<string, { readonly label: string; readonly color: string }>
> = {
  POWER: { label: "Power", color: "violet" },
  REGULAR: { label: "Regular", color: "blue" },
  LIGHT: { label: "Light", color: "gray" },
  INACTIVE: { label: "Inactive", color: "gray" },
};

/** Persona tag → short human label. */
export const PERSONA_LABEL: Readonly<Record<string, string>> = {
  DISCOUNT_ORCHESTRATOR: "Discount orchestrator",
  BADGE_DESIGNER: "Badge designer",
  BANNER_BROADCASTER: "Banner broadcaster",
  AUTOMATION_USER: "Automation user",
  MULTI_MARKET: "Multi-market",
  MINIMALIST: "Minimalist",
};

/** Turn a raw event `name` (snake_case) into a readable action label. */
export function humanizeEventName(name: string): string {
  return name
    .split("_")
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Format a 0–1 ratio as a percentage string (1 decimal). */
export function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Format a possibly-null scalar as a compact number, or an em dash. */
export function formatCount(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat().format(value);
}

/** Value formatter passed to Tremor charts (whole numbers). */
export function chartNumberFormatter(v: number): string {
  return new Intl.NumberFormat().format(v);
}

/**
 * Format a duration in MILLISECONDS as a compact human label (the median-dwell metric).
 * Sub-second → "850 ms"; under a minute → "42.0s"; else → "1m 23s". Non-finite → em dash.
 */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds - minutes * 60);
  return `${minutes}m ${seconds}s`;
}
