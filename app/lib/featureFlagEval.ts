import { createHash } from "node:crypto";

/**
 * Pure feature-flag evaluation (cp-feature-flags). No DB, no env access — so it is
 * trivially unit-testable and deterministic. Precedence:
 *   1. an explicit per-shop override (on/off) wins;
 *   2. else a stable percentage-rollout bucket (sha-256 of `appKey:key:shop` mod 100);
 *   3. else the flag default.
 * Bucketing is deterministic, so a shop never flickers and raising the percentage only
 * ever ADDS shops (a monotonic ramp).
 */

export interface FlagDefinition {
  readonly appKey: string;
  readonly key: string;
  readonly defaultEnabled: boolean;
  /** 0–100 staged ramp; null/undefined => default-only (no percentage rollout). */
  readonly rolloutPercentage?: number | null;
}

/** Stable 0–99 bucket for a shop on a flag (deterministic across calls/instances). */
export function rolloutBucket(appKey: string, key: string, shop: string): number {
  const digest = createHash("sha256").update(`${appKey}:${key}:${shop}`).digest();
  // Use the first 4 bytes as an unsigned int, mod 100.
  return digest.readUInt32BE(0) % 100;
}

export function isEnabled(
  flag: FlagDefinition,
  override: boolean | null | undefined,
  shop: string,
): boolean {
  if (override != null) return override; // explicit per-shop override wins
  const pct = flag.rolloutPercentage;
  if (pct != null && pct > 0) {
    return rolloutBucket(flag.appKey, flag.key, shop) < pct;
  }
  return flag.defaultEnabled;
}
