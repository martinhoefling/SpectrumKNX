## Why

Each main panel in the Group Monitor is conditionally rendered, so switching
panels unmounts the previous one and discards its local React state. Users lose
their place constantly: open the Visualizer, glance at Last Seen Values, come
back — and the zoom, the quick-filter, the search box, the autoscroll anchor are
all reset. Issue #341 ("state persistence" group) asks that this working context
survive main-panel navigation so the app stops fighting the user.

## What Changes

Make the following UI state survive navigating away from a main panel and back
(and, where it costs nothing extra, a reload):

- **Telegram List** — autoscroll follow/paused state and the list-position
  anchor (#203/#202) persist, so returning to the list keeps the same row in
  view instead of snapping back to the live edge.
- **Quick-filter bar** (#280) — open/closed state, its enabled toggle, and the
  per-column filter values persist.
- **Visualization** — the zoomed-in time region (#236) persists instead of
  resetting to the full range.
- **Traffic Statistics** and **Building Structure** — the "filter…" search
  field value persists.
- **Last Seen Values** — the number-of-values selector (10/20/50/100), the
  "live" (auto-refresh) button state, and the local search field persist.
- **Last Seen Values selection** — the selected Group Address / Device (and
  ga/pa mode) persist across navigation, **except** when the panel was opened
  via a "show last seen for…" action, which supplies its own selection and must
  win for that entry.

Already satisfied (verified, no work): the **Visualization Targets search
field** (#341) already persists via the `vizTargetSearch` preference — it will
be covered by a requirement to lock in the behavior, not re-implemented.

Out of scope (tracked separately): #341's "functional features" and
"action-icon" groups (separate change `qol-action-icons`); "highlight the
last-clicked telegram" (#310).

## Capabilities

### New Capabilities
- `ui-state-persistence`: Which per-panel UI state (autoscroll anchor,
  quick-filter, zoom region, search fields, last-seen selectors and selection)
  is preserved across main-panel navigation, where it is stored, and how a
  quick-action entry overrides a restored selection.

### Modified Capabilities
<!-- None: openspec/specs/ is empty; this is the first captured capability. -->

## Impact

- **Frontend only.** No backend, API, or dependency changes.
- `frontend/src/App.tsx` — lifts the affected state (or wires new persistence)
  so it lives above the conditionally-rendered panels.
- New/extended persistence helper for navigation-surviving UI state that should
  **not** be reflected into the shareable URL (distinct from `workspaceState.ts`
  URL/localStorage workspace and `prefs.ts` durable preferences).
- Components touched: `TelegramTable.tsx` (autoscroll anchor, quick-filter),
  `Visualizer.tsx` (zoom range), `StatisticsOverlay.tsx` and
  `BuildingOverlay.tsx` (search field), `LastSeenOverlay.tsx` (limit,
  auto-refresh, search, selection back-sync).
- `VisualizerSidebar.tsx` search — no change; behavior asserted by a test.
