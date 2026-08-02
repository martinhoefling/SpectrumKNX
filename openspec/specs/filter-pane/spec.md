## Purpose

Defines the Telegram List filter pane's structure and semantics: the toggle between
an Edit-filters view and an Active-filters view, the removal of the auto-populating
active block, all-AND combination of active filters, the master enable/disable of the
whole filter set, and per-filter control in the Active view.

## Requirements

### Requirement: Edit and Active views toggle in one pane

The filter pane SHALL present its body as one of two views — an Edit-filters view
(the filter category controls) or an Active-filters view (the set of currently active
filters) — and SHALL provide a control in the pane header to switch between them. The
pane SHALL NOT render the active filters above the edit controls automatically, so
editing filters does not reposition existing filter entries.

#### Scenario: Switching to the Active view

- **WHEN** the pane is showing the Edit view and the user activates the view toggle
- **THEN** the pane shows the Active-filters view listing the currently active filters

#### Scenario: Editing does not move entries

- **WHEN** the user toggles a filter on or off in the Edit view
- **THEN** the edit controls stay in place and no active-filters block appears above
  them

#### Scenario: Active count remains visible

- **WHEN** one or more filters are active
- **THEN** the pane header shows the count of active filters regardless of the current
  view

### Requirement: Active filters are combined with AND

All active filters SHALL be combined with AND when determining whether a telegram
matches; there SHALL be no user control to combine source and target filters with OR.

#### Scenario: Source and target both required

- **WHEN** a source filter and a target filter are both active
- **THEN** only telegrams matching the source AND the target are shown

#### Scenario: No AND/OR control is present

- **WHEN** the user views the filter pane
- **THEN** there is no control to switch source/target combination between AND and OR

### Requirement: Legacy OR links load as AND

A shared link or saved workspace that carries the legacy source/target OR parameter
SHALL load without error, and its filters SHALL be applied with AND.

#### Scenario: Old OR link degrades to AND

- **WHEN** the user opens a link whose parameters request source/target OR combination
- **THEN** the app loads the link's filters and applies them with AND

### Requirement: Master enable/disable of the filter set

The filter pane SHALL provide a control to temporarily disable the entire active
filter set without clearing it, and to re-enable it. While the set is disabled, the
Telegram List SHALL show all telegrams, and the active filters SHALL be preserved so
that re-enabling restores the previous result.

#### Scenario: Disabling shows everything

- **WHEN** filters are active and the user disables the filter set
- **THEN** the Telegram List shows all telegrams and the filters are not cleared

#### Scenario: Re-enabling restores the filtered result

- **WHEN** the filter set has been disabled and the user re-enables it
- **THEN** the Telegram List again shows only telegrams matching the preserved filters

#### Scenario: Disabled state persists across navigation

- **WHEN** the user disables the filter set and navigates away and back to the
  Telegram List
- **THEN** the filter set is still disabled and still preserved

### Requirement: Per-filter control in the Active view

From the Active-filters view, the user SHALL be able to remove or toggle an individual
active filter, leaving the other active filters unchanged.

#### Scenario: Removing one active filter

- **WHEN** several filters are active and the user removes one from the Active view
- **THEN** that filter is no longer active and the remaining filters stay active
