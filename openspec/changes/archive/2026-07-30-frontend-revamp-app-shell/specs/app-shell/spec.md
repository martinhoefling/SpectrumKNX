## Purpose

Defines the Group Monitor application shell: how the user switches between the five
main panels, where the write-to-bus toggle, filter-pane toggle, and play/pause
controls live, how panels close consistently, how absolute times are shown when a
view spans multiple days, and the rule for showing locally originated bus writes in
the Telegram List.

## ADDED Requirements

### Requirement: Five-panel main switch

Within Group Monitor, the shell SHALL present a switch across exactly five main
panels — Telegram List, Visualization, Statistics, Building Structure, and Last Seen
Values — and SHALL show which one is currently active. Exactly one main panel is
active at a time. Selecting a panel SHALL make it the active panel and deactivate the
previous one. The left navigation dropdown (Group Monitor / History Search /
Import-Export / Database Maintenance / Settings) is separate from this switch and is
unaffected.

#### Scenario: Telegram List is a selectable panel

- **WHEN** the user opens Group Monitor with no other panel chosen
- **THEN** the Telegram List is the active panel and is marked as active in the switch

#### Scenario: Switching panels

- **WHEN** the Statistics panel is active and the user selects Visualization
- **THEN** the Visualization panel becomes active, Statistics is no longer shown, and
  the switch marks Visualization as active

#### Scenario: Active panel survives reload

- **WHEN** the user selects the Building Structure panel and reloads the app
- **THEN** the Building Structure panel is active again after reload

### Requirement: Write-to-bus toggle placement

The write-to-bus toggle SHALL sit in the top-right toolbar next to the panel switch,
and SHALL be shown only when the server reports that writing to the bus is enabled.

#### Scenario: Toggle hidden when write disabled

- **WHEN** the server reports write is not enabled
- **THEN** no write-to-bus toggle is shown in the toolbar

#### Scenario: Toggle present when write enabled

- **WHEN** the server reports write is enabled
- **THEN** the write-to-bus toggle is shown in the top-right toolbar and opens the
  write-to-bus panel

### Requirement: Consistent per-panel close

Every non-default main panel (Visualization, Statistics, Building Structure, Last
Seen Values) SHALL provide a close (X) control in its own header, and invoking it
SHALL return the user to the Telegram List.

#### Scenario: Closing a panel returns to the list

- **WHEN** the Visualization panel is active and the user clicks the X in its header
- **THEN** the Telegram List becomes the active panel

#### Scenario: Every non-list panel has a header close

- **WHEN** any of Visualization, Statistics, Building Structure, or Last Seen Values
  is active
- **THEN** a close (X) control is present in that panel's header

### Requirement: Filter-pane toggle lives with the panel

The filter-pane toggle SHALL be placed at the top-left of the main panel area rather
than in the global header, and SHALL be shown only for panels to which filters apply.
Panels to which filters do not apply SHALL NOT show the filter toggle.

#### Scenario: Toggle shown for the Telegram List

- **WHEN** the Telegram List is active
- **THEN** the filter-pane toggle is available at the top-left of the panel and opens
  or closes the filter pane

#### Scenario: Toggle absent where filters do not apply

- **WHEN** a panel to which filters do not apply is active
- **THEN** no filter-pane toggle is shown

### Requirement: Play/pause belongs to the Telegram List

The live play/pause control SHALL be visually associated with the Telegram List
panel rather than the global toolbar. Toggling it SHALL pause or resume the live feed
as before, without dropping telegrams.

#### Scenario: Play/pause presented with the list

- **WHEN** the Telegram List is active
- **THEN** the play/pause control is shown as part of the Telegram List panel

#### Scenario: Pausing still loses nothing

- **WHEN** the user pauses the live feed and telegrams continue to arrive
- **THEN** the arriving telegrams are queued (counted as paused) and revealed on
  resume

### Requirement: Date-aware time display

Absolute times displayed in the app SHALL include the date alongside the time when
the times in view span more than one calendar day, and SHALL show the time only when
all times in view fall on a single calendar day.

#### Scenario: Single-day view shows time only

- **WHEN** every telegram in view is from the same calendar day
- **THEN** its timestamp is shown as a time without a date

#### Scenario: Multi-day view shows the date

- **WHEN** the telegrams in view span more than one calendar day
- **THEN** each timestamp is shown with its date alongside the time

### Requirement: Live bus-write display rule

Locally originated bus writes SHALL appear in the Telegram List under the same
live/pause semantics as received bus traffic: shown immediately while the live feed
is running, and queued while paused so they appear on resume.

#### Scenario: Bus write appears while live

- **WHEN** the live feed is running and the user sends a bus write
- **THEN** the written telegram appears in the Telegram List

#### Scenario: Bus write queues while paused

- **WHEN** the live feed is paused and a bus write occurs
- **THEN** the written telegram is queued and appears in the list when the feed is
  resumed

### Requirement: Buffer indicator grouping

The buffer count and its operations — load history and clear — SHALL be grouped
together as one buffer indicator in the header. This change SHALL NOT introduce a
separate bottom status bar.

#### Scenario: Buffer operations sit with the count

- **WHEN** the user views the Group Monitor header
- **THEN** the buffer count, the load-history action, and the clear action are shown
  together as one buffer indicator
