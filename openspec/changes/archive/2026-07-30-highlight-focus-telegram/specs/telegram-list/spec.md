## Purpose

Defines how a user marks (highlights) rows in the Telegram List so that specific
telegrams stay visually findable, including the click/shift/ctrl semantics for
building the set of marks, the extra prominence of the most-recently-clicked row,
and how marks persist and are cleared.

## ADDED Requirements

### Requirement: Mark a single row

Clicking a Telegram List row with no modifier key SHALL clear all existing marks
and mark only the clicked row. The clicked row becomes the most-recently-clicked
row.

#### Scenario: Plain click replaces the mark set

- **WHEN** the user clicks row B while rows A and C are already marked
- **THEN** only row B is marked, and rows A and C are no longer marked

### Requirement: Marked rows are visually distinct

A marked row SHALL be shown with a distinct background color that separates it
from unmarked rows regardless of the row's zebra striping.

#### Scenario: A mark is visible

- **WHEN** a row is marked
- **THEN** it is rendered with the marked background color rather than its normal
  striped background

### Requirement: Most-recently-clicked row is most prominent

The most-recently-clicked marked row SHALL be shown with a stronger/brighter
treatment than the other marked rows, so the user can tell which row they clicked
last.

#### Scenario: Latest row stands out

- **WHEN** several rows are marked and the user has most recently clicked row D
- **THEN** row D is rendered more prominently than the other marked rows

### Requirement: Mark a range with Shift+Click

Shift+Click on a row SHALL mark the contiguous range, in the current visible row
order, between the most-recently-clicked row and the shift-clicked row
(inclusive). The shift-clicked row becomes the most-recently-clicked row.

#### Scenario: Range from the last click

- **WHEN** the user clicks row 3, then Shift+Clicks row 7
- **THEN** rows 3 through 7 (in visible order) are all marked

#### Scenario: Shift+Click with no prior click marks just that row

- **WHEN** no row has been clicked yet and the user Shift+Clicks a row
- **THEN** only that row is marked

### Requirement: Additive marking with Ctrl/Cmd

Ctrl+Click or Cmd+Click on a row SHALL toggle that row's mark while leaving all
other marks unchanged. Ctrl/Cmd+Shift+Click SHALL add the range (as in the
Shift+Click range rule) to the existing marks without clearing them. In both
cases the clicked row becomes the most-recently-clicked row.

#### Scenario: Ctrl/Cmd click adds without clearing

- **WHEN** rows A and B are marked and the user Ctrl/Cmd+Clicks row E
- **THEN** rows A, B, and E are all marked

#### Scenario: Ctrl/Cmd click toggles off a marked row

- **WHEN** row E is marked and the user Ctrl/Cmd+Clicks row E again
- **THEN** row E is no longer marked

#### Scenario: Ctrl/Cmd Shift click adds a range

- **WHEN** rows A and B are marked, the most-recently-clicked row is row 3, and
  the user Ctrl/Cmd+Shift+Clicks row 6
- **THEN** rows A, B, and 3 through 6 are all marked

### Requirement: Marks persist across main-panel navigation

The set of marked rows and the most-recently-clicked row SHALL be preserved when
the user switches to another main panel and returns to the Telegram List, so long
as the corresponding telegrams are still present in the list. A telegram that has
left the list (e.g. evicted from the buffer) SHALL simply no longer be marked;
its absence MUST NOT drop the marks on the remaining rows.

#### Scenario: Marks are restored on return

- **WHEN** the user marks several rows, navigates to another main panel, then
  returns to the Telegram List
- **THEN** the same rows are still marked and the most-recently-clicked row is
  still the most prominent

### Requirement: Clear all marks

The user SHALL be able to clear all marks in one action.

#### Scenario: Clearing removes every mark

- **WHEN** several rows are marked and the user invokes "clear marks"
- **THEN** no rows are marked

### Requirement: Marking coexists with pausing live-following

Marking a row MUST NOT change the existing behavior whereby clicking a row while
following the live edge pauses live-following (#266). A click both updates the
marks and pauses live-following.

#### Scenario: Click still pauses following

- **WHEN** the Telegram List is following the live edge and the user clicks a row
- **THEN** live-following pauses (the row stays put) and that row becomes marked
