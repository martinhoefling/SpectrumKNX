## Context

See `proposal.md` — Why. Current `FilterPanel.tsx` facts that shape the design:

- The pane renders a **Header** ("Filter" + active-count badge + a clear-all X shown
  when `activeCount > 0`), then an **Active Filters** block rendered inline whenever
  `activeCount > 0` (`maxHeight: 40%`, its own scroll), then the **Edit** category
  `Section`s (Source / Target / Type / Direction / DPT / Time-Delta). The active
  block is what shifts the layout as filters change.
- Combination is `sourceTargetRelation: 'AND' | 'OR'` on `ActiveFilters`. It is used
  in `matchesTelegram` (types/filters.ts:105), split into two queries for OR in
  `historyLoad.ts` (81–87), written/read as `rel_st` in `viewUrl.ts` and
  `workspaceState.ts`, and toggled by two UI blocks in `FilterPanel.tsx` (≈329 for
  the live active block, ≈504 for the history edit view).
- The panel is shared by two modes: `mode: 'live'` (Telegram List) and `mode:
  'history'` (History Search). Counts (`counts`) are live-only.
- The app already has the pattern for a "temporarily disabled but preserved"
  toggle: `quickFilterEnabled` (App state, persisted in `uiState`, mirrored into
  `TelegramTable`). The master filter toggle follows it.
- After #374 the filter pane is list-only and its open/close toggle lives in the
  Telegram List panel header; the list-header filter badge reads `activeFilterCount`.

## Goals / Non-Goals

**Goals:**
- Remove the auto-populating active block; make Edit vs Active an explicit,
  user-controlled view so filter entries stop moving (#87).
- Always-AND combination; delete the AND/OR UI without breaking old shared links.
- A master enable/disable that preserves the set, mirroring quick-filter enabled.

**Non-Goals:**
- Multiple filter instances / OR tab strip (#275), categories + counts + resizable
  sub-panes (#272), the reusable sidebar (#363), and cross-panel reuse (#275 B/C).
- Any change to which panels see the filter (still list + history only, per #374).
- Removing `sourceTargetRelation` from the type/URL wholesale (kept, neutralized).

## Decisions

### Decision 1: Header view toggle drives one pane body; no inline active block

Add `view: 'edit' | 'active'` local state to `FilterPanel`, defaulting to `'edit'`.
A segmented control in the pane header switches it. The body renders **either** the
Edit `Section`s **or** the Active view (the current active-block markup, moved out of
its auto-inserted position). The active block is no longer rendered above Edit, so
editing never reflows the entries. The header keeps the active-count badge and the
clear-all X.

- **Alternative considered:** keep both stacked but pin the active block's height.
  Rejected — it still reflows and still splits attention; #272/#275 ask to dismiss
  it, not shrink it.
- The toggle sits in the header (not by the search line) because there is no single
  search line today and the header is the stable, always-present anchor #275
  describes ("in the 'Filter' Header").

### Decision 2: All-AND matching; neutralize `sourceTargetRelation`

`matchesTelegram` always requires source AND target (drop the `=== 'OR'` branch).
`historyLoad.ts` always issues the single AND query (remove the OR split). Remove
both AND/OR toggle UI blocks. Keep the `sourceTargetRelation` field on `ActiveFilters`
(default `'AND'`) so `viewUrl`/`workspaceState` still parse old `rel_st=OR` links
without error — the value is simply ignored by matching, so such links load as AND.
Stop writing `rel_st` going forward.

- **Alternative considered:** delete the field entirely. Rejected for this slice —
  it ripples through URL/workspace parsing and offers no user benefit now; a clean
  removal can ride along with the multi-instance work that reshapes the filter model.

### Decision 3: Master enable/disable = a `filtersEnabled` flag lifted to App

Model the master toggle as `filtersEnabled: boolean` (default `true`) in `App`,
persisted in `uiState` next to `quickFilter.enabled`. `filteredLiveTelegrams` treats
`!filtersEnabled` as the no-filter path (show everything) without clearing
`activeFilters`. `FilterPanel` receives `filtersEnabled` + `onFiltersEnabledChange`
and renders the toggle (an "(in)active" control, matching the quick-filter idiom).
The list-header filter badge/accent reflects "has filters AND enabled".

- Scope: **live mode only.** In history mode the filter *is* the query, so a
  "show all history" master switch is out of place; the toggle is hidden (or inert)
  when `mode === 'history'`. The Edit/Active view toggle still applies to both modes.
- Reuse `matchesTelegram` untouched; gating happens where `filteredLiveTelegrams`
  already computes `noFilter`, so no matching-path duplication.

### Decision 4: Active view content unchanged per entry

The Active view keeps the existing per-entry rows (label, sublabel, count, remove,
quick actions like Last-Seen / SendToGa). Only its placement and trigger change. The
AND/OR relation row between sources and targets is deleted (Decision 2).

## Risks / Trade-offs

- **Old OR-mode links silently become AND.** Acceptable and documented; OR returns as
  multiple instances later. No error, no data loss — just a wider result set than the
  original author intended, which the user can re-narrow.
- **Two-mode component.** The master toggle must be correctly gated to live mode so
  History Search behavior is unchanged. Covered by keeping the toggle behind
  `mode === 'live'` and by tests for both modes.
- **Discoverability of the Active view.** Removing the always-on block hides the
  active set behind a toggle; mitigate with the persistent active-count badge in the
  header so the user still sees *that* filters are active and can one-click to view
  them.
- **Persistence shape drift.** Adding `filtersEnabled` to `uiState` must be
  backward-compatible (absent → default `true`); follow the existing `DEFAULT_UI_STATE`
  merge so older stored state loads cleanly.
