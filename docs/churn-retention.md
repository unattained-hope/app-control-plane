# Churn & data-retention reconciliation (cp-uninstall-churn)

> **Status: policy draft — the CP-owned purge step is gated OFF by default
> (`CHURN_RETENTION_PURGE_ENABLED=false`) pending team + legal confirmation.**

This documents how the control plane handles an app uninstall and reconciles its own
data retention with Shopify's mandatory redaction flow. It is the roadmap §3.2 open
question ("re-verify exact flow") written down.

## The two clocks, kept separate

| | Owner | Trigger | Authority |
|---|---|---|---|
| **Redaction of *app* data** | The SaleSwitch app | Shopify `shop/redact` (~48h after uninstall) + `customers/redact` | The Tier-0 `ComplianceRequest` 30-day SLA (`cp-compliance-dsr`) |
| **Retention of *control-plane* data** | The control plane | This policy, after redaction completes | This document |

The control plane **never redacts application data** and never mutates the app DB. It
holds no merchant PII beyond what it reads live from the replica and the small set of
its own annotations (notes, conversation bodies, tags, audit). So an uninstall does not
trigger a redaction here — Shopify's compliance webhooks do, and that path is unchanged.

## What the uninstall flow does

On a verified `app/uninstalled` webhook (`lifecycleService.handleWebhook`):

1. Record a CP-owned `MerchantLifecycleEvent` (`UNINSTALL`) — idempotent (a repeat
   where the latest lifecycle is already `UNINSTALL` is a no-op; replays are deduped at
   webhook ingest).
2. Write a `merchant.uninstalled` audit row in the **same transaction**.
3. Recompute the uninstall/churn KPIs (best-effort; the periodic rollup is the source of
   truth and only appends).

A previously-uninstalled shop that reappears active is recorded as a `REINSTALL` by the
growth rollup (`recordReinstall`), so the lifecycle history stays complete.

## The retention purge (gated)

When the `shop/redact` `ComplianceRequest` for an uninstalled shop **completes**
(`complianceService.markCompleted`), and **only if `CHURN_RETENTION_PURGE_ENABLED=true`**,
`lifecycleService.purgeForRedactedShop` deletes the control plane's **own** PII-bearing
records for that shop:

- `MerchantNote` rows (may quote customer PII)
- `Conversation` rows + their `Message`s (cascade)

It **never** deletes the append-only `AuditLog` — those rows carry only the shop domain
and structured fields, not raw customer PII, and the immutable audit trail is a
compliance control in its own right (`cp-audit-log`).

## Confirm before enabling

- **Which records?** Confirm the list above with legal — e.g. should tags be purged too?
- **When?** Proposed: on `shop/redact` completion. Alternative: a fixed retention window
  after uninstall, independent of the redaction request.
- **Audit retention?** Confirmed: never purged. Validate against the SOC 2 / PCD
  retention requirements.

Until those are confirmed, leave `CHURN_RETENTION_PURGE_ENABLED=false`. The uninstall
record + churn KPIs ship value with the purge disabled.
