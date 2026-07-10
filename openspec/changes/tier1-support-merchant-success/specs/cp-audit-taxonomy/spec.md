## ADDED Requirements

### Requirement: Typed audit action taxonomy

The system SHALL record audit `action` values drawn from a defined, typed taxonomy of event
identifiers (e.g. `merchant.note.add`, `conversation.assigned`, `conversation.sla.breached`,
`compliance.completed`) rather than ad-hoc free-text strings. Call sites SHALL reference the
taxonomy constants.

#### Scenario: Audited action uses a taxonomy constant
- **WHEN** an audited operation writes an audit row
- **THEN** its `action` value is a member of the defined taxonomy

#### Scenario: Existing rows remain valid
- **WHEN** audit rows written before this change are read
- **THEN** they are still returned and displayed without error

### Requirement: Structured actor and source

Each audit row SHALL capture, in addition to the actor id, the actor's email, an actor type
(`INTERNAL` for a staff user or `SYSTEM` for an automated job), and a source
(`UI`, `API`, or `JOB`). New audit writes default to `actorType = INTERNAL` and `source = UI`;
audit writes originating from background workers SHALL set `actorType = SYSTEM` and
`source = JOB`.

#### Scenario: UI action attributed to a staff actor
- **WHEN** a staff user performs an audited action through the admin UI
- **THEN** the audit row records their email, `actorType = INTERNAL`, and `source = UI`

#### Scenario: Background job attributed to the system
- **WHEN** a background worker writes an audit row (e.g. the SLA sweep marks a breach)
- **THEN** the row records `actorType = SYSTEM` and `source = JOB`

### Requirement: Before/after diffs preserved and viewable

Audit rows SHALL continue to capture before/after state for state-changing actions, and the
audit viewer SHALL allow filtering by the structured fields (actor, actor type, source,
action, app, merchant, date range).

#### Scenario: Before/after captured on a change
- **WHEN** an audited state change occurs (e.g. priority A→B)
- **THEN** the audit row's `before` and `after` reflect the change

#### Scenario: Filter by source
- **WHEN** an ADMIN filters the audit viewer by `source = JOB`
- **THEN** only audit rows written by background jobs are returned

#### Scenario: Append-only preserved
- **WHEN** any audited operation runs
- **THEN** it only inserts audit rows; no code path updates or deletes existing audit rows
