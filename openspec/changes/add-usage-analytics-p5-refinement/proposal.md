# Proposal: add-usage-analytics-p5-refinement

> Phase 5 (optional) of the usage-analytics plan (`badgy/docs/research/usage-analytics-2026/index.html`).
> Depends on Phases 2–4. Implement after the dashboards have been used for a couple of weeks and thresholds have real data behind them.

## Why

Dashboards answer questions someone remembers to ask. The remaining value is push: the system should notice funnel regressions and dormancy spikes itself, summarize the week without anyone opening a page, and let operators keep the views they actually use. This phase also pays down the two deliberate deferrals from earlier phases (saved views, optional exploratory sidecar seam).

## What Changes

- **Threshold alerts** on the existing alerting patterns (BillingAlert / Sentry→Slack): configurable rules over `UsageMetricDaily` deltas — e.g. activation-funnel stage conversion drops >X points week-over-week, DORMANT count spikes >Y%, ingestion-lag breach already covered in Phase 2. Alert state stored so alerts fire once per breach episode, not per rollup run.
- **Weekly usage digest**: a scheduled job composes the week's headline numbers (WAU trend, funnel movement, top/bottom features, notable cohort transitions) and delivers via the existing notification/email infra to the team.
- **Dormant-shop workflow hook**: DORMANT+paid transitions can optionally create a control-plane inbox item / tag for churn-save outreach (reusing existing conversation/tag models — no new support machinery).
- **Shop-explorer saved views**: named filter/axis presets per admin user for the `/usage/shops` page.
- **Wizard step dwell (client)**: extend Badgy's beacon to report client-side step dwell for finer funnel timing (small Badgy-side follow-up, tracked here for sequencing but implemented as a tiny Badgy PR).
- **Optional PostHog sidecar sink**: implement the second sink behind Badgy's `UsageEventService` seam (config-gated, off by default) if exploratory analysis demand materializes — decision point, not a commitment.

## Capabilities

### New Capabilities
- `usage-alerts-digest`: alert rule evaluation over rolled-up metrics, breach-episode semantics, weekly digest content and delivery, and the dormant-shop workflow hook.
- `usage-saved-views`: per-admin named presets for the shop explorer.

### Modified Capabilities
<!-- none in this repo — the dwell beacon and sidecar sink are Badgy-side additions to capabilities owned by the Badgy changes (usage-event-instrumentation / usage-event-capture) and will be proposed there as small deltas when picked up -->

## Impact

- **Server:** alert-evaluation job + digest job on existing worker patterns; small models for alert rules/state and saved views; config for default thresholds.
- **App:** alert-rule management UI (ADMIN-only), saved-view controls on the shop explorer.
- **Cross-repo:** two small Badgy follow-ups (dwell beacon, sidecar sink) — each is a one-file-scale delta proposed in the Badgy repo at pick-up time.
- **Risk posture:** everything here is additive convenience on shipped data; nothing blocks or alters Phases 1–4.
