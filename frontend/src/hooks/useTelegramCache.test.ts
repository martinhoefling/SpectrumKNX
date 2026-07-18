import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTelegramCache } from './useTelegramCache';
import { makeTelegram } from '../test/telegramFactory';
import { toEntry } from '../utils/telegramId';
import { COVERAGE_STORAGE_KEY } from '../services/telegram-coverage-service';
import type { Telegram } from './useWebSocket';

// In-memory IDB stand-in shared with the cache service.
const _idb = new Map<string, { ts: number; telegram: Telegram }>();

vi.mock('idb-keyval', () => ({
  createStore: () => 'mock-store',
  setMany: async (pairs: [string, { ts: number; telegram: Telegram }][]) => {
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
  localStorage.clear();
  telegramResponses = [];
  fetchCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      fetchCalls.push(u);
      if (u.includes('/api/database')) {
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

  it('keeps the unfetched remainder uncovered when the limit is reached', async () => {
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[10_000, 10_000]]));
    telegramResponses.push({ telegrams: [] }); // startup gap fill

    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    // Only the newest row of [0, 9999] arrives.
    telegramResponses.push({ telegrams: [tg(9000, 'partial')], limitReached: true });
    await act(async () => {
      await result.current.loadRange(0, 10_000);
    });

    const saved = JSON.parse(localStorage.getItem(COVERAGE_STORAGE_KEY)!) as [number, number][];
    // [0, 8999] must remain a gap; coverage starts at the oldest returned row.
    expect(saved.some(([s]) => s === 9000)).toBe(true);
    expect(saved.some(([s]) => s === 0)).toBe(false);
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
