# Shopify webhook setup (Tier 0) — operator checklist

> The control plane ingests Shopify webhooks at **`POST /webhooks/shopify`**
> (HMAC-verified, idempotent, fast-200 + BullMQ fan-out — `cp-webhook-ingestion`).
> These steps are **out-of-repo**: they happen in the Shopify Partner dashboard /
> app config and the secrets manager. Re-verify topic names on shopify.dev first —
> Shopify changes them.

## 1. Register the compliance topics (rejection-gating — required before review)

Point all three **mandatory compliance webhooks** at the control plane URL:

| Topic | Purpose |
|---|---|
| `customers/data_request` | Customer asks for their data (export) |
| `customers/redact` | Customer asks to be deleted |
| `shop/redact` | Shop uninstalled 48h+ → erase shop data |

- **Delivery URL:** `https://<control-plane-host>/webhooks/shopify`
- Without these registered + HMAC-verified + responding `200`, **App Store review
  rejects the app**. The control plane records each as a `ComplianceRequest` with a
  30-day SLA (`cp-compliance-dsr`).

## 2. Register the billing topics (subscribe-to-receive — not rejection-gating)

| Topic | Purpose |
|---|---|
| `app_subscriptions/update` | Subscription status/charge change → KPI nudge |
| `app_subscriptions/approaching_capped_amount` | Usage ≥ ~90% of cap → alert |

- Same delivery URL. `app_subscriptions/update` is **event-driven, not a renewal
  heartbeat** — the periodic KPI rollup stays the source of truth for MRR.

## 3. Webhook signing secret

- **Single-tenant MVP:** the control plane verifies HMAC with the app's
  `SHOPIFY_API_SECRET` (already in [app/lib/config.ts](../app/lib/config.ts)) — no
  new env var needed.
- **Multi-app:** store a per-app `webhookSecretRef` on the `App` registry row
  (mirroring `replicaRef`) and bind it in the secrets manager; the secrets seam
  ([app/lib/secrets.ts](../app/lib/secrets.ts)) resolves shop → app → secret.

## 4. Dependencies to track

- **`SALESWITCH_ADMIN_API_URL` / `SALESWITCH_ADMIN_API_TOKEN`** — needed for full
  Option-A **auto-dispatch** of redaction/export. Until it exists, compliance runs
  **A-phased**: ingest + track + an operator marks fulfilment manually. When the
  endpoint lands, set the env vars and auto-dispatch turns on with **no** change to
  the audit/SLA contract.
- **Redis** — the webhook worker + SLA sweep run on BullMQ. In production
  `server/start.js` starts them in-process; in dev run `npm run worker` alongside
  `npm run dev` (otherwise enqueued jobs sit unprocessed).

## 5. Re-verify before each submission

- [ ] Topic header names + the exact mandatory-webhook list on shopify.dev.
- [ ] The Protected-Customer-Data Level 1/2 control list (see
      [protected-customer-data.md](./protected-customer-data.md)).
- [ ] Billing-webhook semantics (caps, renewal behavior).
