## ADDED Requirements

### Requirement: Post-close CSAT capture

The system SHALL capture a customer-satisfaction score (1–5) and an optional comment for a
conversation after it is closed, recording it on the conversation. CSAT capture SHALL be
idempotent per conversation — once a score is recorded it SHALL NOT be silently overwritten.

#### Scenario: Merchant submits a rating
- **WHEN** a conversation is closed and the merchant submits a score of 5 with a comment
- **THEN** the conversation's `csatScore` is 5 and `csatComment` is stored

#### Scenario: Rating is idempotent
- **WHEN** a conversation already has a `csatScore` and a second submission arrives
- **THEN** the existing score is preserved (not overwritten)

#### Scenario: Out-of-range score rejected
- **WHEN** a CSAT submission carries a score outside 1–5
- **THEN** the submission is rejected and no score is recorded

### Requirement: Conversation tags

The system SHALL provide control-plane-owned conversation tags, unique per conversation by
label, addable and removable by users with the `reply` ability. Tags SHALL be available as a
search/filter dimension.

#### Scenario: Add a tag
- **WHEN** an agent adds the tag "refund" to a conversation
- **THEN** the conversation has the "refund" tag

#### Scenario: Duplicate tag is a no-op
- **WHEN** an agent adds a tag label that already exists on the conversation
- **THEN** no duplicate tag is created

#### Scenario: Remove a tag
- **WHEN** an agent removes an existing tag from a conversation
- **THEN** the tag no longer appears on the conversation

### Requirement: Inbox search

The inbox SHALL support server-side search over conversations by shop domain, subject, tag
label, and message body, returning a bounded result set, reusing the server-driven
(paginated) query pattern rather than client-side filtering of a full list.

#### Scenario: Search by message body
- **WHEN** an agent searches for a term appearing in a conversation's message body
- **THEN** that conversation appears in the results

#### Scenario: Search by tag
- **WHEN** an agent searches by a tag label
- **THEN** conversations carrying that tag are returned

#### Scenario: Results are bounded
- **WHEN** a search matches more than the result cap
- **THEN** a bounded page of results is returned (server-paginated), not the entire match set
  loaded into the client
