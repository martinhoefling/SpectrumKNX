## Why

The filter pane's "Active Filters" block auto-populates above the edit sections the
moment a filter is toggled, so the edit controls and filter entries shift under the
user's cursor while they work (#87). It is, in #272's words, "so distracting." The
pane also carries a source/target **AND / OR** toggle that #275 explicitly wants
gone — filters should always be AND'd, with OR reserved for a later multi-instance
design. And there is no way to see everything again briefly without tearing the
filter set down and rebuilding it.

This is slice A — the "core UX change" — of the Filter & sidebar redesign (#370),
which is the second foundational epic of the Frontend Revamp (#287) after the app
shell (#374). It stands alone and unblocks the later reuse slices.

## What Changes

- **One pane, two views.** The auto-populating "Active Filters" block is removed. A
  control in the pane's "Filter" header toggles the pane body between an **Edit
  filters** view (the category sections) and an **Active filters** view (the current
  filter set, each entry removable / individually toggleable). Filter entries no
  longer move around as filters are edited.
- **All-AND semantics.** The source/target AND / OR toggle is removed from the UI and
  no longer affects matching — all active filters are combined with AND. Shared links
  and saved workspaces that carry the old `rel_st=OR` parameter still load, degrading
  gracefully to AND (OR returns later as multiple filter instances, a deferred #370
  slice).
- **Master enable/disable.** A "filters active / inactive" toggle temporarily
  disables the whole filter set without clearing it, mirroring the quick-filter
  enabled toggle; while disabled the Telegram List shows all telegrams and the set is
  preserved for re-enabling.
- **Per-filter control retained.** Removing or toggling an individual filter from the
  Active view works as before.

Out of scope / deferred to later #370 slices: the multiple-filter-instance OR'd tab
strip (#275); source/target filter categories, resizable sub-panes, and live
hierarchical counts (#272, slice B); the reusable Visualizer / Last-Seen sidebar
component (#363, slice C); and cross-panel filter reuse that would revert #241
(#275 B/C, slice D). Filters remain list-only per #374.

## Capabilities

### New Capabilities
- `filter-pane`: the Telegram List filter pane — its Edit ↔ Active view toggle, the
  removal of the auto-populating active block, all-AND combination semantics with
  backward-compatible `rel_st` parsing, the master enable/disable toggle, and
  per-filter control in the Active view.

### Modified Capabilities
<!-- None captured yet: no prior spec describes the filter pane; this is the first. -->

## Impact

- **Frontend only.** No backend or API change.
- `frontend/src/components/FilterPanel.tsx` — replace the always-rendered active
  block with a header view toggle and an Active view; remove both source/target
  AND/OR toggle UIs.
- `frontend/src/types/filters.ts` — `matchesTelegram` always ANDs source/target
  (drop the `sourceTargetRelation === 'OR'` branch); the field is retained but
  neutral for backward compatibility.
- `frontend/src/utils/historyLoad.ts` — remove the OR-mode query split; always the
  single AND query.
- `frontend/src/App.tsx` — add a `filtersEnabled` UI-session flag (default on),
  passed to `FilterPanel` and applied so `filteredLiveTelegrams` shows everything
  when disabled; the list-header filter badge reflects the enabled state.
- `frontend/src/utils/uiState.ts` — persist `filtersEnabled` alongside the other
  session state (`quickFilter.enabled` is the model to follow).
- `viewUrl.ts` / `workspaceState.ts` — keep reading `rel_st` for old links but stop
  writing it; behavior is AND regardless.
