## 1. Allow user-initiated loads to bypass the full-buffer early break

- [x] 1.1 Add a `skipBufferFullBreak` parameter (default `false`) to `fetchGapProgressive` in `useTelegramCache.ts` and skip the `buf.length >= maxSize && cursor < buf.oldestTs` early break when it is `true`
- [x] 1.2 Thread `skipBufferFullBreak` through `fillGapsBudgeted` and `fillGaps` so callers can opt in
- [x] 1.3 Update `loadRange` to pass `skipBufferFullBreak: true` so explicit user loads page through the full range
- [x] 1.4 Keep the startup hydration and reconnect paths passing `false` (existing behavior)

## 2. Guard coverage persistence against incomplete IDB writes

- [x] 2.1 Add a `pendingStoreCount` ref to `useTelegramCache` that tracks in-flight `cacheRef.current!.store()` calls (increment before, decrement in `.then`/`.catch`)
- [x] 2.2 In the periodic flush timer, skip the `saveCoverage()` call when `pendingStoreCount > 0`
- [x] 2.3 After the pending store resolves (count drops to 0), trigger a deferred `saveCoverage()` so coverage is persisted once the write completes

## 3. Tests

- [x] 3.1 Add a unit test for `fetchGapProgressive` confirming it continues paging when `skipBufferFullBreak` is `true` and the buffer is full
- [x] 3.2 Add a unit test verifying that coverage is not saved while an IDB store is in flight
- [x] 3.3 Add a unit test verifying that a failed IDB store does not mark the range as covered
