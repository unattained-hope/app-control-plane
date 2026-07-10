## ADDED Requirements

### Requirement: Assignment rules

The system SHALL provide control-plane-owned, ordered assignment rules, each matching a
conversation attribute (keyword in subject/first message, plan, priority, or shop) and
producing an action (assign to an agent and/or set a priority). Managing rules SHALL require
the `roles:manage` ability (ADMIN). Rules SHALL be evaluated in order with first-match-wins
semantics.

#### Scenario: First matching rule applied
- **WHEN** a new conversation matches two active rules
- **THEN** only the action of the lower-`order` (first) matching rule is applied

#### Scenario: Keyword rule sets assignment
- **WHEN** a rule matches the keyword "billing" and a new conversation's first message
  contains "billing"
- **THEN** the conversation is assigned to the rule's target agent

#### Scenario: No matching rule leaves conversation unassigned
- **WHEN** a new conversation matches no active rule
- **THEN** the conversation remains unassigned with priority `NONE`

### Requirement: Presence-aware auto-assignment

When an assignment rule targets an agent, the system SHALL assign the conversation only if the
target agent is currently online; otherwise it SHALL leave the conversation unassigned
(queued) rather than parking it on an offline agent.

#### Scenario: Target online → assigned
- **WHEN** a rule would assign to an agent the presence tracker reports online
- **THEN** the conversation is assigned to that agent

#### Scenario: Target offline → queued
- **WHEN** a rule would assign to an agent the presence tracker reports offline
- **THEN** the conversation is left unassigned and remains in the open queue

### Requirement: Audited assignment

Every assignment or reassignment of a conversation, whether rule-driven or manual, SHALL write
an append-only audit row in the same transaction as the assignment, capturing the previous and
new assignee.

#### Scenario: Manual reassign is audited atomically
- **WHEN** an agent reassigns a conversation from agent A to agent B
- **THEN** `assignedTo` becomes B and an audit row (`conversation.assigned`, before=A,
  after=B) is written in the same transaction
- **WHEN** the audit write fails
- **THEN** the reassignment is rolled back and `assignedTo` remains A
