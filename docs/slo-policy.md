# SLO & on-call policy (Tier 2) — authored policy

> The control plane **builds** the SLO burn-rate math + alert emission
> (`cp-slo-alerting`) and **buys** the on-call/paging plumbing. This doc is the
> *authored policy half* — the part code can't encode. The machine-checkable half is
> [`app/lib/sloPolicy.ts`](../app/lib/sloPolicy.ts) + [`app/server/services/sloService.ts`](../app/server/services/sloService.ts),
> evaluated each ops tick ([`opsRollup.ts`](../app/server/workers/opsRollup.ts)).

## SLOs

| SLO | Objective (default) | Source |
|---|---|---|
| **Webhook delivery success** | 99.9% (`SLO_DELIVERY_OBJECTIVE`) | Persisted per-tick error-ratio sample `ops.slo.webhook_error_ratio` (bad ÷ received over a trailing window), from the `WebhookEvent` ledger. |
| **Request availability** | 99.9% (`SLO_AVAILABILITY_OBJECTIVE`) | Fed externally (the bought synthetic monitor / Sentry) as `ops.slo.availability_error_ratio`. Until samples land it is **not evaluated** (skipped quietly). |

Error budget = `1 − objective` (e.g. 99.9% → 0.1% budget). **Burn rate** = observed
error rate ÷ error budget.

## Multiwindow multi-burn-rate tiers (Google SRE)

A tier fires only when **both** its long and short windows confirm the burn (short =
long ÷ 12), so a transient blip never pages. Defaults (config-tunable):

| Tier | Severity | Burn ≥ | Long / short window |
|---|---|---|---|
| `page_fast` | **page** | 14.4× (`SLO_BURN_PAGE_FAST`) | 60m / 5m (`SLO_WINDOW_FAST_MINUTES`) |
| `page_slow` | **page** | 6× (`SLO_BURN_PAGE_SLOW`) | 6h / 30m (`SLO_WINDOW_SLOW_MINUTES`) |
| `ticket` | ticket | 1× (`SLO_BURN_TICKET`) | 3d / 6h (`SLO_WINDOW_TICKET_MINUTES`) |

> **Low-traffic caveat (roadmap §2.2).** MWMBR fits poorly at very low volume — a
> single failure can spike the ratio. While Badgy still has few merchants, prefer the
> **longer windows** (raise `SLO_WINDOW_FAST_MINUTES`) or treat `page_fast` as a
> ticket until volume grows. Every threshold/window is a config knob, not a code
> change.

## How alerts leave the system (buy the plumbing)

When a tier fires, `sloService` emits a `captureError` to the **Sentry** sink tagged
with `slo`, `severity` (`page`/`ticket`), `tier`, and burn rates, and writes a
`slo.alert.fired` audit row (`source: JOB`). The **bought on-call/paging vendor**
(e.g. PagerDuty / Opsgenie / Better Stack) consumes Sentry issues and the `/metrics`
scrape — **routing, rotation, and escalation are configured vendor-side, not in
code.**

- `severity: page` → vendor pages the on-call engineer.
- `severity: ticket` → vendor opens a ticket (no page).

## On-call rotation & escalation (authored)

- **Rotation:** weekly primary; secondary as backup. (Fill in the roster in the
  vendor; keep it out of the repo.)
- **Ack SLA:** page acknowledged within 15 minutes, else auto-escalate to secondary.
- **Error-budget policy:** if an SLO exhausts its 30-day budget, freeze risky
  deploys for that surface until the budget recovers; a page that resolves on its own
  still gets a post-incident note.
- **Incident comms:** see [`status-page.md`](./status-page.md) for the public-facing
  cadence.

## Configuration

All thresholds/windows live in [`app/lib/config.ts`](../app/lib/config.ts):
`SLO_DELIVERY_OBJECTIVE`, `SLO_AVAILABILITY_OBJECTIVE`, `SLO_BURN_PAGE_FAST`,
`SLO_BURN_PAGE_SLOW`, `SLO_BURN_TICKET`, `SLO_WINDOW_FAST_MINUTES`,
`SLO_WINDOW_SLOW_MINUTES`, `SLO_WINDOW_TICKET_MINUTES`. The pager + status-page vendor
credentials live in the secrets manager (not the repo).
