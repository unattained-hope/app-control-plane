# Design: add-usage-analytics-p5-refinement

## Context

Phases 2–4 leave a working pipeline: mirrored events, daily metrics, cohort snapshots, dashboards. The control plane already has alerting precedents (`BillingAlert`, Sentry→Slack), a notification/email path, an inbox with conversations/tags, and per-admin state. This phase composes those existing pieces over the new metric data; it introduces no new architectural patterns.

## Goals / Non-Goals

**Goals:**
- Regressions announce themselves: funnel drops and dormancy spikes reach the team without a dashboard visit.
- The weekly digest replaces "someone remembers to check" with a habit-forming summary.
- Alert noise discipline: one alert per breach episode, with recovery notice.

**Non-Goals:**
- No anomaly detection / ML — explicit thresholds only.
- No general notification-preferences system — digest recipients and alert channels are config.
- No commitment to the PostHog sidecar — it stays a config-gated option implemented only on demand.

## Decisions

1. **Alert rules as data, evaluation as a job.** A small `UsageAlertRule` model (metric, dimension, comparison, threshold, window) plus `UsageAlertState` (per-rule breach episode). A worker evaluates rules after each daily finalization run — alerts therefore fire on finalized numbers, never provisional intraday ones. Alternative — hardcoded checks in the rollup worker (rejected: thresholds are product judgment and will be tuned; data-driven rules avoid redeploys).
2. **Breach-episode semantics.** A rule transitions OK→BREACHED (alert sent) and BREACHED→OK (recovery notice); repeated evaluations inside an episode are silent. Prevents daily re-alerting on a persistent condition.
3. **Digest = rendered from metrics, not recomputed.** The weekly job reads `UsageMetricDaily`/`UsageCohortSnapshot` deltas (this week vs last), composes a fixed-format summary (headlines, biggest funnel movement, top/bottom adoption movers, cohort transitions count), and sends through the existing email path. No new aggregation logic.
4. **Dormant-workflow hook is opt-in config.** On a DORMANT transition where plan ≠ free, optionally tag the merchant and/or open an inbox item. Reuses `MerchantTag`/`Conversation`; a config flag keeps it off until support wants it.
5. **Saved views are per-admin rows, not shared.** `UsageSavedView { adminUserId, name, params Json }` for the shop explorer only; sharing/team presets deferred until asked for.
6. **Badgy follow-ups proposed separately.** The dwell beacon extends `usage-event-instrumentation`; the sidecar sink exercises the existing sink seam in `usage-event-capture`. Each is a small delta-spec change in the Badgy repo at pick-up time — this change only sequences them.

## Risks / Trade-offs

- [Threshold defaults wrong at first] → rules are editable data (ADMIN UI); defaults chosen from two weeks of real Phase 3/4 data before enabling.
- [Digest ignored] → fixed short format, only deltas that moved; if it stays ignored, that's a signal to drop it, not expand it.
- [Alert channel fatigue] → episode semantics + a per-rule cooldown floor; all alerts land in one channel.
- [Workflow hook creates inbox noise] → off by default; paid-plan filter; single tag idempotency (no duplicate items per episode).

## Migration Plan

Additive models + jobs; seed default alert rules disabled, enable individually. Rollback = disable jobs/flags; no data migration concerns.

## Open Questions

- Digest delivery day/time and recipient list (config; decide at enablement).
- Whether the PostHog sidecar ever gets picked up — revisit after a month of dashboard usage.
