## ADDED Requirements

### Requirement: Unified merchant overview

The system SHALL provide a single merchant detail surface for a shop that composes, in one
view: shop/plan/install/status from the app connector, the subscription/billing state, the
control-plane notes and tags, the conversation history for that shop, and the per-shop audit
trail. The composition SHALL be read-only with respect to the app database.

#### Scenario: Overview joins all sources
- **WHEN** an agent opens the merchant detail for `acme.myshopify.com`
- **THEN** the view shows connector-sourced shop/plan/status, billing state, notes, tags,
  the shop's conversations, and the shop's audit entries

#### Scenario: Per-shop conversation history shown
- **WHEN** the shop has prior conversations
- **THEN** they are listed in the merchant overview with status and last-message time

#### Scenario: Per-shop audit trail shown
- **WHEN** actions have been taken against the shop
- **THEN** the merchant overview lists the shop's audit entries (newest first)

### Requirement: Replica-only reads with lag disclosure

All app-data reads in the merchant overview SHALL go through the connector to the read replica
(no raw SQL, no primary access), and the view SHALL display an "as of" timestamp acknowledging
replica lag for the connector-sourced portion.

#### Scenario: As-of timestamp displayed
- **WHEN** the merchant overview renders connector-sourced data
- **THEN** an "as of" timestamp is shown for that data

#### Scenario: No primary access
- **WHEN** the merchant overview loads its connector-sourced data
- **THEN** all such reads target the replica and none execute against the app primary

### Requirement: PII masking honored in the overview

The merchant overview SHALL honor the existing PII-governance masking: merchant email/PII is
masked unless the caller has the `pii:view` ability and performs the audited reveal.

#### Scenario: Email masked by default
- **WHEN** a caller without `pii:view` opens the merchant overview
- **THEN** the merchant email is masked

#### Scenario: Reveal is audited
- **WHEN** a caller with `pii:view` reveals the email with a typed reason
- **THEN** the unmasked value is returned and exactly one `merchant.pii.view` audit row is
  written
