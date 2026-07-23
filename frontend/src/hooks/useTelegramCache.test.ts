import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTelegramCache } from './useTelegramCache';
import { makeTelegram } from '../test/telegramFactory';
import { toEntry } from '../utils/telegramId';
import { COVERAGE_STORAGE_KEY } from '../services/telegram-coverage-service';
import type { Telegram } from './useWebSocket';

// In-memory IDB stand-in shared with the cache service.
const _idb = new Map<string, { ts: number; telegram: Telegram }>();
// Flip on to make cache writes reject (simulates IndexedDB quota failures).
let storeShouldFail = false;

vi.mock('idb-keyval', () => ({
  createStore: () => 'mock-store',
  setMany: async (pairs: [string, { ts: number; telegram: Telegram }][]) => {
    if (storeShouldFail) throw new Error('QuotaExceededError');
    for (const [k, v] of pairs) _idb.set(k, v);
  },
  entries: async () => Array.from(_idb.entries()),
  delMany: async (keys: string[]) => {
    for (const k of keys) _idb.delete(k);
  },
  clear: async () => _idb.clear(),
}));

/** Telegram with a distinct identity at the given epoch-ms timestamp. */
const tg = (ts: number, key = String(ts)): Telegram =>
  makeTelegram({
    timestamp: new Date(ts).toISOString(),
    source_address: `1.2.${key}`,
  });

const seedIdb = (telegrams: Telegram[]) => {
  for (const t of telegrams) {
    const e = toEntry(t);
    _idb.set(e.id, { ts: e.ts, telegram: e.telegram });
  }
};

interface MockResponse {
  telegrams: Telegram[];
  limitReached?: boolean;
}

let telegramResponses: MockResponse[];
let fetchCalls: string[];

const jsonRes = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;

beforeEach(() => {
  _idb.clear();
  storeShouldFail = false;
  localStorage.clear();
  telegramResponses = [];
  fetchCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      fetchCalls.push(u);
      if (u.includes('/api/database/info')) {
        return jsonRes({ retention_days: null });
      }
      const next = telegramResponses.shift() ?? { telegrams: [] };
      return jsonRes({
        telegrams: next.telegrams,
        metadata: { limit_reached: next.limitReached ?? false },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Waits for the startup restore + gap fill to settle. */
const settle = async (result: { current: { isLoading: boolean } }) => {
  await waitFor(() => expect(result.current.isLoading).toBe(false));
};

describe('useTelegramCache', () => {
  it('starts empty and fetches nothing without prior coverage or cache', async () => {
    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    expect(result.current.telegrams).toEqual([]);
    expect(fetchCalls.filter(u => u.includes('/api/telegrams'))).toEqual([]);
  });

  it('paints cached telegrams on startup and fetches only the gap up to now', async () => {
    const t1 = tg(1000, 'a');
    const t2 = tg(2000, 'b');
    seedIdb([t1, t2]);
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[1000, 2000]]));
    const gapTelegram = tg(5000, 'c');
    telegramResponses.push({ telegrams: [gapTelegram] });

    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    // Newest first: gap fill result, then the cached entries.
    expect(result.current.telegrams.map(t => t.source_address)).toEqual([
      '1.2.c',
      '1.2.b',
      '1.2.a',
    ]);

    const gapCall = fetchCalls.find(u => u.includes('/api/telegrams'));
    expect(gapCall).toBeDefined();
    // The covered range [1000, 2000] is not re-fetched: the gap starts after it.
    const params = new URLSearchParams(gapCall!.split('?')[1]);
    expect(Date.parse(params.get('start_time')!)).toBe(2001);
  });

  it('skips the startup restore when restoreFromCache is off, keeping live and manual loads', async () => {
    seedIdb([tg(1000, 'a'), tg(2000, 'b')]);
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[1000, 2000]]));

    const { result } = renderHook(() => useTelegramCache(1000, false));
    await settle(result);

    // Nothing restored and nothing fetched from the backend on startup.
    expect(result.current.telegrams).toEqual([]);
    expect(fetchCalls.filter(u => u.includes('/api/telegrams'))).toEqual([]);

    // Live telegrams still flow into the view.
    act(() => {
      result.current.addLive(tg(3000, 'live'));
    });
    expect(result.current.telegrams.map(t => t.source_address)).toEqual(['1.2.live']);

    // A manual history load still serves cache hits.
    await act(async () => {
      await result.current.loadRange(1000, 2000);
    });
    expect(result.current.telegrams.map(t => t.source_address)).toEqual([
      '1.2.live',
      '1.2.b',
      '1.2.a',
    ]);
  });

  it('hydrates only the newest slice of a large cache on startup, keeping the rest loadable (#284)', async () => {
    // Seed more than the 5000 initial-load budget, all already covered so no
    // gap fetch masks the cap.
    const count = 5100;
    seedIdb(Array.from({ length: count }, (_, i) => tg(i + 1, `c${i + 1}`)));
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[1, count]]));
    telegramResponses.push({ telegrams: [] }); // trailing [covered…now] gap is empty

    const { result } = renderHook(() => useTelegramCache(100_000));
    await settle(result);

    // Only the newest 5000 paint; the older remainder stays in IDB untouched.
    expect(result.current.telegrams).toHaveLength(5000);
    expect(result.current.telegrams[0].source_address).toBe(`1.2.c${count}`);
    expect(_idb.size).toBe(count);

    // The older cached rows are still reachable on demand, from cache alone.
    const before = fetchCalls.filter(u => u.includes('/api/telegrams')).length;
    await act(async () => {
      await result.current.loadRange(1, 100);
    });
    expect(result.current.telegrams).toHaveLength(count);
    expect(fetchCalls.filter(u => u.includes('/api/telegrams')).length).toBe(before);
  });

  it('publishes live telegrams newest first', async () => {
    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    act(() => {
      result.current.addLive(tg(1000, 'a'));
      result.current.addLive(tg(2000, 'b'));
    });

    expect(result.current.telegrams.map(t => t.source_address)).toEqual(['1.2.b', '1.2.a']);
  });

  it('deduplicates a live telegram already delivered by a fetch', async () => {
    const dup = tg(5000, 'dup');
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[1000, 1000]]));
    telegramResponses.push({ telegrams: [dup] });

    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);
    expect(result.current.telegrams).toHaveLength(1);

    act(() => {
      result.current.addLive(dup);
    });
    expect(result.current.telegrams).toHaveLength(1);
  });

  it('freezes the snapshot while paused and reveals everything on resume', async () => {
    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    act(() => {
      result.current.addLive(tg(1000, 'a'));
    });
    act(() => {
      result.current.setPaused(true);
    });
    act(() => {
      result.current.addLive(tg(2000, 'b'));
      result.current.addLive(tg(3000, 'c'));
    });

    // Snapshot frozen, but ingestion keeps counting.
    expect(result.current.telegrams).toHaveLength(1);
    expect(result.current.pausedCount).toBe(2);

    act(() => {
      result.current.setPaused(false);
    });
    expect(result.current.telegrams).toHaveLength(3);
    expect(result.current.pausedCount).toBe(0);
  });

  it('loadRange serves cache hits and fetches only the gaps', async () => {
    const cached = tg(1500, 'cached');
    seedIdb([cached]);
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[1000, 2000]]));
    // Startup gap [2001, now], then the explicit load's gap [0, 999].
    telegramResponses.push({ telegrams: [] });
    telegramResponses.push({ telegrams: [tg(500, 'older')] });

    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    await act(async () => {
      await result.current.loadRange(0, 2000);
    });

    expect(result.current.telegrams.map(t => t.source_address)).toEqual([
      '1.2.cached',
      '1.2.older',
    ]);
    const loadCall = fetchCalls.filter(u => u.includes('/api/telegrams')).at(-1)!;
    const params = new URLSearchParams(loadCall.split('?')[1]);
    expect(Date.parse(params.get('start_time')!)).toBe(0);
    expect(Date.parse(params.get('end_time')!)).toBe(999);
  });

  it('loads a gap in newest-first chunks, painting after each (#284)', async () => {
    // Coverage forces a single gap [0, 6000]; the backend serves it in two chunks.
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[6001, 6001]]));
    telegramResponses.push({ telegrams: [] }); // startup gap [6002, now]
    telegramResponses.push({ telegrams: [tg(5000, 'a'), tg(4000, 'b')], limitReached: true }); // chunk 1 (newest)
    telegramResponses.push({ telegrams: [tg(3000, 'c'), tg(2000, 'd')] }); // chunk 2 (older, final)

    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    const before = fetchCalls.filter(u => u.includes('/api/telegrams')).length;
    await act(async () => {
      await result.current.loadRange(0, 6000);
    });
    const loadFetches = fetchCalls.filter(u => u.includes('/api/telegrams')).length - before;

    // Two chunk requests, all four telegrams merged newest-first.
    expect(loadFetches).toBe(2);
    expect(result.current.telegrams.map(t => t.source_address)).toEqual([
      '1.2.a', '1.2.b', '1.2.c', '1.2.d',
    ]);
    // The second chunk paged back to just the older remainder (up to chunk 1's oldest ts).
    const chunk2 = fetchCalls.filter(u => u.includes('/api/telegrams')).at(-1)!;
    const chunk2Params = new URLSearchParams(chunk2.split('?')[1]);
    expect(Date.parse(chunk2Params.get('end_time')!)).toBe(4000);
  });

  it('stops at the load budget and leaves the older remainder uncovered (#284)', async () => {
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[10_000, 10_000]]));
    telegramResponses.push({ telegrams: [] }); // startup gap fill

    // Buffer size 1 → the load budget is a single telegram: the first chunk
    // exhausts it and paging stops, deferring the rest.
    const { result } = renderHook(() => useTelegramCache(1));
    await settle(result);

    telegramResponses.push({ telegrams: [tg(9000, 'partial')], limitReached: true });
    await act(async () => {
      await result.current.loadRange(0, 10_000);
    });

    const saved = JSON.parse(localStorage.getItem(COVERAGE_STORAGE_KEY)!) as [number, number][];
    // [0, 8999] must remain a gap; coverage starts at the oldest returned row.
    expect(saved.some(([s]) => s === 9000)).toBe(true);
    expect(saved.some(([s]) => s === 0)).toBe(false);
  });

  it('stops backing off older history once the buffer is full (#313)', async () => {
    // Buffer size 2, filled with the two newest (live) telegrams.
    const { result } = renderHook(() => useTelegramCache(2));
    await settle(result);
    act(() => {
      result.current.addLive(tg(8000, 'live1'));
      result.current.addLive(tg(9000, 'live2'));
    });
    expect(result.current.telegrams.map(t => t.source_address)).toEqual(['1.2.live2', '1.2.live1']);

    // Requesting older history: every fetched row would be older than the
    // buffer's oldest entry and evicted on arrival, so no backend request is made.
    const before = fetchCalls.filter(u => u.includes('/api/telegrams')).length;
    await act(async () => {
      await result.current.loadRange(1000, 5000);
    });
    const loadFetches = fetchCalls.filter(u => u.includes('/api/telegrams')).length - before;

    expect(loadFetches).toBe(0);
    expect(result.current.telegrams.map(t => t.source_address)).toEqual(['1.2.live2', '1.2.live1']);
  });

  it('does not mark a range covered when the cache write fails (#317)', async () => {
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[10_000, 10_000]]));
    telegramResponses.push({ telegrams: [] }); // startup gap fill
    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    // The load fetches a row, but persisting it to the cache fails.
    storeShouldFail = true;
    telegramResponses.push({ telegrams: [tg(5000, 'x')] });
    await act(async () => {
      await result.current.loadRange(0, 6000);
    });

    // The row is painted, but coverage must not claim its range — otherwise a
    // reload would trust coverage and never refetch the (uncached) row.
    expect(result.current.telegrams.map(t => t.source_address)).toContain('1.2.x');
    const saved = JSON.parse(localStorage.getItem(COVERAGE_STORAGE_KEY)!) as [number, number][];
    expect(saved.some(([s, e]) => s <= 5000 && 5000 <= e)).toBe(false);
  });

  it('records a load failure without breaking the buffer', async () => {
    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    act(() => {
      result.current.addLive(tg(1000, 'a'));
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as Response));

    await act(async () => {
      await result.current.loadRange(0, 500);
    });

    expect(result.current.loadError).toContain('500');
    expect(result.current.telegrams).toHaveLength(1);
  });

  it('clear wipes buffer, persistent cache and coverage', async () => {
    seedIdb([tg(1000, 'a')]);
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[1000, 1000]]));
    telegramResponses.push({ telegrams: [] });

    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);
    expect(result.current.telegrams).toHaveLength(1);

    await act(async () => {
      await result.current.clear();
    });

    expect(result.current.telegrams).toEqual([]);
    expect(_idb.size).toBe(0);
    expect(JSON.parse(localStorage.getItem(COVERAGE_STORAGE_KEY)!)).toEqual([]);
  });

  it('evicts the oldest telegrams when shrinking the buffer limit', async () => {
    const { result, rerender } = renderHook(({ limit }) => useTelegramCache(limit), {
      initialProps: { limit: 3 },
    });
    await settle(result);

    act(() => {
      result.current.addLive(tg(1000, 'a'));
      result.current.addLive(tg(2000, 'b'));
      result.current.addLive(tg(3000, 'c'));
    });
    expect(result.current.telegrams).toHaveLength(3);

    rerender({ limit: 2 });
    expect(result.current.telegrams.map(t => t.source_address)).toEqual(['1.2.c', '1.2.b']);
  });
});
