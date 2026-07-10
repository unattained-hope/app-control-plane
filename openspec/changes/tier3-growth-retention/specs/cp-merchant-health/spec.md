## ADDED Requirements

### Requirement: Per-merchant health score and band

The system SHALL derive, per merchant, a numeric health score and a band
(`HEALTHY | AT_RISK | CRITICAL`) from signals it can already read without touching the
application primary: subscription status + billing alerts, usage recency, support pressure
(open conversations, low CSAT), and lifecycle (approaching/after uninstall). The latest score
per shop SHALL be persisted as a control-plane-owned `MerchantHealthSnapshot` with the factor
breakdown and an `asOf` timestamp, and the dashboard/panel SHALL read the pre-aggregated row —
never a live join.

#### Scenario: Score is computed from defined signals
- **WHEN** the health rollup runs for a shop with a cancelled subscription and a low CSAT
- **THEN** a `MerchantHealthSnapshot` row is written with a `CRITICAL`/`AT_RISK` band, the
  contributing factors, and the current `asOf`

#### Scenario: Latest snapshot is read, not recomputed live
- **WHEN** the merchant-360 panel or at-risk list requests a shop's health
- **THEN** it returns the latest persisted `MerchantHealthSnapshot` for that shop, not a live
  recomputation

### Requirement: At-risk portfolio list

The system SHALL provide a view, gated by the `view` ability, that ranks merchants by health
band/score so the team can triage the worst-off shops first, enumerating apps via the app
registry. Each entry SHALL show its `asOf` timestamp.

#### Scenario: Worst-off merchants ranked first
- **WHEN** a user opens the at-risk list
- **THEN** merchants in `CRITICAL` then `AT_RISK` bands are listed before `HEALTHY` ones, each
  with its score, top factors, and `asOf`

### Requirement: Health surfaced on the merchant-360 panel

The merchant detail panel SHALL display the merchant's current health band and factor
breakdown alongside the existing plan/notes/tags/conversation/audit context, with the `asOf`
timestamp acknowledging snapshot lag.

#### Scenario: Band and factors visible on the panel
- **WHEN** a user opens a merchant's detail panel
- **THEN** the panel shows the health band, the factor breakdown, and the snapshot `asOf`

### Requirement: Replica-only, no-app-DB-write derivation

Health derivation SHALL read merchant/usage data only through the app connector (replica) and
control-plane tables, issue no raw SQL, and write only the control-plane-owned
`MerchantHealthSnapshot`; the `check-no-app-db-writes` guard SHALL stay green.

#### Scenario: No app-DB write for scoring
- **WHEN** the health rollup computes and persists scores
- **THEN** the only writes are to control-plane-owned tables and reads of app data go through
  the connector replica path (no primary, no raw SQL)
