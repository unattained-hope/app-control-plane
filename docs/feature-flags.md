# Feature flags (cp-feature-flags)

A **simple boolean** flag registry the control plane owns, that the SaleSwitch app
**reads** to dark-launch features per shop. Rich targeting/experiments are intentionally
**bought** (LaunchDarkly / Flagsmith / Unleash) — out of scope here.

## Model

- `FeatureFlag` (per app): `key` (unique per app), `defaultEnabled`, optional
  `rolloutPercentage` (0–100).
- `FeatureFlagOverride` (per shop): forces a flag on/off for one merchant.

## Evaluation precedence (`app/lib/featureFlagEval.ts`)

1. an explicit per-shop **override** wins;
2. else a **deterministic** percentage bucket — `sha256("appKey:key:shop") % 100 <
   rolloutPercentage` — so a shop never flickers and raising the percentage only ever
   *adds* shops (a monotonic ramp);
3. else the flag **default**.

This generalizes the existing app-wide `App.enabledModules` primitive to the per-shop
level.

## How the app reads flags

`GET /api/flags?shop=<shop>&app=<appKey>` returns `{ appKey, shop, flags: { [key]:
boolean } }`. The app **pulls**; the control plane never writes flags into the app DB.

### Auth (open question §4 — resolved default)

The endpoint is guarded by a `FEATURE_FLAGS_READ_TOKEN` **bearer** in addition to the
zero-trust gateway (the app authenticates server-side by token, not SSO). Fail-closed: an
unset token refuses every request. Proposed default = a shared service token in the
secrets seam (vs. the per-shop host-minted token) since the app polls server-side —
confirm with the team before wiring the app.

## Management

ADMIN-only (`flags:manage`) via the **Flags** admin route + the `flags` tRPC router:
create/update/delete flags, set the rollout %, and set/clear per-shop overrides. Every
mutation is audited (`feature.flag.*`).
