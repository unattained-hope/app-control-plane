## ADDED Requirements

### Requirement: Subscription lifecycle webhooks

The control plane SHALL subscribe to and process the `app_subscriptions/update` and
`app_subscriptions/approaching_capped_amount` Shopify webhooks via the shared
ingestion spine. Each verified billing webhook SHALL be routed by the worker's
billing branch. The design SHALL treat `app_subscriptions/update` as event-driven and
NOT as a renewal heartbeat — it does not fire on every monthly auto-renewal.

#### Scenario: Subscription update processed

- **WHEN** a verified `app_subscriptions/update` webhook is processed
- **THEN** the billing handler recomputes and appends the relevant KPI deltas and audits the event

#### Scenario: Cap-approaching processed

- **WHEN** a verified `app_subscriptions/approaching_capped_amount` webhook is processed
- **THEN** the billing handler raises a cap-approaching alert and audits the event

### Requirement: KPI deltas appended on subscription change

On an `app_subscriptions/update`, the billing handler SHALL append updated `mrr` and
`active_merchants` values to `KpiSnapshot` using the existing append-only KPI pattern
(never mutating prior snapshots), and SHALL audit `billing.subscription.updated`. The
periodic KPI rollup SHALL remain the source of truth for MRR; webhooks act as
low-latency nudges layered on top of it.

#### Scenario: Snapshot appended, history preserved

- **WHEN** a subscription update changes billing state
- **THEN** new `KpiSnapshot` rows are appended for the affected metrics and prior snapshot rows remain unchanged

#### Scenario: Update is audited

- **WHEN** the billing handler processes a subscription update
- **THEN** a `billing.subscription.updated` audit row is written

### Requirement: Cap-approaching alert

On an `app_subscriptions/approaching_capped_amount` event, the control plane SHALL
record a control-plane-owned `BillingAlert` (and/or raise a notification) and audit
`billing.cap.approaching`, so an operator can act before the merchant's usage cap is
exhausted.

#### Scenario: Single alert raised

- **WHEN** a cap-approaching webhook is processed
- **THEN** exactly one `BillingAlert` is recorded for that shop and a `billing.cap.approaching` audit row is written

### Requirement: Replica-backed subscription reader replaces the stub

The `StubShopifySubscriptionReader` SHALL be replaced by a reader backed by the
connector's replica read (`AppConnector.getSubscription()`), because the control plane
holds no per-shop Shopify token. This keeps all subscription reads replica-only and
preserves the existing TTL cache and stale-while-error degradation in the billing
service unchanged.

#### Scenario: Reader sources from the replica

- **WHEN** the billing service reads a merchant's subscription state on a cache miss
- **THEN** the value is sourced through the connector's replica read, with no statement issued against the app primary

#### Scenario: Cache and degradation behavior preserved

- **WHEN** a live read fails after a prior cached value exists
- **THEN** the service still serves the last known value marked stale, exactly as before the un-stub

#### Scenario: Invariant lint stays green

- **WHEN** the billing read path is changed to the real reader
- **THEN** no raw SQL is introduced and the architecture lint guard for replica-only reads and app-DB-write prohibition remains green
