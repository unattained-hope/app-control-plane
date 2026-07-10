## ADDED Requirements

### Requirement: App-uninstall ingestion

The system SHALL recognize the Shopify `app/uninstalled` webhook topic, route it through the
existing webhook ledger, record a control-plane-owned `MerchantLifecycleEvent` of kind
`UNINSTALL`, recompute the uninstall/churn KPIs, and write a `merchant.uninstalled` audit row
in the same transaction as the lifecycle record.

#### Scenario: Uninstall recorded and audited
- **WHEN** a verified `app/uninstalled` webhook is processed for a shop
- **THEN** a `MerchantLifecycleEvent` (`UNINSTALL`) is created and a `merchant.uninstalled`
  audit row is written in the same transaction (a failed audit insert rolls the record back)

#### Scenario: Churn KPI recomputed
- **WHEN** an uninstall is recorded
- **THEN** the uninstall/churn KPI rollup is refreshed so the dashboard reflects the change

### Requirement: Reinstall handling

The system SHALL record a `MerchantLifecycleEvent` of kind `REINSTALL` when a previously
uninstalled shop reinstalls, so the lifecycle history (install → uninstall → reinstall) is
complete and feeds the health signal.

#### Scenario: Reinstall recorded
- **WHEN** a shop that previously uninstalled installs again
- **THEN** a `MerchantLifecycleEvent` (`REINSTALL`) is recorded and audited

### Requirement: Idempotent uninstall processing

Duplicate or replayed `app/uninstalled` deliveries SHALL NOT double-count churn; processing
SHALL reuse the webhook ledger's at-least-once dedupe so a single uninstall yields a single
lifecycle record.

#### Scenario: Duplicate delivery deduped
- **WHEN** the same `app/uninstalled` event is delivered twice
- **THEN** only one `UNINSTALL` `MerchantLifecycleEvent` exists and the churn KPI is not
  double-decremented

### Requirement: Retention reconciled with the 30-day redaction SLA

The uninstall flow SHALL NOT itself redact application data; redaction SHALL remain driven by
the Shopify `shop/redact` / `customers/redact` compliance webhooks and their 30-day SLA
(`ComplianceRequest`). The control plane SHALL apply a documented retention policy to its
**own** data only — purging PII-bearing control-plane records (e.g. notes/conversations) for a
churned shop once the corresponding redaction completes — while the append-only audit log is
never deleted.

#### Scenario: Uninstall does not redact app data
- **WHEN** an uninstall is processed
- **THEN** no redaction of application data is performed by the control plane; the redaction
  remains the responsibility of the compliance webhooks

#### Scenario: CP-owned PII purged on redaction completion, audit preserved
- **WHEN** the `shop/redact` request for an uninstalled shop completes
- **THEN** the documented retention policy purges the control plane's own PII-bearing records
  for that shop, and the append-only audit log rows are retained
