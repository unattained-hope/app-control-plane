## ADDED Requirements

### Requirement: Announcement publish and broadcast

The system SHALL let an authorized user (the `announcements:manage` ability) publish a
control-plane-owned `Announcement` with an audience (all merchants, a plan, or a shop list) and
optional expiry, and SHALL broadcast it to connected embedded widgets over the existing chat
gateway (a Socket.IO `announcement` event, Redis-fanned), persisting a `SYSTEM` message so it
appears in conversation history. Publishing SHALL be audited.

#### Scenario: Published announcement reaches connected widgets
- **WHEN** an authorized user publishes an announcement to the "all" audience
- **THEN** connected merchant widgets receive an `announcement` event, a `SYSTEM` message is
  persisted, and an `announcement.publish` audit row is written

#### Scenario: Non-authorized user cannot publish
- **WHEN** a user without `announcements:manage` attempts to publish an announcement
- **THEN** the request is rejected with `FORBIDDEN`

#### Scenario: Expired announcement is not broadcast
- **WHEN** an announcement is past its expiry
- **THEN** it is not delivered to newly connecting widgets

### Requirement: NPS collection through the widget

The system SHALL collect an NPS score (0–10) and optional comment from a merchant through the
chat widget, mirroring the existing CSAT path (`merchant:nps`), and persist it to a
control-plane-owned `NpsResponse`. Submission SHALL be idempotent within a survey window so a
merchant is not double-counted, and a `nps.recorded` audit row SHALL be written.

#### Scenario: Merchant submits an NPS score
- **WHEN** a merchant submits an NPS score via the widget
- **THEN** an `NpsResponse` is persisted, a `nps.recorded` audit row is written, and the widget
  is acknowledged

#### Scenario: Repeat submission within the window is idempotent
- **WHEN** a merchant submits NPS twice within the same survey window
- **THEN** only one response is counted for that window

### Requirement: NPS rollup into KpiSnapshot

The system SHALL aggregate NPS responses into a `KpiSnapshot` `nps` metric via the rollup
worker, so the dashboard reads the pre-aggregated value and the score can feed merchant-health
scoring.

#### Scenario: NPS aggregated for the dashboard
- **WHEN** the growth rollup runs
- **THEN** it appends a `KpiSnapshot` row for the `nps` metric with the current `asOf`
