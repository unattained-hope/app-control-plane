# Public status page + synthetics (Tier 2) — wiring & cadence

> The control plane **builds** the probes + synthetic scripts (`cp-status-synthetics`)
> and **buys** the branded public status page. This doc records the wiring and the
> incident-communications cadence — the policy code can't encode.

## What the control plane exposes (build)

| Surface | Path | Auth | Purpose |
|---|---|---|---|
| Liveness | [`/healthz`](../app/routes/healthz.tsx) | none | 200 while the process is up. |
| Readiness | [`/readyz`](../app/routes/readyz.tsx) | none | 200 only when the control-plane DB **and** Redis are reachable; 503 otherwise (the readiness logic is [`app/lib/readiness.ts`](../app/lib/readiness.ts)). |
| Synthetics | [`e2e/synthetics/`](../e2e/synthetics/) | dev session / SSO | Playwright real-Chrome journey (sign-in → merchant search → inbox), screenshot on failure. |

Both probes return up/down only — **no merchant data** — so they are safe to expose
unauthenticated to a monitor.

## What we buy

A branded public status page on a subdomain (e.g. **Better Stack / Statuspage /
Hyperping**). Pick one at apply time; credentials live in the secrets manager, not the
repo.

### Wiring the vendor

1. **Uptime monitor → `/healthz`** (and optionally `/readyz`) at the deployed host.
   A non-200 (or 503 on `/readyz`) opens an incident on the status page.
2. **Synthetic monitor → `e2e/synthetics/`** on a schedule (the vendor's browser
   checks, or a CI cron running `npx playwright test e2e/synthetics`). A failed
   journey + screenshot opens/raises an incident.
3. **Metrics (optional) → [`/metrics`](../app/routes/metrics.tsx)** scraped with the
   `METRICS_AUTH_TOKEN` bearer for SLO/queue dashboards (see [`slo-policy.md`](./slo-policy.md)).

## Incident-communications cadence (authored)

| Severity | Update cadence |
|---|---|
| Minor (degraded, no outage) | every **60 min** until resolved |
| Major / critical (outage) | every **15–20 min** until mitigated |

- Post an initial acknowledgement within the first cadence window of detection.
- Tie incident severity to the SLO burn tier (`page` → major/critical, `ticket` →
  minor) — see [`slo-policy.md`](./slo-policy.md).
- Close with a short resolution note; a customer-visible incident gets a brief
  post-incident summary.

## Open decisions (apply time)

- Which status-page + uptime vendor.
- Whether synthetics run from the vendor's browser network or a CI cron, and against
  prod vs. a staging mirror.
