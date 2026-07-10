## ADDED Requirements

### Requirement: PII masked by default

The merchant read path SHALL mask personally-identifiable fields by default — email
and any other protected customer data surfaced — in both the merchant directory and
the merchant detail view. The unmasked value SHALL be revealed only to roles holding the
`pii:view` ability, satisfying Shopify's "limit staff access to protected customer
data" Level-2 control. Masking SHALL be applied in the read path so an unauthorized
caller never receives the raw value over the wire.

#### Scenario: Masked for unauthorized role

- **WHEN** a user without `pii:view` loads the merchant directory or a merchant detail
- **THEN** PII fields are returned masked and the raw value is not present in the response payload

#### Scenario: Revealable for authorized role

- **WHEN** a user with `pii:view` requests an unmasked PII value through the reveal path
- **THEN** the unmasked value may be returned subject to the audited reveal requirement

### Requirement: Audited PII reveal with a typed reason

A gated `revealPii` mutation SHALL return the unmasked value AND write an `AuditLog`
row with action `merchant.pii.view` in the same call, capturing the actor, the target
shop/field, and a typed reason supplied by the operator. Every reveal MUST produce
exactly one audit row, providing the "access log to protected customer data" Level-2
control. A reveal without the `pii:view` ability MUST be rejected with `FORBIDDEN`
and MUST write no audit row.

#### Scenario: Authorized reveal is logged

- **WHEN** a user with `pii:view` calls `revealPii` with a typed reason
- **THEN** the unmasked value is returned and exactly one `merchant.pii.view` audit row is written, recording actor, target, and reason

#### Scenario: Unauthorized reveal blocked

- **WHEN** a user without `pii:view` calls `revealPii`
- **THEN** the call returns `FORBIDDEN`, no value is returned, and no audit row is written

#### Scenario: Reason is required

- **WHEN** a `revealPii` call omits the typed reason
- **THEN** the call is rejected and no PII is returned and no audit row is written

### Requirement: PII-view ability in the RBAC policy

The CASL policy SHALL define a `pii:view` ability wired into the role grants. The
ability assignment (SUPPORT+ with a required reason, versus ADMIN-only) SHALL be an
explicit decision encoded in the policy and enforced server-side, independent of any
UI gating.

#### Scenario: Server-side enforcement

- **WHEN** a role lacking `pii:view` attempts any PII-reveal procedure
- **THEN** enforcement happens in tRPC middleware via CASL, not merely by hiding UI

### Requirement: Documented PCD governance policy

The repository SHALL document the remaining Shopify Level-2 controls that are policy
or infrastructure rather than application code: encrypted data backups,
test/production data separation, and a security incident-response policy. The
documentation MUST cite the append-only audit trail and replica-only-read invariant as
supporting evidence.

#### Scenario: Policy checklist present

- **WHEN** a reviewer audits PCD compliance
- **THEN** a documented checklist exists covering encrypted backups, test/prod separation, and incident response, referencing the audit log and replica-only reads as evidence
