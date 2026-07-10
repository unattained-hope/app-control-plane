## ADDED Requirements

### Requirement: Managed canned replies

The system SHALL provide control-plane-owned canned replies, each with an app-scoped unique
shortcut, a title, and a body. Creating, editing, and deleting canned replies SHALL require
the `canned:manage` ability (ADMIN). Listing and applying canned replies SHALL be available to
any user with the `reply` ability.

#### Scenario: Admin creates a canned reply
- **WHEN** an ADMIN creates a canned reply with shortcut `/welcome` and a body
- **THEN** the canned reply is stored for the app and appears in the canned-reply list

#### Scenario: Duplicate shortcut rejected
- **WHEN** an ADMIN creates a canned reply with a shortcut that already exists for the app
- **THEN** the request is rejected and no duplicate is stored

#### Scenario: Support cannot manage but can use
- **WHEN** a SUPPORT user attempts to create a canned reply
- **THEN** the request is rejected with `FORBIDDEN`
- **WHEN** the same SUPPORT user lists canned replies to insert one into a reply
- **THEN** the list is returned successfully

### Requirement: Variable substitution

When a canned reply is applied, the system SHALL substitute supported variables
(`{{shop}}`, `{{merchant_name}}`, `{{agent_name}}`) from server-resolved conversation and
actor context, leaving unknown placeholders untouched.

#### Scenario: Known variables substituted
- **WHEN** an agent applies a canned reply containing `{{shop}}` to a conversation for
  `acme.myshopify.com`
- **THEN** the rendered text contains `acme.myshopify.com` in place of `{{shop}}`

#### Scenario: Unknown variable preserved
- **WHEN** an applied canned reply contains an unsupported placeholder
- **THEN** the placeholder is left verbatim and the rest of the body is substituted normally

### Requirement: Internal notes

The system SHALL allow an agent to post an internal note on a conversation, visible only to
admin users and never delivered to the merchant. Internal notes SHALL be stored on the
conversation timeline attributed to the authoring agent and distinguished from merchant-facing
messages.

#### Scenario: Internal note hidden from merchant stream
- **WHEN** an agent posts an internal note on a conversation
- **THEN** the note is persisted with `internal = true` and is NOT broadcast to the merchant
  nor returned by the merchant-facing history

#### Scenario: Internal note visible to agents
- **WHEN** an agent opens the conversation in the admin inbox
- **THEN** the internal note appears inline in the timeline, attributed to its author and
  marked internal

#### Scenario: Internal note never counts as a merchant reply
- **WHEN** the only agent activity on a conversation is an internal note
- **THEN** the conversation is treated as not-yet-replied for SLA purposes
