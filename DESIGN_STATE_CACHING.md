# Design: Telegram Caching, Async Loading & Workspace Persistence

Umbrella issue: #249 — sub-issues #246 (RFC: caching & preferences), #222 (async
history reads), #211 (workspace persistence across HA dashboard switching).

## Goals

1. **Instant restore after reload / iframe recreation** (#211, #246): telegrams
   reappear from a client-side cache immediately; only the *gaps* (time ranges
   never fetched, disconnection/closed-tab windows) are loaded from the backend.
2. **Non-blocking loads** (#222): history reads never block the UI; progress is
   visible in the connection-status area and on the load button.
3. **Workspace persistence** (#211): filters, active panels, viz targets survive
   HA dashboard switches (companion/iframe → `localStorage`) and are shareable /
   reload-safe in the regular app (→ URL).
4. **Preferences on `localStorage`** (#246 Phase 1): drop cookies entirely.

Non-goals (per #246 finalized decisions): the History Search tab stays
uncached and always queries the backend fresh. Embed view is unaffected.

## Architecture

Port the `knx-frontend` Group Monitor 3-service architecture, composed by a
React hook:

```
                    ┌────────────────────────────┐
 WS telegram ──────▶│      useTelegramCache      │──▶ telegrams snapshot → App
 REST gap fetch ───▶│  (hooks/useTelegramCache)  │──▶ loadStatus (idle/loading/error)
                    └──────┬───────┬───────┬─────┘
                           ▼       ▼       ▼
              BufferService  CacheService  CoverageService
              (in-memory     (IndexedDB    (interval bookkeeping,
               ring buffer,   idb-keyval,   persisted to localStorage
               dedup merge)   ≤100k rows)   "spectrum-knx-coverage")
```

- **`services/telegram-buffer-service.ts`** — near-verbatim port. Generic over
  `{ id: string; ts: number; telegram: Telegram }` entries; chronological
  insertion with fast-path append, deduplicating `merge()`, overflow eviction at
  `loadLimit`, immutable `snapshot`.
- **`services/telegram-cache-service.ts`** — port using `idb-keyval` (new dep),
  store `createStore("spectrum-knx-bus-monitor", "telegrams")`. API: `store`,
  `loadRange`, `loadAll`, `evictBefore`, `evictToSize(100_000)`, `count`,
  `clear`. Purely advisory: every failure falls back to a backend query.
- **`services/telegram-coverage-service.ts`** — pure-math port unchanged
  (`addCovered`, `gaps`, `isCovered`, `trim`, `extendLive`, `closeLive`), plus
  small persistence helpers (load/save intervals to
  `localStorage["spectrum-knx-coverage"]`).
- **`utils/telegramId.ts`** — stable client-side id (backend rows have none):
  `${timestamp}|${source_address}|${target_address}|${raw_data ?? ""}` and
  `tsMs = Date.parse(timestamp)`. Strictly finer than today's dedup, which uses
  the timestamp alone.

### Hook behavior (`hooks/useTelegramCache.ts`)

Startup (async, non-blocking — #211 + #222):
1. Restore coverage intervals from `localStorage`; fetch `/api/database` and
   `trim()` coverage + `evictBefore()` IDB to the retention window.
2. `cache.loadAll()` → `buffer.merge()` → first paint shows cached telegrams
   immediately.
3. Compute `coverage.gaps(windowStart, now)` (windowStart = older of oldest
   covered interval and oldest cached entry) and fetch each gap from
   `/api/telegrams?start_time&end_time&limit` in the background, oldest-visible
   status via `loadStatus`. On success `addCovered(gapStart, gapEnd)`; if
   `metadata.limit_reached`, only `addCovered(oldestReturnedTs, gapEnd)` so the
   unfetched remainder stays a gap.

Live path:
- `addLive(t)`: `buffer.add`, `coverage.extendLive(tsMs)`, and enqueue for a
  batched `cache.store()` flush (every ~2 s or 200 telegrams — avoids one IDB
  transaction per telegram on busy buses).
- WS disconnect → `coverage.closeLive()`; reconnect → background gap-fill of
  the offline window (replaces today's silent data hole).
- **Pause** becomes a *view freeze*: the hook keeps ingesting into
  buffer/cache/coverage and simply stops publishing new snapshots. This
  retires `bufferRef` + `PAUSE_BUFFER_CAP` (10k drop-oldest) — "Zero Loss"
  now genuinely holds up to `loadLimit`.
- Coverage persisted to `localStorage` debounced (~5 s) and on `pagehide`.

Explicit loads:
- `loadRange(range)`: covered sub-ranges served from IDB, gaps fetched
  async; used by the Group Monitor's HistoryLoader (modal closes immediately,
  progress moves to the header — #222).
- `clear()`: buffer + IDB + coverage (Trash button — otherwise a reload would
  resurrect the "cleared" telegrams).
- Eviction: after each flush, `evictToSize(100k)`; on surviving-oldest change,
  `coverage.trim()` to match.

### App integration (`App.tsx`)

Replace `liveTelegrams` state, `handleTelegram` buffer logic, `togglePause`
merge, and `handleHistoricalLoad` with the hook. Keep: rate estimation,
`latestTelegram`, sorting/filtering memos (operate on the snapshot unchanged).
Header status area gains a "History: loading…" spinner chip next to the WS
badge while any background load runs (#222), and the Load History (Download)
button shows a spinner while active.

## Preferences: cookies → localStorage (#246 Phase 1)

Rewrite `utils/cookies.ts` internals as a `localStorage`-backed preferences
module (`getPref`/`setPref`/`removePref`), keeping thin `getCookie`/`setCookie`
wrappers so call sites (`App.tsx`, `useTheme.ts`, `sortConfig.ts`,
`TelegramTable.tsx`, `Visualizer.tsx`) change minimally; one-time lazy
migration (localStorage empty + cookie present → copy, erase cookie).
Keys affected: `theme`, `loadLimit`, `visibleColumns`, `rateMode`,
`sortConfig`, `columnWidths`, `chartStepped`, `chartDots`,
`dismissed_update_version`.

## Workspace persistence (#211)

Workspace = the session state currently lost on iframe recreation: `activeTab`,
`activeFilters`, `selectedVisualizationTargets`, open panel
(filter/visualizer/last-seen/statistics/building), last-seen addresses+mode.
(Preferences above are already persistent and excluded.)

- `utils/workspaceState.ts`: `serializeWorkspace()` / `parseWorkspace()` +
  versioned `localStorage["spectrum-knx-workspace"]` record.
- **Startup precedence**: explicit share URL (`view=viz`, existing #150
  behavior) → persisted workspace **iff embedded** (`window.self !==
  window.top`, i.e. HA dashboard iframe; synchronous, no serverConfig wait) →
  defaults.
- **Companion/iframe**: debounced write to `localStorage` on every workspace
  change. Combined with the telegram cache + startup gap-fill, switching
  dashboards away and back restores the full workspace with telegrams
  "up to now" — exactly #211's ask.
- **Regular app**: reflect the workspace into the URL via
  `history.replaceState` (extend `viewUrl.ts` with a `view=monitor` encoding
  reusing the existing filter/plot params), making reloads and bookmarks
  workspace-preserving without touching localStorage.

## Backend changes

None required. `/api/telegrams` already supports `start_time`/`end_time`/
`limit` with `limit_reached` metadata; `/api/database` provides
`retention_days` and `oldest_timestamp`; FastAPI reads are already async.

## Testing (vitest, jsdom)

- Port the existing knx-frontend unit tests for buffer/coverage/cache services
  (adapted types); add `fake-indexeddb` devDep for the cache service.
- New tests: telegram id derivation, coverage persistence round-trip,
  workspace serialize/parse + precedence, prefs migration, and hook tests
  (mocked fetch + fake timers) covering: cache-first paint, gap-fill with
  `limit_reached`, disconnect→reconnect gap, pause freeze, clear.

## Implementation phases (one PR each, unit checks per PR)

1. **Preferences → localStorage** (small, independent).
2. **Service ports + unit tests** (no app wiring; adds `idb-keyval`,
   `fake-indexeddb`).
3. **`useTelegramCache` + App integration + async load UX** — closes #222 and
   the caching half of #246/#211.
4. **Workspace persistence + URL reflection** — closes #211, completes #249.

Browser/e2e verification deferred to the combined pre-release pass.

## Risks / notes

- **Id collisions**: two distinct telegrams within the same DB timestamp with
  identical src/tgt/payload dedup to one. Backend timestamps carry microsecond
  precision and today's dedup is coarser (timestamp only), so this is a strict
  improvement.
- **Multi-tab**: two tabs share the IDB store and coverage key; last writer
  wins. Worst case is redundant fetching, never data loss. Accepted.
- **IDB unavailable** (private browsing): all cache calls are advisory —
  behavior degrades to today's (fetch-on-demand).
- **Render cost**: the existing full re-sort of up to `loadLimit` rows per
  telegram is unchanged by this design; the ascending buffer enables a cheap
  fast path for the default timestamp sort later (optional follow-up).
- **URL length**: `view=monitor` URLs with many filters can get long; params
  are already compact and this mirrors the existing share-link format.
