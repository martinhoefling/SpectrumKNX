## Purpose

Defines which per-panel UI working state (autoscroll anchor, quick-filter,
zoom region, search fields, and Last Seen Values selectors and selection) the
Group Monitor preserves when the user navigates between main panels, so that
returning to a panel restores the context the user left it in.

## ADDED Requirements

### Requirement: Navigation-surviving UI state

The application SHALL preserve the per-panel UI state enumerated in this
capability when the user switches between main panels (Telegram List,
Visualization, Traffic Statistics, Building Structure, Last Seen Values) and
returns, even though the panel component is unmounted while another panel is
active.

Persistence of this state SHALL NOT alter the shareable/bookmarkable URL: the
`view=monitor` and `view=viz` URL formats SHALL NOT gain parameters for this
UI state.

#### Scenario: State outlives an unmounted panel

- **WHEN** the user is on a panel with restorable UI state, switches to another
  main panel, then returns to the first panel within the same session
- **THEN** the panel is restored with the UI state it had when the user left it

#### Scenario: URL stays clean

- **WHEN** any of this UI state changes (e.g. a quick-filter value, a zoom
  region, a search field)
- **THEN** the browser address bar gains no query parameter encoding that state

### Requirement: Telegram List autoscroll and anchor persistence

The Telegram List SHALL preserve, across main-panel navigation, whether it is
following the live edge (autoscroll) or is paused/anchored, and — when anchored
— the identity of the anchored row, so returning to the list keeps that row in
view instead of snapping back to the live edge.

#### Scenario: Anchored position is restored

- **WHEN** the user has scrolled the Telegram List away from the live edge so a
  specific row is anchored, navigates to another panel, then returns
- **THEN** the list is still anchored to the same row (when that row is still in
  the buffer) rather than jumping to the live edge

#### Scenario: Live-following is restored

- **WHEN** the user leaves the Telegram List while it is following the live edge
  and later returns
- **THEN** the list resumes following the live edge

### Requirement: Quick-filter bar persistence

The Telegram List quick-filter bar SHALL preserve its open/closed state, its
enabled toggle, and its per-column filter values across main-panel navigation.

#### Scenario: Quick-filter is restored

- **WHEN** the user opens the quick-filter bar, enables it, types per-column
  values, navigates away, then returns to the Telegram List
- **THEN** the quick-filter bar is open, enabled, and shows the same per-column
  values, and the list is filtered accordingly

### Requirement: Visualization zoom region persistence

The Visualization SHALL preserve the zoomed-in time region across main-panel
navigation. A preserved zoom SHALL continue to freeze the time scale (the chart
does not auto-follow new data) exactly as an in-session zoom does.

#### Scenario: Zoom region is restored

- **WHEN** the user zooms into a sub-range of the Visualization, navigates to
  another panel, then returns
- **THEN** the Visualization shows the same zoomed-in time region rather than
  the full range

#### Scenario: Cleared zoom is restored as cleared

- **WHEN** the user has no active zoom (full range, auto-following), navigates
  away, then returns
- **THEN** the Visualization is at full range and auto-following

### Requirement: Statistics and Building search field persistence

The Traffic Statistics and Building Structure panels SHALL each preserve their
"filter…" search field value across main-panel navigation.

#### Scenario: Traffic Statistics search is restored

- **WHEN** the user types a value into the Traffic Statistics filter field,
  navigates away, then returns
- **THEN** the filter field contains the same value and the list is filtered by it

#### Scenario: Building Structure search is restored

- **WHEN** the user types a value into the Building Structure filter field,
  navigates away, then returns
- **THEN** the filter field contains the same value and the tree is filtered by it

### Requirement: Last Seen Values selectors and live state persistence

Last Seen Values SHALL preserve, across main-panel navigation, the
number-of-values selector (10 / 20 / 50 / 100), the "live" (auto-refresh) button
state, and the local search field value.

#### Scenario: Selectors and live state are restored

- **WHEN** the user sets the number-of-values selector, toggles "live" on, types
  in the search field, navigates away, then returns to Last Seen Values
- **THEN** the same number-of-values selection, "live" state, and search value
  are restored

### Requirement: Last Seen Values selection persistence with quick-action override

Last Seen Values SHALL preserve the selected Group Address / Device and the
ga/pa mode across main-panel navigation, including selection changes the user
makes inside the panel.

When Last Seen Values is opened via a "show last seen for…" action, the
selection supplied by that action SHALL take precedence over any previously
preserved selection for that entry.

#### Scenario: Manually chosen selection is restored

- **WHEN** the user selects a Group Address (or Device) inside Last Seen Values,
  navigates away, then returns without using a "show last seen for…" action
- **THEN** the previously selected address(es) and ga/pa mode are restored

#### Scenario: Quick action overrides the preserved selection

- **WHEN** the user triggers "show last seen for…" for a specific address from
  another part of the app
- **THEN** Last Seen Values opens showing that address's values, not the
  previously preserved selection

#### Scenario: Quick-action selection persists across later navigation

- **WHEN** the user opens Last Seen Values via "show last seen for…" for address
  X, then navigates to another panel and returns without another quick action
- **THEN** address X is restored — the quick action's selection has replaced the
  previously preserved one

### Requirement: Visualization Targets search field persistence

The Visualization Targets search field SHALL preserve its value across
main-panel navigation and across reloads.

#### Scenario: Targets search is restored

- **WHEN** the user types a value into the Visualization Targets search field,
  navigates away, then returns to the Visualization
- **THEN** the Visualization Targets search field contains the same value
