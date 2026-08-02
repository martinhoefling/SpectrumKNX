## Context

See proposal.md for motivation. The Group Monitor's `useTelegramCache` hook
orchestrates an in-memory buffer, an IndexedDB persistent cache, and a
coverage-interval tracker. Two interacting problems cause permanent time gaps
in the telegram timeline:

1. **Coverage/cache desync** — When `fetchGapProgressive` fetches a chunk and
   the IDB write fails (quota, browser hiccup), the coverage tracker is
   correctly *not* updated for the chunk's range. However, when the backend
   returns fewer rows than `limit` (i.e. `!limitReached`), the code
   unconditionally marks `[gapStart, cursor]` as covered **gated only on
   `stored`**. This part is actually correct per the current code. The real
   desync surfaces in the *startup* path: `extendLive()` calls
   `addCovered()` optimistically for every connected tick, and the periodic
   flush persists coverage to `localStorage` even when the corresponding IDB
   batch write hasn't completed yet. A crash or tab close between the
   coverage save and the IDB commit leaves coverage claiming a range the
   cache can't serve on next load.

2. **Early break on full buffer** — `fetchGapProgressive` (line 159) breaks
   out of the paging loop when `buf.length >= maxSize && cursor < buf.oldestTs`.
   This was added in #313 to avoid fetching rows that are immediately evicted.
   But when the *user* explicitly requests a history range (the "Load History"
   dialog), the older portion of the requested range is silently abandoned and
   left uncovered. On the next startup, the coverage tracker sees no gap
   (live intervals may have been extended over it), so the user sees a
   permanent hole in their timeline.

## Goals / Non-Goals

**Goals:**
- Eliminate permanent time gaps caused by desync between coverage state and
  IDB cache contents.
- Allow explicit `loadRange` calls to fill their full requested range even
  when the buffer is at capacity, by continuing to fetch and cache (IDB) the
  data even if the in-memory buffer evicts older rows.

**Non-Goals:**
- Changing the `#313` optimisation for the *automatic* startup gap fill;
  that budget-capped path can still break early to keep startup cheap.
- Reworking the IndexedDB storage layer or changing `idb-keyval`.
- Addressing the separate `MAX_CACHE_SIZE` eviction cadence or IDB scan
  performance.

## Decisions

### 1. Separate "user-initiated" from "automatic" gap fills

**Decision:** Add a `skipBufferFullBreak` flag (or equivalent) to
`fetchGapProgressive` that disables the early-exit-on-full-buffer check.
`loadRange` (user-initiated) passes `true`; the startup hydration and
reconnect paths pass `false` (default).

**Rationale:** The #313 optimisation is correct for the startup path where
we don't want to churn through rows only to evict them. But an explicit
user load should honour the full range — the data goes into IDB even if
it overflows the in-memory buffer. The in-memory buffer already handles
eviction correctly via `TelegramBufferService.merge()`.

**Alternative considered:** Removing the early break entirely. Rejected
because startup would regress on low-power hosts (#284, #297).

### 2. Await IDB writes before persisting coverage in the flush timer

**Decision:** Gate the `saveCoverage()` call in the periodic flush on the
IDB batch write having completed. Track a simple "dirty" flag: set when a
`store()` call is in flight, clear on resolve. `saveCoverage()` skips when
dirty.

**Rationale:** The root cause of the crash-window desync: `saveCoverage()`
runs on a 2 s timer; the `store()` it depends on is async and may not have
finished. By deferring the coverage save until the pending IDB write
resolves, a crash between the two can't leave orphaned coverage.

**Alternative considered:** Writing coverage *inside* `store()`. Rejected
because coverage logic is intentionally separated from the cache service.

### 3. Mark empty ranges as covered only when they are truly DB-confirmed empty

**Decision:** In `fetchGapProgressive`, when `entries.length === 0`, the
range is genuinely empty in the backend — mark it covered unconditionally
(the DB confirmed there's nothing there, so no IDB write is needed).

**Rationale:** No change needed here; the current behavior is correct.
An empty response from the backend means the time range has no telegrams,
so marking it covered is safe regardless of IDB state.

## Risks / Trade-offs

- **Explicit loads on a full buffer fetch data that won't be visible:**
  The user-initiated load will page through the full range and persist to
  IDB, but the in-memory buffer will only show the newest `maxSize` rows.
  Older rows are available on the next history load from cache.
  → Acceptable: the user's intent is to load the range into persistent
  storage; the buffer is a view window.

- **Delayed coverage persistence increases the crash-gap window slightly:**
  By waiting for IDB writes, a crash during the write leaves the range
  uncovered (and thus re-fetched on next load) rather than falsely covered.
  → This is the correct failure mode; re-fetching is cheaper than a
  permanent gap.
