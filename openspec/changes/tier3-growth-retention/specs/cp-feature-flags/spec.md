## ADDED Requirements

### Requirement: Boolean flag registry

The system SHALL provide an ADMIN-managed, control-plane-owned `FeatureFlag` registry (per app:
a unique `key`, a description, and a default-enabled boolean). Creating, updating, or deleting a
flag SHALL require the `flags:manage` ability and SHALL be audited.

#### Scenario: Admin creates a flag
- **WHEN** an ADMIN creates a feature flag with a key and default
- **THEN** the flag is stored and a `feature.flag.create` audit row is written

#### Scenario: Non-admin cannot manage flags
- **WHEN** a user without `flags:manage` attempts to create or update a flag
- **THEN** the request is rejected with `FORBIDDEN`

### Requirement: Per-shop override

The system SHALL allow a per-shop `FeatureFlagOverride` that forces a flag on or off for a
specific merchant, taking precedence over the flag default and any percentage rollout. Setting
or clearing an override SHALL require `flags:manage` and SHALL be audited.

#### Scenario: Override forces a flag on for one shop
- **WHEN** an ADMIN sets an enabled override for a shop on a flag whose default is off
- **THEN** evaluation for that shop returns enabled and a `feature.flag.override.set` audit row
  is written

### Requirement: Deterministic evaluation

The system SHALL evaluate a flag for a shop as: an explicit override if present; otherwise a
stable percentage-rollout bucket (deterministic hash of the shop) if a rollout percentage is
set; otherwise the flag default. Evaluation for the same shop and flag SHALL be stable across
calls.

#### Scenario: Override precedence
- **WHEN** a shop has both an override and a rollout percentage on the same flag
- **THEN** the override decides and the percentage bucket is ignored

#### Scenario: Stable bucketing
- **WHEN** the same shop is evaluated against a percentage rollout repeatedly
- **THEN** the result is identical each time (deterministic hash bucket)

### Requirement: Narrow read endpoint for the app

The system SHALL expose flag evaluations to the SaleSwitch app through a narrow authenticated
read endpoint; the control plane SHALL NOT write flags into the app database. The app reads its
flags; the control plane owns them.

#### Scenario: App reads its flags
- **WHEN** the app requests flag evaluations for a shop with valid credentials
- **THEN** the endpoint returns the evaluated flags and writes nothing to the application
  database

#### Scenario: Unauthenticated flag read rejected
- **WHEN** the flag read endpoint is called without valid credentials
- **THEN** the request is rejected and no flags are returned
