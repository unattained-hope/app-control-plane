import {
  AbilityBuilder,
  createMongoAbility,
  type MongoAbility,
} from "@casl/ability";
import type { Role } from "@prisma/client";

/**
 * Owned RBAC policy layer (cp-auth-rbac). Enforced SERVER-SIDE in tRPC middleware,
 * independent of any UI gating. The RBAC matrix (PRD §4):
 *
 *            | view | chat reply / notes / tags | non-dangerous action | dangerous action | audit view | manage roles | pii:view | compliance:manage
 *   ADMIN    |  ✓   |            ✓              |          ✓           |        ✓         |     ✓      |      ✓       |    ✓     |        ✓
 *   SUPPORT  |  ✓   |            ✓              |          ✓           |        ✗         |     ✗      |      ✗       |    ✓*    |        ✗
 *   VIEWER   |  ✓   |            ✗              |          ✗           |        ✗         |     ✗      |      ✗       |    ✗     |        ✗
 *
 * * SUPPORT may reveal PII but only through the audited `revealPii` path (a typed
 *   reason is captured into the audit log on every reveal — cp-pii-governance) AND,
 *   from Tier 2, an active break-glass grant (cp-break-glass-rbac).
 *
 * Tier 2 (cp-ops-monitoring / cp-break-glass-rbac) adds two abilities:
 *   - `ops:view`     → ADMIN + SUPPORT (read monitoring + failed-delivery view).
 *   - `impersonate`  → ADMIN only (and requires an active IMPERSONATION grant).
 *   Mutating ops actions (webhook replay, break-glass approval) stay ADMIN-only via
 *   an explicit role check in their routers.
 *
 * Tier 3 (cp-feature-flags / cp-announcements-nps) adds two ADMIN-only abilities:
 *   - `flags:manage`        → manage the feature-flag registry + per-shop overrides.
 *   - `announcements:manage`→ publish in-app announcements to merchants.
 * App settings (cp-app-settings) adds:
 *   - `settings:manage`     → manage portfolio-wide app config (badge gallery, etc.).
 *   Merchant health reads stay under `view`; the merchant-facing surfaces (flag read
 *   endpoint, NPS, self-serve billing) authenticate by shop token, not CASL.
 *
 * Usage alerts (cp usage-alerts-digest, P5) adds one ADMIN-only ability:
 *   - `usage_alerts:manage` → manage the usage threshold-alert rule registry
 *     (enable/disable/edit). Saved explorer views are owner-scoped per admin and gated
 *     by `view` (any authenticated admin manages ONLY their own), not this ability.
 */
export type Action =
  | "view" // read merchants, dashboard, merchant data, billing
  | "reply" // chat reply, add/remove notes & tags
  | "action:nondangerous" // guarded non-dangerous merchant action
  | "action:dangerous" // guarded dangerous merchant action
  | "audit:view" // read the audit log
  | "roles:manage" // change roles / manage registry
  | "pii:view" // reveal masked merchant PII (audited, with a typed reason + grant)
  | "compliance:manage" // operate the GDPR/DSR queue (cp-compliance-dsr)
  | "canned:manage" // manage canned replies / macros (cp-canned-replies)
  | "ops:view" // read the ops/monitoring surface + failed-delivery view (cp-ops-monitoring)
  | "impersonate" // impersonate a user — ADMIN + an active grant (cp-break-glass-rbac)
  | "flags:manage" // manage feature flags + per-shop overrides (cp-feature-flags)
  | "announcements:manage" // publish in-app announcements (cp-announcements-nps)
  | "settings:manage" // manage app-specific settings (cp-app-settings)
  | "usage_alerts:manage"; // manage usage threshold-alert rules (cp usage-alerts-digest)

export type Subject = "all";

export type AppAbility = MongoAbility<[Action, Subject]>;

export function defineAbilityFor(role: Role): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  // Everyone authenticated can view.
  can("view", "all");

  if (role === "SUPPORT" || role === "ADMIN") {
    can("reply", "all");
    can("action:nondangerous", "all");
    // SUPPORT+ may reveal PII, but only via the audited `revealPii` mutation, which
    // requires a typed reason, an active break-glass grant (cp-break-glass-rbac), and
    // writes a `merchant.pii.view` audit row.
    can("pii:view", "all");
    // Ops visibility (monitoring tiles + failed-delivery view) helps the desk; the
    // MUTATING ops actions (webhook replay, break-glass approval) stay ADMIN-only.
    can("ops:view", "all");
  }

  if (role === "ADMIN") {
    can("action:dangerous", "all");
    can("audit:view", "all");
    can("roles:manage", "all");
    can("compliance:manage", "all");
    can("canned:manage", "all");
    can("impersonate", "all");
    // Tier 3: managing dark-launches + broadcasts is a privileged, portfolio-wide
    // action — ADMIN-only (cp-feature-flags / cp-announcements-nps).
    can("flags:manage", "all");
    can("announcements:manage", "all");
    can("settings:manage", "all");
    // P5: tuning usage alert thresholds is a portfolio-wide, redeploy-free control —
    // ADMIN-only (cp usage-alerts-digest).
    can("usage_alerts:manage", "all");
  }

  return build();
}

/** Convenience predicate used by tRPC middleware + UI gating. */
export function roleCan(role: Role, action: Action): boolean {
  return defineAbilityFor(role).can(action, "all");
}
