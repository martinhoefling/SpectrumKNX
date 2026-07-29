## 1. UI session-state store

- [x] 1.1 Create `frontend/src/utils/uiState.ts`: a versioned localStorage helper (key `spectrum-knx-ui`) with a `UiSessionState` interface, `DEFAULT_UI_STATE`, and `load`/`save` that wrap storage in try/catch and `sanitize` field-by-field (mirroring `workspaceState.ts`). Fields: `quickFilter` (`open`, `enabled`, `patterns`), `listFollow` (bool), `listAnchorKey` (string|null), `zoomRange` ([number,number]|null), `statsSearch`, `buildingSearch`, `lastSeenLimit`, `lastSeenLive`, `lastSeenSearch`.
- [x] 1.2 Add `frontend/src/utils/uiState.test.ts`: round-trip save/load, version-mismatch → defaults, malformed JSON → defaults, storage-throws → defaults.
- [x] 1.3 In `App.tsx`, seed a `uiState` object from `uiState.load()` on mount and add one debounced effect that persists it via `uiState.save()` (model on the existing workspace-persist effect).

## 2. Telegram List — autoscroll anchor + quick-filter (#203, #280)

- [x] 2.1 Lift the follow/anchor state out of `TelegramTable` into `App` (`listFollow` + `listAnchorKey`), passing `value`/`onChange` props; keep `anchorKey(t)` as the identity function.
- [x] 2.2 On mount/remount, restore: follow → scroll to live edge; else re-pin the row whose `anchorKey` matches `listAnchorKey`; if the key no longer resolves to a buffered row, fall back to the live edge.
- [x] 2.3 Lift quick-filter `open`/`enabled`/`patterns` into `App` as `value`/`onChange` props on `TelegramTable`.
- [x] 2.4 Extend `TelegramTable` tests: quick-filter open/enabled/patterns and follow/anchor state are driven by props and survive an unmount+remount cycle.

## 3. Visualization zoom region (#236)

- [x] 3.1 Lift `zoomRange` out of `Visualizer` into `App`, passed as `value`/`onChange`; preserve the `autoFollow = zoomRange === null` behavior so a restored zoom still freezes the scale.
- [x] 3.2 Test: a set zoom range survives remount and still disables auto-follow; a null zoom restores as full-range auto-follow.

## 4. Traffic Statistics + Building Structure search (#341)

- [x] 4.1 Lift `StatisticsOverlay.searchQuery` into `App` (`statsSearch`) as `value`/`onChange`.
- [x] 4.2 Lift `BuildingOverlay.searchQuery` into `App` (`buildingSearch`) as `value`/`onChange`.
- [x] 4.3 Tests: each search field is prop-driven and its value + filtering survive remount.

## 5. Last Seen Values — selectors, live, search, selection

- [x] 5.1 Lift `limit`, `autoRefresh`, and local `search` out of `LastSeenOverlay` into `App` (`lastSeenLimit`, `lastSeenLive`, `lastSeenSearch`) as `value`/`onChange` props.
- [x] 5.2 Add an `onSelectionChange(mode, addresses)` callback so in-panel selection edits sync back to `App`'s `lastSeenMode`/`lastSeenAddresses` (which already persist via the workspace).
- [x] 5.3 Verify the "show last seen for…" path: `handleQuickLastSeen` still sets the selection before opening, the back-sync reports the action's selection (not a stale one), and it wins for that entry.
- [x] 5.4 Tests: limit/live/search survive remount; a manually chosen selection is restored on return; a "show last seen for…" entry overrides the previously preserved selection.

## 6. Visualization Targets search (already persisted)

- [x] 6.1 Add a regression test asserting `VisualizerSidebar` restores its search field from the `vizTargetSearch` pref across remount (no production change).

## 7. Verification

- [x] 7.1 Run `frontend` lint + unit tests; fix fallout.
- [x] 7.2 Manual pass: for each panel, change its state, navigate away and back, and confirm restoration; reload and confirm the localStorage-backed pieces persist while the URL stays free of the new state.
