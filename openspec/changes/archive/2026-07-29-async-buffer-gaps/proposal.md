## Why

The group monitor's background history loader can leave permanent un-fillable gaps in the telegram buffer and IndexedDB cache. This happens because the coverage service immediately marks intervals as covered before the corresponding telegrams are successfully written to IndexedDB, causing subsequent load attempts to skip them. Additionally, when the in-memory buffer reaches capacity, the history loader halts paging backward, preventing users from retrieving older data.

## What Changes

- **Synchronized Coverage Tracking**: Adjust the cache ingestion pipelines (both live WS stream and historical fetches) so that time intervals are only added to the coverage service (and saved to localStorage) after their database entries have successfully finished writing to IndexedDB.
- **Robust History Paging**: Refactor the background history loader to ensure it continues paging and loading requested time ranges even when the in-memory buffer is full, correctly handling evictions to maintain the newest/oldest boundaries instead of breaking out early and leaving gaps.

## Capabilities

### New Capabilities

- `async-buffer-gaps`: Specifies the correct asynchronous gap-fetching, cache synchronization, and buffer eviction behavior to prevent time gaps.

### Modified Capabilities

## Impact

- `frontend/src/hooks/useTelegramCache.ts`: Central logic for WS connection state, pending writes, and gap filling.
- `frontend/src/components/HistoryLoader.tsx` / `App.tsx`: Triggers for asynchronous loads.
