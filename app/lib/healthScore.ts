import { getConfig } from "./config.js";

/**
 * Pure merchant health scorer (cp-merchant-health). The score is a transparent
 * weighted PENALTY sum (0 = perfectly healthy; higher = worse), so a band is never a
 * black box — `factors` always carries the breakdown. Weights + band cutoffs come from
 * config (`HEALTH_*`), so the team tunes them without code changes. No DB, no env
 * access (config is the single env reader), so this is trivially unit-testable.
 */

export type HealthBandValue = "HEALTHY" | "AT_RISK" | "CRITICAL";

export type SubscriptionSignal = "active" | "trial" | "cancelled" | "none";

export interface HealthSignals {
  readonly subscription: SubscriptionSignal;
  /** An open cap-approaching billing alert exists for the shop. */
  readonly capAlert: boolean;
  /** The merchant has uninstalled (latest lifecycle is UNINSTALL). */
  readonly uninstalled: boolean;
  /** Count of currently-open support conversations. */
  readonly openConversations: number;
  /** Latest CSAT score (1–5) or null if none recorded. */
  readonly latestCsat: number | null;
}

export interface HealthFactor {
  readonly key: string;
  readonly points: number;
}

export interface HealthResult {
  readonly score: number;
  readonly band: HealthBandValue;
  readonly factors: readonly HealthFactor[];
}

/** A CSAT at or below this counts as "low" (a churn-risk signal). */
const LOW_CSAT_THRESHOLD = 2;
/** Cap the open-conversation penalty so a noisy shop can't dominate the score. */
const MAX_CONVERSATION_PENALTY_UNITS = 3;

export function scoreHealth(signals: HealthSignals): HealthResult {
  const cfg = getConfig();
  const factors: HealthFactor[] = [];
  const add = (key: string, points: number): void => {
    if (points > 0) factors.push({ key, points });
  };

  // Uninstalled is the dominant signal (it should always land CRITICAL on its own).
  if (signals.uninstalled) add("uninstalled", cfg.HEALTH_WEIGHT_UNINSTALLED);

  switch (signals.subscription) {
    case "cancelled":
      add("subscription_cancelled", cfg.HEALTH_WEIGHT_CANCELLED);
      break;
    case "none":
      add("no_subscription", cfg.HEALTH_WEIGHT_NO_SUBSCRIPTION);
      break;
    case "trial":
      add("trial", cfg.HEALTH_WEIGHT_TRIAL);
      break;
    default:
      break; // active => no penalty
  }

  if (signals.capAlert) add("cap_approaching", cfg.HEALTH_WEIGHT_CAP_ALERT);

  if (signals.openConversations > 0) {
    const units = Math.min(signals.openConversations, MAX_CONVERSATION_PENALTY_UNITS);
    add("open_conversations", units * cfg.HEALTH_WEIGHT_OPEN_CONVERSATION);
  }

  if (signals.latestCsat != null && signals.latestCsat <= LOW_CSAT_THRESHOLD) {
    add("low_csat", cfg.HEALTH_WEIGHT_LOW_CSAT);
  }

  const score = factors.reduce((sum, f) => sum + f.points, 0);
  const band: HealthBandValue =
    score >= cfg.HEALTH_BAND_CRITICAL
      ? "CRITICAL"
      : score >= cfg.HEALTH_BAND_AT_RISK
        ? "AT_RISK"
        : "HEALTHY";

  return { score, band, factors };
}
