# usage-saved-views

## ADDED Requirements

### Requirement: Per-admin saved views on the shop explorer
The system SHALL let each admin user save, rename, and delete named presets of the shop explorer's state (filters, axis selection, color-by) and restore them on return. Presets are private to their owner and limited to a reasonable per-user cap.

#### Scenario: Save and restore
- **WHEN** an admin configures the explorer (e.g. lifecycle = DORMANT, color = plan, x-axis = tenure) and saves it as "churn-save list"
- **THEN** selecting that preset later restores exactly that state

#### Scenario: Presets are private
- **WHEN** another admin opens the shop explorer
- **THEN** they do not see the first admin's presets
