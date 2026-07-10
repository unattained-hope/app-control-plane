## ADDED Requirements

### Requirement: Break-glass grant model

The system SHALL provide a control-plane-owned `BreakGlassGrant` carrying the requesting
actor, a `scope` (`PII_REVEAL | IMPERSONATION`), an optional `targetShop`, a required
typed `reason`, a `status` (`REQUESTED | APPROVED | ACTIVE | EXPIRED | REVOKED | DENIED`),
an optional approver, and an `expiresAt`. Every status transition SHALL be recorded in the
append-only audit log in the same transaction.

#### Scenario: Grant requires a reason
- **WHEN** a user requests a break-glass grant without a reason
- **THEN** the request is rejected and no grant is created

#### Scenario: Transition is audited in-tx
- **WHEN** a grant transitions (requested/approved/denied/activated/revoked/expired)
- **THEN** a `breakglass.*` audit row is written in the same transaction as the transition, and a failed audit insert rolls the transition back

### Requirement: Justified, time-boxed activation

For non-sensitive scopes/targets the system SHALL self-activate a requested grant
(status `ACTIVE`) with an expiry of `BREAK_GLASS_TTL_MINUTES`; for scopes/targets
configured as sensitive it SHALL require ADMIN approval before activation. An expired or
revoked grant SHALL NOT authorize access.

#### Scenario: Non-sensitive grant self-activates
- **WHEN** a user requests a `PII_REVEAL` grant for a non-sensitive target with a reason
- **THEN** the grant becomes `ACTIVE` immediately with an expiry set from `BREAK_GLASS_TTL_MINUTES`

#### Scenario: Sensitive grant needs approval
- **WHEN** a user requests a grant for a sensitive scope/target
- **THEN** the grant starts `REQUESTED` and is not `ACTIVE` until an ADMIN approves it

#### Scenario: Expired grant is swept
- **WHEN** the background tick runs and an `ACTIVE` grant is past `expiresAt`
- **THEN** its status becomes `EXPIRED`, audited with `source: JOB`

### Requirement: PII reveal requires an active grant

Revealing masked merchant PII SHALL require both the `pii:view` ability (role eligibility)
and an unexpired `ACTIVE` grant of scope `PII_REVEAL` covering the actor and target shop.
The existing typed-reason PII-reveal audit (`merchant.pii.view`) SHALL be preserved.

#### Scenario: Reveal with an active grant succeeds
- **WHEN** a SUPPORT user with `pii:view` and an active `PII_REVEAL` grant for the shop reveals PII
- **THEN** the PII is revealed and a `merchant.pii.view` audit row is written

#### Scenario: Reveal without a grant is forbidden
- **WHEN** a user with `pii:view` but no active grant attempts to reveal PII
- **THEN** the request is rejected with `FORBIDDEN` and no PII is returned

#### Scenario: Expired grant no longer authorizes
- **WHEN** a user's `PII_REVEAL` grant has expired and they attempt to reveal PII
- **THEN** the request is rejected with `FORBIDDEN`

### Requirement: Gated, audited impersonation

The system SHALL add an ADMIN-only `impersonate` ability; impersonation SHALL require an
active `IMPERSONATION`-scope grant and SHALL audit entry and exit of the impersonated
context.

#### Scenario: Admin impersonates with a grant
- **WHEN** an ADMIN with an active `IMPERSONATION` grant starts impersonation
- **THEN** an `impersonation.start` audit row is written, and ending it writes `impersonation.end`

#### Scenario: Impersonation without ability is forbidden
- **WHEN** a non-ADMIN attempts to impersonate
- **THEN** the request is rejected with `FORBIDDEN`
