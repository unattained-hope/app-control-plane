import { getConfig } from "./config.js";

/**
 * SLO / error-budget policy (cp-slo-alerting). Pure, no I/O — the burn-rate math and
 * the Google-SRE multiwindow multi-burn-rate tiers, all driven by `config`.
 *
 * Burn rate = observed error rate ÷ error budget (`1 - objective`). A tier fires only
 * when BOTH its long and short windows exceed the tier's multiplier, so a transient
 * blip (short window only) never pages. The on-call/rotation prose lives in
 * `docs/slo-policy.md`; this module is the machine-checkable half.
 *
 * NOTE (roadmap §2.2 caveat): MWMBR fits poorly at very low traffic. Start with the
 * longer windows / a simpler rule and graduate as merchant volume grows — every
 * threshold/window here is a config knob, not a code change.
 */

export type SloId = "webhook_delivery" | "request_availability";
export type AlertSeverity = "page" | "ticket";

export interface SloDefinition {
  readonly id: SloId;
  readonly objective: number; // e.g. 0.999
  /** The persisted per-tick error-ratio sample metric this SLO reads. */
  readonly sampleMetric: string;
}

export interface BurnTier {
  readonly id: string;
  readonly severity: AlertSeverity;
  readonly multiplier: number;
  readonly longWindowMinutes: number;
  readonly shortWindowMinutes: number;
}

/** Standard SRE short window = long ÷ 12. */
function shortOf(longMinutes: number): number {
  return Math.max(1, Math.round(longMinutes / 12));
}

/** The SLOs we evaluate. `request_availability` is fed externally (Sentry/synthetics). */
export function sloDefinitions(): SloDefinition[] {
  const cfg = getConfig();
  return [
    {
      id: "webhook_delivery",
      objective: cfg.SLO_DELIVERY_OBJECTIVE,
      sampleMetric: "ops.slo.webhook_error_ratio",
    },
    {
      id: "request_availability",
      objective: cfg.SLO_AVAILABILITY_OBJECTIVE,
      sampleMetric: "ops.slo.availability_error_ratio",
    },
  ];
}

/** The multi-burn-rate alert tiers (page-fast, page-slow, ticket). */
export function burnTiers(): BurnTier[] {
  const cfg = getConfig();
  return [
    {
      id: "page_fast",
      severity: "page",
      multiplier: cfg.SLO_BURN_PAGE_FAST,
      longWindowMinutes: cfg.SLO_WINDOW_FAST_MINUTES,
      shortWindowMinutes: shortOf(cfg.SLO_WINDOW_FAST_MINUTES),
    },
    {
      id: "page_slow",
      severity: "page",
      multiplier: cfg.SLO_BURN_PAGE_SLOW,
      longWindowMinutes: cfg.SLO_WINDOW_SLOW_MINUTES,
      shortWindowMinutes: shortOf(cfg.SLO_WINDOW_SLOW_MINUTES),
    },
    {
      id: "ticket",
      severity: "ticket",
      multiplier: cfg.SLO_BURN_TICKET,
      longWindowMinutes: cfg.SLO_WINDOW_TICKET_MINUTES,
      shortWindowMinutes: shortOf(cfg.SLO_WINDOW_TICKET_MINUTES),
    },
  ];
}

/** Error budget for an objective (e.g. 0.999 → 0.001). Never zero (guards divide). */
export function errorBudget(objective: number): number {
  return Math.max(1e-9, 1 - objective);
}

/** Burn rate = error rate ÷ error budget. */
export function burnRate(errorRate: number, objective: number): number {
  return errorRate / errorBudget(objective);
}

/** Whether a tier fires: BOTH windows' burn meet/exceed the multiplier. */
export function tierFires(
  tier: BurnTier,
  longBurn: number,
  shortBurn: number,
): boolean {
  return longBurn >= tier.multiplier && shortBurn >= tier.multiplier;
}
