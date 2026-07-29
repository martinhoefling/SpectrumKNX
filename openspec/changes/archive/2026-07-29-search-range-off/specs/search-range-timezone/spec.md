## Purpose

Defines behavioral requirements for history search time range selection to ensure the selected datetimes are interpreted in the user's local timezone.

## ADDED Requirements

### Requirement: Date Range Selection Local Timezone Alignment
The system SHALL interpret any selected start and end datetime-local query parameters in the user's local timezone and translate them to the correct UTC timestamp for database query.

#### Scenario: Select local datetime range
- **WHEN** the user selects a custom date range in the history search panel (e.g. starting at 01/01/2001 07:00)
- **THEN** the system SHALL fetch and display telegrams starting exactly from that local time point (e.g., matching the user's local time boundary)

### Requirement: Share Link Local Timezone Range Resolution
The system SHALL correctly resolve absolute time ranges from shared URLs by parsing them as local time rather than treating them as raw UTC.

#### Scenario: Load shared absolute range link
- **WHEN** the user loads a shared visualizer URL containing an absolute start and end time range
- **THEN** the visualizer boundary SHALL align exactly with the original local time values
