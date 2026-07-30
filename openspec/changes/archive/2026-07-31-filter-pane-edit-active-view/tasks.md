## 1. Edit ↔ Active view toggle

- [x] 1.1 Add `view: 'edit' | 'active'` local state to `FilterPanel` (default `'edit'`) and a segmented toggle in the pane header.
- [x] 1.2 Move the existing active-filters markup out of its auto-inserted position; render it as the Active view body, and render the Edit `Section`s as the Edit view body — one or the other, never stacked.
- [x] 1.3 Keep the header active-count badge and clear-all X visible in both views.

## 2. All-AND semantics

- [x] 2.1 In `types/filters.ts` `matchesTelegram`, always require source AND target (drop the `sourceTargetRelation === 'OR'` branch).
- [x] 2.2 In `utils/historyLoad.ts`, remove the OR-mode query split; always issue the single AND query.
- [x] 2.3 Remove both source/target AND/OR toggle UI blocks from `FilterPanel` (the live active block and the history edit view).
- [x] 2.4 Keep the `sourceTargetRelation` field (default `'AND'`) so `viewUrl`/`workspaceState` still parse old `rel_st=OR` links; stop writing `rel_st` going forward.

## 3. Master enable/disable

- [x] 3.1 Add `filtersEnabled` state to `App` (default `true`); persist it in `uiState` alongside `quickFilter.enabled`, with absent → `true` on load.
- [x] 3.2 Apply it where `filteredLiveTelegrams` computes `noFilter`: when `!filtersEnabled`, show all telegrams without clearing `activeFilters`.
- [x] 3.3 Pass `filtersEnabled` + `onFiltersEnabledChange` into `FilterPanel`; render the enable/disable control (matching the quick-filter "(in)active" idiom). Gate it to `mode === 'live'`.
- [x] 3.4 Make the list-header filter badge/accent reflect "has active filters AND enabled".

## 4. Verify

- [x] 4.1 `FilterPanel` tests: header toggle switches Edit ↔ Active; editing in the Edit view does not render an active block above it; active-count badge shows in both views; no AND/OR control exists; per-filter remove works from the Active view.
- [x] 4.2 `matchesTelegram` tests: source+target always AND (including a fixture that previously set OR now behaving as AND).
- [x] 4.3 App/uiState tests: `filtersEnabled=false` shows all telegrams while preserving `activeFilters`; state persists via `uiState`; absent value defaults to enabled.
- [x] 4.4 Backward-compat test: a URL/workspace with `rel_st=OR` loads and applies filters as AND.
- [x] 4.5 Run frontend typecheck, lint, and the full unit suite; fix fallout.
- [x] 4.6 Manual pass (Playwright against the Vite dev server): toggle Edit ↔ Active, confirm entries don't reflow while editing, disable/enable the whole set and confirm the list widens/narrows while filters persist, and confirm no AND/OR control remains.
