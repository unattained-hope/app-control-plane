## ADDED Requirements

### Requirement: Conversation priority

The system SHALL support a `priority` on each conversation drawn from
`URGENT | HIGH | NORMAL | LOW | NONE`, defaulting to `NONE`. Priority MAY be set by a
routing rule (see `cp-conversation-routing`) or manually by an agent with the `reply`
ability. Changing priority SHALL be recorded in the append-only audit log.

#### Scenario: Default priority on creation
- **WHEN** a new conversation is created from a merchant message
- **THEN** its priority is `NONE` and no SLA due-times are set

#### Scenario: Agent sets priority
- **WHEN** an agent with the `reply` ability sets a conversation's priority to `HIGH`
- **THEN** the conversation's priority is `HIGH`, first-response and resolution due-times are
  computed, and an audit row (`conversation.priority.set`, before/after priority) is written

#### Scenario: VIEWER cannot set priority
- **WHEN** a user with only the `view` ability attempts to set priority
- **THEN** the request is rejected with `FORBIDDEN` and priority is unchanged

### Requirement: Priority-keyed SLA due-times over office hours

The system SHALL compute a first-response due-time and a resolution due-time for any
conversation whose priority is not `NONE`, using a configured business-hours window (single
timezone, daily open/close) so that elapsed SLA time accrues only during office hours. A
conversation with priority `NONE` SHALL have null due-times and SHALL never be subject to SLA
("no priority ⇒ no SLA").

#### Scenario: Due-time accrues only in office hours
- **WHEN** a `HIGH` conversation with a 4-business-hour first-response budget is created near
  end of the business day
- **THEN** the computed first-response due-time rolls into the next business day's open hours
  rather than counting overnight non-office time

#### Scenario: No priority means no SLA
- **WHEN** a conversation has priority `NONE`
- **THEN** its first-response and resolution due-times are null and the SLA sweep never marks
  it breaching

### Requirement: First-reply timestamp

The system SHALL stamp `firstReplyAt` exactly once, on the first agent (non-internal) reply
to a conversation, and SHALL NOT overwrite it on subsequent replies.

#### Scenario: First agent reply stamps the time
- **WHEN** an agent sends the first non-internal reply to a conversation with no `firstReplyAt`
- **THEN** `firstReplyAt` is set to that reply's time and the SLA state reflects whether the
  first-response due-time was met

#### Scenario: Internal note does not count as first reply
- **WHEN** an agent posts an internal note before any merchant-facing reply
- **THEN** `firstReplyAt` remains null

#### Scenario: Subsequent replies do not change first-reply time
- **WHEN** an agent sends a second reply to a conversation that already has `firstReplyAt`
- **THEN** `firstReplyAt` is unchanged

### Requirement: SLA breach sweep

The system SHALL run a repeatable background sweep that transitions open, prioritized
conversations to `BREACHING` as a due-time approaches and `BREACHED` once a due-time passes,
recording the transition in the audit log. The sweep SHALL ignore `NONE`-priority and
closed conversations.

#### Scenario: Overdue conversation is marked breached
- **WHEN** the sweep runs and an open prioritized conversation's first-response due-time is in
  the past with no `firstReplyAt`
- **THEN** its SLA state becomes `BREACHED` and an audit row (`conversation.sla.breached`) is
  written

#### Scenario: Near-due conversation is marked breaching
- **WHEN** the sweep runs and an open prioritized conversation is within the configured
  warning window of a due-time
- **THEN** its SLA state becomes `BREACHING`

#### Scenario: Met SLA is not flagged
- **WHEN** the sweep runs and a conversation replied before its first-response due-time
- **THEN** its first-response SLA state is `MET` and it is not flipped to breaching/breached

### Requirement: SLA surfacing in the inbox

The inbox SHALL display each conversation's priority and a countdown (or overdue indicator)
toward its next SLA due-time, and SHALL visually distinguish breaching/breached conversations.

#### Scenario: Countdown chip shown
- **WHEN** an agent views the inbox list with a prioritized, not-yet-replied conversation
- **THEN** the row shows its priority and a countdown to the first-response due-time

#### Scenario: Breached conversation is visually distinct
- **WHEN** a conversation's SLA state is `BREACHED`
- **THEN** the inbox row renders it with the breached indicator
