## Context

See `proposal.md` — Why. Root cause: in `App.tsx` the main panels are
conditionally rendered (`isVisualizerOpen ? <Visualizer/> : isLastSeenOpen ?
<LastSeenOverlay/> : … : <TelegramTable/>`), so navigating between panels
unmounts the outgoing one and its local `useState`/`useRef` state is discarded.

Two persistence mechanisms already exist and constrain the design:

- `utils/workspaceState.ts` (#211) — the "workspace": tab, view, filters, plot
  targets, last-seen addresses + mode. Persisted to the **URL** in a regular
  browser tab (shareable, bookmarkable) and to **localStorage** when embedded in
  a Home Assistant iframe. Anything added here shows up in the address bar.
- `utils/prefs.ts` (#246) — durable per-user preferences in localStorage
  (theme, columns, sort, `vizTargetSearch`, …). Never in the URL.

Item-by-item current state (verified in code):

| Item | Lives in | Today |
|------|----------|-------|
| Autoscroll / anchor (#203) | `TelegramTable`: `atEdgeRef`, `anchorRef`, `newSinceAnchor` | local, lost |
| Quick-filter (#280) | `TelegramTable`: `quickOpen`, `quickEnabled`, `quickPatterns` | local, lost |
| Zoom region (#236) | `Visualizer`: `zoomRange` | local, lost |
| Viz Targets search | `VisualizerSidebar`: `search` ↔ `vizTargetSearch` pref | already persists |
| Statistics / Building filter | `StatisticsOverlay.searchQuery`, `BuildingOverlay.searchQuery` | local, lost |
| Last Seen limit / live / search | `LastSeenOverlay`: `limit`, `autoRefresh`, `search` | local, lost |
| Last Seen selection | `LastSeenOverlay`: `mode`, `selectedAddresses` seeded from `initialAddresses`/`initialMode` | seeded from workspace, but in-panel edits never sync back |

## Goals / Non-Goals

**Goals:**
- State survives unmount/remount across main-panel navigation with minimal,
  local changes to each component.
- Keep the shareable URL clean: this ephemeral working state must not be encoded
  into `view=monitor` / `view=viz` URLs.
- Reuse existing patterns; don't introduce a state-management library.

**Non-Goals:**
- Cross-device / server-side persistence. This is client-only.
- Guaranteeing anchor restoration when the underlying telegram has been evicted
  from the buffer (best-effort; fall back to the live edge).
- Reworking how `lastSeenAddresses`/`lastSeenMode` are already threaded through
  the workspace — only fix the missing back-sync.

## Decisions

### Decision 1: A dedicated non-URL "UI session state" store

Introduce a new localStorage-backed helper, `utils/uiState.ts`
(key `spectrum-knx-ui`, versioned like `workspaceState`), holding the ephemeral
navigation-surviving fields: quick-filter (`open`/`enabled`/`patterns`),
Telegram-list follow flag + anchor key, Visualizer `zoomRange`, Statistics
search, Building search, Last Seen `limit`/`autoRefresh`/`search`.

- **Why not the workspace (`workspaceState.ts`)?** In a regular browser tab the
  workspace is reflected into the URL. Quick-filter text, zoom bounds, and free
  search strings would bloat and leak into shared links — undesirable and
  spec-forbidden (see the "URL stays clean" scenario).
- **Why not `prefs.ts` per field?** Prefs are the right home for *durable*
  single values, but the ephemeral set is a cohesive per-session blob; one
  versioned, sanitized store keeps parsing/validation in one place (mirroring
  `loadWorkspace`'s field-by-field `sanitize`).
- **Why persist to storage at all (vs. only lifting to `App` memory)?** Lifting
  to `App` state alone already satisfies "persist across navigation." Writing
  through to localStorage additionally survives reload for free and matches user
  expectation set by the existing workspace/prefs behavior. Reads are
  best-effort and degrade to defaults, exactly like `prefs`/`workspace`.

The state is **lifted into `App.tsx`** and passed down as
`value`/`onChange` props (the pattern already used for `selectedTargets`,
`lastSeenAddresses`). `App` seeds each from `uiState` on mount and writes back
(debounced, like the existing workspace effect) on change.

### Decision 2: Last Seen selection — fix back-sync, honor quick-action override

`lastSeenAddresses`/`lastSeenMode` already live in `App` and the workspace, but
`LastSeenOverlay` only *reads* them via `initialAddresses`/`initialMode` and
never reports internal selection changes back. Add an `onSelectionChange(mode,
addresses)` callback so in-panel edits update `App` (and thus the workspace).

The "show last seen for…" override is already structurally correct:
`handleQuickLastSeen` sets `lastSeenAddresses`/`lastSeenMode` directly before
opening the panel, so the action's selection wins for that entry. The only
requirement is that the back-sync (above) must not fight it — the callback
reports the selection the panel actually renders, which after a quick action is
the action's selection. Keep selection in the **workspace** (not the new
`uiState` store) so the existing seeding and URL/embedded behavior are unchanged.

### Decision 3: Anchor persistence keyed by telegram identity

`TelegramTable` already tracks a concrete anchor by `anchorKey(t)` (#202). Lift
"follow live edge" (boolean) and the anchor key (string | null) to `App`.
On remount, restore: if following, scroll to the live edge; else if the anchor
key still resolves to a row, re-pin it; otherwise fall back to the live edge.
Offset within the row is not persisted (best-effort re-pin to the row top is
sufficient and robust to layout changes).

### Decision 4: Visualization Targets search — assert, don't rebuild

Already persisted via the `vizTargetSearch` pref. Add a regression test
asserting it survives remount; no production change.

## Risks / Trade-offs

- **Stale anchor after buffer eviction** → best-effort: fall back to the live
  edge when the anchor key is gone; never throw.
- **localStorage unavailable (private mode / disabled)** → all reads/writes are
  wrapped in try/catch and degrade to in-memory defaults, matching
  `prefs`/`workspaceState`. State then survives navigation (via `App` memory)
  but not reload — acceptable.
- **Growing `App.tsx`** → several more lifted `useState`s. Mitigate by grouping
  the `uiState` slice behind a single `useUiState` hook / object rather than a
  dozen scattered `useState`s, and a single debounced persist effect.
- **Schema drift of the stored blob** → version field + field-by-field
  `sanitize` that discards unknown/invalid values and returns defaults on a
  version mismatch (same approach as `loadWorkspace`).

## Migration Plan

Pure additive frontend change; no data migration. A first load with no
`spectrum-knx-ui` key yields defaults (current behavior). Rollback is removing
the code — a leftover `spectrum-knx-ui` key is ignored and harmless.
