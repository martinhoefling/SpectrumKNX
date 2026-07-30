## Why

The app shell has grown organically: the top-right header crams the buffer/rate/WS
stats pill, the filter toggle, the write-to-bus toggle, four view toggles, and the
play/pause button into one row, while "Telegram List" is an implicit default with no
control of its own. Panels open and close inconsistently, the filter toggle sits in
the global header even though filters only apply to some panels, and play/pause is
detached from the list it actually controls. This is the **foundational** slice of
the Frontend Revamp (#287, epic #374): a clean, predictable shell that the later
groups (Telegram list #371, Visualization #372, Building structure #373, Filter &
sidebar #370) build on.

## What Changes

- **Main-panel switch.** Inside Group Monitor, the top-right toolbar becomes an
  explicit switch across the five main panels — **Telegram List, Visualization,
  Statistics, Building Structure, Last Seen Values** — with the current panel
  clearly marked. Telegram List becomes a first-class, selectable panel instead of
  the unlabelled default. The left dropdown (Group Monitor / History Search /
  Import-Export / Database Maintenance / Settings) is unchanged.
- **Write-to-bus toggle** sits in the top-right toolbar next to the panel switch,
  shown only when the server reports write is enabled.
- **Consistent panel close.** Every non-default main panel closes via an X in its
  own header, returning to the Telegram List. (The Visualization exception was
  already fixed in #347; this makes the rest consistent.)
- **Filter-pane toggle moves to the panel.** The filter toggle is placed at the
  top-left of each panel where filters apply, out of the global header.
- **Play/pause belongs to the Telegram List.** The live play/pause control is
  visually associated with the Telegram List panel rather than the global toolbar.
- **Date-aware time display.** When the visible telegrams span more than one
  calendar day, timestamps show their date alongside the time; single-day views
  stay time-only.
- **Live / bus-write rule.** Locally originated bus writes appear in the Telegram
  List under the same live/pause semantics as bus traffic — visible while
  live-following, queued while paused, revealed on resume.
- **Buffer indicator grouping.** The buffer count and its operations (load history,
  clear) stay grouped as one buffer indicator in the header (no separate status bar
  is introduced in this change).

Out of scope / related: the filter/sidebar **internal** redesign — edit-vs-active
views, categories, live counts, reusable GA/device sidebar (#370, #272, #275, #363)
— is a separate change; here we only relocate the toggle and make close/open
consistent. The **Workspace** concept (#369) is a separate epic and sequences after
this foundation.

## Capabilities

### New Capabilities
- `app-shell`: the Group Monitor shell — the five-panel switch and its selection
  model, the write-to-bus toggle placement, consistent per-panel close, filter-pane
  toggle placement, play/pause association with the Telegram List, date-aware time
  display, the live/bus-write display rule, and buffer-indicator grouping.

### Modified Capabilities
<!-- None: no existing captured capability defines the shell; this is the first. -->

## Impact

- **Frontend only.** No backend, API, or dependency change.
- `frontend/src/App.tsx` — replace the ad-hoc right-header controls with the
  five-panel switch + write-to-bus toggle; collapse the `isVisualizerOpen` /
  `isLastSeenOpen` / `isStatisticsOpen` / `isBuildingOpen` boolean cluster into a
  single active-panel selector; relocate the filter toggle into the panel area;
  move play/pause next to the Telegram List; apply date-aware timestamp formatting.
- `frontend/src/components/*Overlay.tsx`, `Visualizer.tsx`, `TelegramTable.tsx` —
  ensure each panel exposes a consistent header X that returns to the Telegram List;
  Telegram List gains the play/pause + filter-toggle affordances.
- `frontend/src/utils/` — a small shared time-format helper that switches to
  date+time when a set of telegrams spans multiple days.
- Panel selection continues to persist through the existing workspace state
  (`workspaceState.ts` `WorkspaceView`), so the switch survives reload and sharing.
