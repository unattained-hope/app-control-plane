## ADDED Requirements

### Requirement: Merchant reads current and available plans

The system SHALL present, to an authenticated merchant (shop-scoped token, as the chat widget),
the merchant's current subscription state and the available plans, read through
`billingService`/the connector (cached, replica/Shopify-state, never the app primary). A live
read failure SHALL degrade gracefully (stale-marked or unavailable), never throw to the
merchant.

#### Scenario: Merchant sees current and available plans
- **WHEN** an authenticated merchant opens the self-serve billing surface
- **THEN** their current subscription state and the available plans are displayed with an
  "as of" indication

#### Scenario: Read failure degrades gracefully
- **WHEN** the live subscription read fails
- **THEN** the surface shows a clearly-marked stale/unavailable state rather than an error

### Requirement: Plan change dispatched through the app admin API

A merchant plan-change request SHALL be recorded as a control-plane-owned `PlanChangeRequest`
and dispatched to the narrow SaleSwitch admin API (the same pattern as compliance dispatch),
which performs the Shopify managed-pricing mutation and returns a confirmation URL. The control
plane SHALL NOT mutate the application database or a billing ledger directly. Every transition
(requested/dispatched/completed/failed) SHALL be audited in the same transaction.

#### Scenario: Plan change dispatched, not mutated directly
- **WHEN** a merchant requests a plan change and the app admin API is configured
- **THEN** a `PlanChangeRequest` is recorded, the change is POSTed to the app admin API, a
  `billing.plan.change.dispatched` audit row is written, and the control plane performs no
  direct billing mutation

#### Scenario: Confirmation URL returned to the merchant
- **WHEN** the app admin API responds with a managed-pricing confirmation URL
- **THEN** the merchant is directed to that URL to confirm the change on Shopify

### Requirement: Graceful fallback without the app admin API

When the narrow app admin API (D2) is not configured, a plan-change request SHALL degrade to
opening a support conversation rather than attempting any direct billing mutation, so the
merchant is still served and the request is tracked.

#### Scenario: Fallback to a support conversation
- **WHEN** a merchant requests a plan change and the app admin API is not configured
- **THEN** a support conversation is opened capturing the request and no direct billing
  mutation is attempted
