/**
 * Persistent telegram cache backed by IndexedDB (via idb-keyval), ported from
 * the Home Assistant knx-frontend Group Monitor (#246).
 *
 * Each entry is keyed by the telegram's stable client-side id (see
 * `utils/telegramId.ts`) and stores the epoch-ms timestamp alongside the raw
 * telegram so old entries can be evicted without deserialising the payload.
 *
 * The cache is purely advisory: callers should catch errors and fall back to a
 * backend query — a miss or storage failure must never break the app.
 */

import { clear, createStore, delMany, entries, setMany } from 'idb-keyval';
import type { Telegram } from '../hooks/useWebSocket';
import type { TelegramEntry } from '../utils/telegramId';

/** Maximum number of telegrams kept in the persistent cache. */
export const MAX_CACHE_SIZE = 100_000;

/** IDB store name — kept stable; changing it orphans existing data. */
const IDB_STORE = createStore('spectrum-knx-bus-monitor', 'telegrams');

/** Shape of each entry stored in IndexedDB. */
interface CachedEntry {
  ts: number; // epoch milliseconds — used for eviction ordering
  telegram: Telegram;
}

export class TelegramCacheService {
  /**
   * Persists a batch of telegrams. Existing entries with the same id are
   * overwritten (idempotent, matches the buffer's dedup behavior).
   */
  async store(batch: TelegramEntry[]): Promise<void> {
    if (batch.length === 0) return;
    const pairs: [string, CachedEntry][] = batch.map(({ id, ts, telegram }) => [id, { ts, telegram }]);
    await setMany(pairs, IDB_STORE);
  }

  /**
   * Returns cached entries whose timestamp falls within [startMs, endMs],
   * sorted newest first.
   */
  async loadRange(startMs: number, endMs: number): Promise<TelegramEntry[]> {
    const all = await entries<string, CachedEntry>(IDB_STORE);
    return all
      .filter(([, entry]) => entry.ts >= startMs && entry.ts <= endMs)
      .map(([id, entry]) => ({ id, ts: entry.ts, telegram: entry.telegram }))
      .sort((a, b) => b.ts - a.ts);
  }

  /** Returns all cached entries, newest first. */
  async loadAll(): Promise<TelegramEntry[]> {
    const all = await entries<string, CachedEntry>(IDB_STORE);
    return all
      .map(([id, entry]) => ({ id, ts: entry.ts, telegram: entry.telegram }))
      .sort((a, b) => b.ts - a.ts);
  }

  /** Deletes all entries whose timestamp is strictly before `minMs`. */
  async evictBefore(minMs: number): Promise<void> {
    const all = await entries<string, CachedEntry>(IDB_STORE);
    const stale = all.filter(([, entry]) => entry.ts < minMs).map(([id]) => id);
    if (stale.length > 0) await delMany(stale, IDB_STORE);
  }

  /**
   * Trims the cache to at most `maxCount` entries by deleting the oldest.
   * Returns the timestamp of the oldest surviving entry so the caller can trim
   * coverage accordingly, or `null` if no eviction was needed.
   */
  async evictToSize(maxCount: number): Promise<number | null> {
    const all = await entries<string, CachedEntry>(IDB_STORE);
    if (all.length <= maxCount) return null;
    all.sort((a, b) => a[1].ts - b[1].ts);
    const toEvict = all.slice(0, all.length - maxCount);
    await delMany(
      toEvict.map(([id]) => id),
      IDB_STORE,
    );
    // First surviving entry after eviction.
    return all[all.length - maxCount][1].ts;
  }

  /** Returns the total number of entries in the cache. */
  async count(): Promise<number> {
    const all = await entries(IDB_STORE);
    return all.length;
  }

  /** Wipes all entries from the cache. */
  async clear(): Promise<void> {
    await clear(IDB_STORE);
  }
}
