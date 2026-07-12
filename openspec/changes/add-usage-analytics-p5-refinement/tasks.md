# Tasks: add-usage-analytics-p5-refinement

## 1. Alerting

- [x] 1.1 Add `UsageAlertRule` + `UsageAlertState` models; migration; seed default rules (disabled)
- [x] 1.2 Create alert-evaluation worker triggered after daily finalization; breach-episode transitions + recovery notices; delivery via existing Sentry→Slack/notification path
- [x] 1.3 ADMIN-only rule management UI (list, enable/disable, edit threshold); audited like other admin writes
- [x] 1.4 Tests: episode semantics (single alert per breach, recovery notice), finalized-only evaluation, rule CRUD RBAC + audit

## 2. Weekly digest

- [x] 2.1 Create digest composer (metric-delta reads only) + scheduled job; recipients/schedule in config
- [x] 2.2 Tests: delta math against fixtures; renders with missing-data weeks (first weeks of history)

## 3. Dormant-shop workflow hook

- [ ] 3.1 Implement config-gated hook on DORMANT transitions (paid plans only): idempotent churn-risk tag + optional inbox item per episode <!-- deferred by decision 2026-07-11 -->
- [ ] 3.2 Tests: once-per-episode idempotency, flag-off produces nothing, free plans skipped <!-- deferred by decision 2026-07-11 -->

## 4. Saved views

- [x] 4.1 Add `UsageSavedView` model + tRPC procedures (owner-scoped CRUD, per-user cap)
- [x] 4.2 Shop-explorer UI: save/select/rename/delete presets; restore on load
- [x] 4.3 Tests: owner scoping, cap enforcement, state round-trip

## 5. Badgy follow-ups (sequenced here, implemented as small Badgy-repo changes)

- [x] 5.1 Propose Badgy delta change: wizard step dwell in the client beacon (extends `usage-event-instrumentation`) — DONE in the Badgy repo (`wizard_step_saved` now carries optional `properties.durationMs`)
- [ ] 5.2 Decision checkpoint: PostHog sidecar sink — if wanted, propose Badgy delta exercising the `usage-event-capture` sink seam (config-gated, off by default); otherwise close as not-needed <!-- deferred by decision 2026-07-11 -->

## 6. Verification

- [x] 6.1 Typecheck, lint, full suite green
- [x] 6.2 Smoke: force a threshold breach on seeded metrics → one alert + one recovery; trigger digest manually; save/restore an explorer preset
