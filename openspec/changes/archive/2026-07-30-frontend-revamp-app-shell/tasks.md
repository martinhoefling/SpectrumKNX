## 1. Active-panel selector

- [x] 1.1 Introduce `activePanel: 'list' | 'visualizer' | 'statistics' | 'building' | 'lastseen'` in `App.tsx`, replacing the `isVisualizerOpen` / `isStatisticsOpen` / `isBuildingOpen` / `isLastSeenOpen` booleans (derive the old prop names from it where child components still expect them).
- [x] 1.2 Route every panel-open handler (`handleQuickVisualize`, `handleQuickLastSeen`, building/statistics openers) through `setActivePanel`, removing the manual "turn the other three off" logic.
- [x] 1.3 Map `activePanel` to the persisted `WorkspaceView` (`'list'` ↔ `'none'`) in both directions so reload/share restores the panel; keep `isDatabaseOpen` / `isSettingsOpen` / `activeTab` orthogonal.

## 2. Top-right toolbar: panel switch + write-to-bus

- [x] 2.1 Replace the right-header view icon-buttons with a five-segment panel switch (Telegram List / Visualization / Statistics / Building Structure / Last Seen Values) that marks the active panel and calls `setActivePanel`. (`PanelSwitch` component, `role="tab"` per segment.)
- [x] 2.2 Place the write-to-bus toggle next to the switch, shown only when `serverConfig.status.write_enabled`.
- [x] 2.3 Keep the buffer/rate/WS stats pill in the header, with buffer count + load-history + clear grouped as one buffer indicator (no status bar). (Unchanged — already grouped.)

## 3. Filter-pane toggle relocation

- [x] 3.1 Move the filter toggle out of the global header to the top-left of the panel content area. (Now in the Telegram List panel header.)
- [x] 3.2 Show it only for panels where filters apply; do not render it for no-filter panels. Replaced the force-close effect: the filter pane is gated on `activePanel === 'list'` via `showFilterPane`, so it simply doesn't render (and its toggle doesn't appear) for other panels.

## 4. Play/pause with the Telegram List

- [x] 4.1 Render play/pause as part of the Telegram List panel instead of the global toolbar; `isPaused` / `togglePause` unchanged.
- [x] 4.2 Ensure it is not shown in the global header when another panel is active. (It renders only in the list panel header.)

## 5. Consistent per-panel close

- [x] 5.1 Each of Visualization / Statistics / Building Structure / Last Seen Values already renders an X in its own header; their `onClose` now routes through `setActivePanel('list')` so every close returns to the Telegram List.

## 6. Date-aware time display

- [x] 6.1 Shared helper already exists (`spansMultipleDays` / `formatAxisTime` / `formatFullTime` in `utils/timeFormat.ts`, from #281) — computes multi-day-ness from a min/max pair. No new helper needed.
- [x] 6.2 Absolute telegram times already carry the date where they can span days: `TelegramTable` and `GaValuesTable` render the date unconditionally, and the charts (Timeline/Mixed/TimeBrush) use the multi-day helper. No time-only telegram surface remained to fix.

## 7. Live / bus-write rule

- [x] 7.1 Verified: the write-to-bus panel sends via `/api/knx/send` (server-side) with no local list injection; the resulting telegram returns over the WebSocket and flows through `handleTelegram → addLive`, which honours `setCachePaused`. Bus writes therefore follow the same live/pause semantics as bus traffic — no change needed.

## 8. Verify

- [x] 8.1 Added `App` test: the five main-panel tabs render in order with Telegram List active by default. (Reload-restore of the active panel is covered by the existing `workspaceState` tests via the `WorkspaceView` mapping; close→list is wired through the single `setActivePanel('list')`.)
- [x] 8.2 Added `App` test: the filter toggle and play/pause render in the Telegram List panel header.
- [x] 8.3 Date-aware helper is covered by the existing `utils/timeFormat.test.ts` (single-day → time only; multi-day → date + time).
- [x] 8.4 Ran frontend typecheck (`tsc --noEmit`), lint (0 errors), and the full unit suite (41 files / 270 tests) — all green.
- [x] 8.5 Manual pass (Playwright against the Vite dev server, frontend-only with route stubs): 19/19 checks — the five-panel switch renders in order with Telegram List active by default; selecting each of Visualization / Statistics / Building Structure / Last Seen Values activates it and hides the list-header pause; each panel's X returns to the Telegram List; the filter toggle and play/pause sit in the Telegram List panel header and pause↔resume toggles; the write-to-bus toggle shows next to the switch when write is enabled. Screenshot at /tmp/spectrum-verify/shell.png confirms the layout.
