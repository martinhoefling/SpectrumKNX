import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelegramCacheService, MAX_CACHE_SIZE } from './telegram-cache-service';
import { makeTelegram } from '../test/telegramFactory';
import type { TelegramEntry } from '../utils/telegramId';

// In-memory IDB stand-in: Map<key, value> per custom store.
const _store = new Map<string, unknown>();

vi.mock('idb-keyval', () => ({
  createStore: () => 'mock-store',
  setMany: async (pairs: [string, unknown][]) => {
    for (const [k, v] of pairs) _store.set(k, v);
  },
  entries: async () => Array.from(_store.entries()),
  delMany: async (keys: string[]) => {
    for (const k of keys) _store.delete(k);
  },
  clear: async () => _store.clear(),
}));

const entry = (id: string, ts: number): TelegramEntry => ({
  id,
  ts,
  telegram: makeTelegram({ timestamp: new Date(ts).toISOString() }),
});

describe('TelegramCacheService', () => {
  let svc: TelegramCacheService;

  beforeEach(() => {
    _store.clear();
    svc = new TelegramCacheService();
  });

  describe('store / loadAll', () => {
    it('stores a single entry and loads it back', async () => {
      await svc.store([entry('id-a', 1000)]);
      const loaded = await svc.loadAll();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe('id-a');
      expect(loaded[0].ts).toBe(1000);
      expect(loaded[0].telegram.source_address).toBe('1.2.3');
    });

    it('stores a batch and returns all entries', async () => {
      await svc.store([entry('a', 100), entry('b', 200), entry('c', 300)]);
      expect(await svc.loadAll()).toHaveLength(3);
    });

    it('returns entries sorted newest-first', async () => {
      await svc.store([entry('a', 100), entry('b', 300), entry('c', 200)]);
      const loaded = await svc.loadAll();
      expect(loaded.map(e => e.ts)).toEqual([300, 200, 100]);
    });

    it('overwrites an existing entry with the same key (idempotent)', async () => {
      await svc.store([entry('id-a', 100)]);
      await svc.store([entry('id-a', 200)]);
      const loaded = await svc.loadAll();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].ts).toBe(200);
    });

    it('returns empty array when cache is empty', async () => {
      expect(await svc.loadAll()).toEqual([]);
    });

    it('ignores empty batches', async () => {
      await svc.store([]);
      expect(await svc.count()).toBe(0);
    });
  });

  describe('evictBefore', () => {
    it('removes entries strictly before minMs', async () => {
      await svc.store([entry('a', 100), entry('b', 200), entry('c', 300)]);
      await svc.evictBefore(200);
      const loaded = await svc.loadAll();
      expect(loaded.map(e => e.id).sort()).toEqual(['b', 'c']);
    });

    it('keeps entries at exactly minMs', async () => {
      await svc.store([entry('a', 200)]);
      await svc.evictBefore(200);
      expect(await svc.count()).toBe(1);
    });

    it('is a no-op when all entries are newer', async () => {
      await svc.store([entry('a', 500)]);
      await svc.evictBefore(200);
      expect(await svc.count()).toBe(1);
    });
  });

  describe('evictToSize', () => {
    it('trims oldest entries when over maxCount', async () => {
      await svc.store([
        entry('a', 100),
        entry('b', 200),
        entry('c', 300),
        entry('d', 400),
        entry('e', 500),
      ]);
      await svc.evictToSize(3);
      const loaded = await svc.loadAll();
      expect(loaded).toHaveLength(3);
      expect(loaded.map(e => e.id).sort()).toEqual(['c', 'd', 'e']);
    });

    it('returns the oldest surviving timestamp when eviction occurs', async () => {
      await svc.store([entry('a', 100), entry('b', 200), entry('c', 300)]);
      const oldest = await svc.evictToSize(2);
      expect(oldest).toBe(200); // entry "b" is now the oldest surviving
    });

    it('returns null when at or below maxCount', async () => {
      await svc.store([entry('a', 100)]);
      const result = await svc.evictToSize(3);
      expect(result).toBeNull();
      expect(await svc.count()).toBe(1);
    });
  });

  describe('loadRange', () => {
    it('returns only entries within [startMs, endMs]', async () => {
      await svc.store([entry('a', 100), entry('b', 200), entry('c', 300), entry('d', 400)]);
      const result = await svc.loadRange(200, 300);
      expect(result.map(e => e.id).sort()).toEqual(['b', 'c']);
    });

    it('returns entries sorted newest first', async () => {
      await svc.store([entry('a', 100), entry('b', 200), entry('c', 300)]);
      const result = await svc.loadRange(100, 300);
      expect(result.map(e => e.ts)).toEqual([300, 200, 100]);
    });

    it('returns empty array when no entries match the range', async () => {
      await svc.store([entry('a', 100)]);
      expect(await svc.loadRange(500, 1000)).toEqual([]);
    });
  });

  describe('count / clear', () => {
    it('counts entries', async () => {
      expect(await svc.count()).toBe(0);
      await svc.store([entry('a', 100), entry('b', 200)]);
      expect(await svc.count()).toBe(2);
    });

    it('clear removes all entries', async () => {
      await svc.store([entry('a', 100), entry('b', 200)]);
      await svc.clear();
      expect(await svc.count()).toBe(0);
    });
  });

  it('exports the expected cache cap', () => {
    expect(MAX_CACHE_SIZE).toBe(100_000);
  });
});
