## Context

See `proposal.md` — Why. Current `App.tsx` facts that shape the design:

- Navigation is split three ways: a left **`NavDropdown`** (Group Monitor / History
  Search / Import-Export / Database Maintenance / Settings) driving `activeTab`
  (`'live' | 'history' | 'import'`), `isSettingsOpen`, and `isDatabaseOpen`; plus a
  cluster of **boolean view flags** — `isVisualizerOpen`, `isLastSeenOpen`,
  `isStatisticsOpen`, `isBuildingOpen` — that the right-header icon buttons toggle,
  each handler manually turning the other three off.
- The right header only renders `when activeTab === 'live' && !isSettingsOpen`. It
  holds, in order: the stats pill (Rate, Buffer `Trash2` + `Download` + count,
  Paused, WS, history-loading), the filter toggle (`SlidersHorizontal`, disabled
  when `hasActiveView`), the write-to-bus `Send` toggle (only when
  `serverConfig.status.write_enabled`), a divider, then `LineChart` / `BarChart2` /
  `Building2` / `Clock` view toggles and the play/pause button.
- **Telegram List is the implicit default**: the content body renders `TelegramTable`
  only when none of the view booleans is set. There is no control that represents or
  "selects" the list.
- `hasActiveView = isStatisticsOpen || isBuildingOpen || isLastSeenOpen ||
  isDatabaseOpen`; an effect force-closes the filter panel whenever `hasActiveView`.
  The filter toggle is disabled for those views because filters don't apply there.
- Panel visibility already persists: `workspaceView: WorkspaceView` (`'visualizer' |
  'lastseen' | 'statistics' | 'building' | 'database' | 'none'`) is serialized to the
  workspace (URL or localStorage) and restored at mount via `initialWorkspace?.view`.
- Timestamps render per-row in `TelegramTable` (the `time` column) and in other
  panels; today they are time-only with no date, so multi-day buffers are ambiguous.
- Pause is `isPaused` + `togglePause()`, which drives `setCachePaused`. The cache
  keeps ingesting while paused; `pausedCount` counts what queued.

## Goals / Non-Goals

**Goals:**
- One **active-panel selector** for the five Group-Monitor panels, replacing the
  four independent booleans, with Telegram List as an explicit selectable value.
- Relocate filter toggle and play/pause out of the global header into the panel they
  belong to, and make every panel close consistently back to the Telegram List.
- Date-aware timestamps app-wide when a view spans multiple days.
- Codify the live/bus-write display rule so locally sent telegrams follow the same
  live/pause semantics as bus traffic.

**Non-Goals:**
- The filter/sidebar **internal** redesign (#370/#272/#275/#363) — toggle placement
  only here.
- Any **bottom status bar** — buffer/rate/WS stay in the header (per decision); this
  change only keeps buffer ops grouped with the count.
- Redesigning the left dropdown or the History / Import / Database / Settings screens.
- The Workspace concept (#369).

## Decisions

### Decision 1: Collapse the four view booleans into one `activePanel` selector

Introduce `activePanel: 'list' | 'visualizer' | 'statistics' | 'building' |
'lastseen'` (Group-Monitor scope) replacing `isVisualizerOpen` / `isStatisticsOpen`
/ `isBuildingOpen` / `isLastSeenOpen`. `'list'` is the default and the value every
panel's close (X) returns to. Deriving the existing booleans from `activePanel`
keeps child component props unchanged where practical, minimizing blast radius. The
switch renders five segments; the active one is marked; selecting one sets
`activePanel`. `isDatabaseOpen` / `isSettingsOpen` / `activeTab` stay as-is — they
are the left dropdown's concern, orthogonal to the panel switch.

- **Alternative considered:** keep the booleans and add a parallel switch UI.
  Rejected — the manual "turn the other three off" logic in every handler is exactly
  the inconsistency this change removes; a single selector makes illegal states
  unrepresentable.
- Map `activePanel` to the persisted `WorkspaceView` so reload/share still restores
  the panel (`'list'` ↔ `'none'`), keeping the existing persistence contract.

### Decision 2: Panel switch + write-to-bus toggle in the top-right; buffer stays

The top-right toolbar (still gated on Group Monitor, `activeTab === 'live' &&
!isSettingsOpen`) becomes: the five-segment panel switch, then the write-to-bus
toggle (only when `write_enabled`). The buffer/rate/WS stats pill remains in the
header with the buffer count, `load history`, and `clear` grouped as one buffer
indicator (no status bar). The filter toggle and play/pause leave this row
(Decisions 3–4).

### Decision 3: Filter-pane toggle lives at the panel's top-left

The filter toggle moves from the global header to the top-left of the panel content
area, shown only for panels where filters apply (Telegram List; other panels that
consume `activeFilters`). Panels where filters don't apply simply don't render it,
replacing today's "disabled + tooltip" treatment driven by `hasActiveView`. The
force-close-filter-on-active-view effect is retained/relocated so switching to a
no-filter panel still hides the pane.

- Placement coordinates with the Filter & sidebar group (#370); only the toggle's
  location and visibility rule are settled here, not the pane's contents.

### Decision 4: Play/pause is part of the Telegram List panel

Render play/pause within the Telegram List panel's own header/affordance area rather
than the global toolbar, so the control that governs the live feed sits with the
list it scrolls. `isPaused` / `togglePause` are unchanged; only the control's home
moves. When another panel is active, play/pause is not shown in the global header.

- **Trade-off:** pausing is a global data concern (the cache keeps buffering
  regardless of panel). Keeping the *control* on the list matches the user's mental
  model without changing the underlying global pause behavior.

### Decision 5: Consistent per-panel close = select Telegram List

Each non-list panel exposes an X in its own header whose action sets `activePanel =
'list'`. The existing `onClose` props already do this per panel; the change is to
guarantee every panel has the affordance in a consistent header position and that it
routes through the single selector. Database/Settings (left-dropdown surfaces) keep
their own close/back behavior and are out of the switch.

### Decision 6: Date-aware time formatting via a shared helper

Add a small helper that, given the set of timestamps in view, decides whether they
span more than one calendar day (local time); if so, timestamps render `date + time`,
otherwise `time` only. Apply it in `TelegramTable`'s time column and the other
panels that show absolute times. The decision is per rendered set, so a live view on
a single day stays compact and only widens once older telegrams from a previous day
are present.

- **Alternative considered:** always show the date. Rejected — noisy for the common
  single-day live case, which the epic explicitly scopes to "when multiple days are
  involved".

### Decision 7: Live / bus-write display rule

Locally originated bus writes (from the write-to-bus panel / send actions) enter the
list through the same cache path as bus traffic, so they follow live/pause semantics:
visible immediately while live-following, queued (counted in `pausedCount`) while
paused, revealed on resume. This encodes the intended behavior referenced by #240
(now closed) as an explicit, testable rule rather than incidental behavior.

## Risks / Trade-offs

- **Regression surface in navigation.** Collapsing four booleans into one selector
  touches every panel-open handler and the workspace persistence mapping. Mitigate
  by deriving the old booleans from `activePanel` behind the existing prop names and
  covering panel switching + reload-restore with tests.
- **Filter-toggle relocation vs #370.** Landing placement before the pane redesign
  risks a second move later. Accepted: the epic sequences placement here on purpose;
  #370 changes pane contents, not the toggle's home.
- **Date-aware formatting cost.** Deciding multi-day-ness over a large buffer must be
  O(n) at most and memoized; compute min/max timestamp once per rendered set, not per
  row.
- **Play/pause discoverability.** Moving it off the always-visible header could hide
  it when another panel is active; acceptable since pausing the live feed is a
  Telegram-List concern and the feed keeps buffering regardless.
