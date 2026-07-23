import { useState, useRef, useCallback, useEffect } from 'react';
import type { Telegram } from './useWebSocket';
import { apiUrl } from '../utils/basePath';
import { toEntry, type TelegramEntry } from '../utils/telegramId';
import { TelegramBufferService } from '../services/telegram-buffer-service';
import { TelegramCacheService, MAX_CACHE_SIZE } from '../services/telegram-cache-service';
import {
  TelegramCoverageService,
  loadCoverageIntervals,
  saveCoverageIntervals,
} from '../services/telegram-coverage-service';

/** How often the pending live batch is flushed to IndexedDB. */
const FLUSH_INTERVAL_MS = 2000;
/** Flush early once this many live telegrams are pending. */
const FLUSH_BATCH_SIZE = 200;
/** Cache size enforcement cadence (in flush ticks: 30 × 2 s = every minute). */
const EVICT_EVERY_TICKS = 30;
/**
 * Telegrams pulled in for the first paint on startup (#284). We hydrate only
 * the newest slice from cache and fetch at most this many from the backend,
 * newest-first; older history stays in IDB and is loaded on demand via the
 * history loader. Keeps startup cheap on low-power hosts (e.g. RasPi4) and the
 * buffer off its capacity ceiling, where eviction churn lives (#297).
 */
const INITIAL_LOAD_LIMIT = 5000;
/**
 * Rows fetched per backend request while filling a gap (#284). History loads
 * page backward in chunks of this size and paint after every chunk, so the list
 * and charts build progressively instead of blocking on one large fetch.
 */
const HISTORY_CHUNK_SIZE = 2000;

export interface TelegramCache {
  /** Current buffer contents, newest first. Frozen while paused. */
  telegrams: Telegram[];
  /** Ingest a live telegram from the WebSocket. */
  addLive: (t: Telegram) => void;
  /** Reflect the WS connection so offline windows become coverage gaps. */
  setConnected: (connected: boolean) => void;
  /** Freeze/unfreeze the published snapshot; ingestion continues while paused. */
  setPaused: (paused: boolean) => void;
  /** Telegrams ingested since the snapshot was frozen. */
  pausedCount: number;
  /** Load a time range: cache hits appear immediately, gaps fetch in background. */
  loadRange: (startMs: number, endMs: number) => Promise<void>;
  /** True while any backend history fetch is in flight (#222). */
  isLoading: boolean;
  /** Last background load failure, cleared by the next successful load. */
  loadError: string | null;
  /** Wipe buffer, persistent cache and coverage. */
  clear: () => Promise<void>;
}

interface FetchResult {
  entries: TelegramEntry[];
  limitReached: boolean;
}

/** Fetches a time range from the backend, newest first, unfiltered. */
async function fetchRange(startMs: number, endMs: number, limit: number): Promise<FetchResult> {
  const params = new URLSearchParams({
    limit: String(limit),
    start_time: new Date(startMs).toISOString(),
    end_time: new Date(endMs).toISOString(),
  });
  const res = await fetch(apiUrl(`/api/telegrams?${params}`));
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const data = await res.json();
  return {
    entries: ((data.telegrams || []) as Telegram[]).map(toEntry),
    limitReached: data.metadata?.limit_reached ?? false,
  };
}

/**
 * Composes the buffer, IndexedDB cache and coverage services (#246) into the
 * Group Monitor's telegram state:
 *
 * - On mount, cached telegrams paint immediately; only coverage gaps up to
 *   "now" are fetched from the backend, in the background (#211, #222).
 * - Live telegrams extend the open coverage interval and are flushed to
 *   IndexedDB in batches.
 * - Disconnect/close windows become gaps that are re-fetched on reconnect.
 *
 * The persistent cache is advisory: every IDB/backend failure degrades to
 * live-only behavior identical to the pre-cache app.
 *
 * `restoreFromCache` (default on) controls the startup restore only: when off,
 * the buffer starts empty and only live telegrams and explicit `loadRange`
 * calls (the history loader) populate it. Live telegrams are still flushed to
 * the cache, so re-enabling the setting restores them on the next reload.
 */
export function useTelegramCache(maxSize: number, restoreFromCache = true): TelegramCache {
  const bufferRef = useRef<TelegramBufferService | null>(null);
  bufferRef.current ??= new TelegramBufferService(maxSize);
  const cacheRef = useRef<TelegramCacheService | null>(null);
  cacheRef.current ??= new TelegramCacheService();
  const coverageRef = useRef<TelegramCoverageService | null>(null);
  coverageRef.current ??= new TelegramCoverageService();

  /** Ids currently in the buffer — O(1) dedup for the live path. */
  const idsRef = useRef<Set<string>>(new Set());
  /** Live telegrams awaiting the next IDB flush. */
  const pendingRef = useRef<TelegramEntry[]>([]);
  const connectedRef = useRef(false);
  const pausedRef = useRef(false);

  const [telegrams, setTelegrams] = useState<Telegram[]>([]);
  const [pausedCount, setPausedCount] = useState(0);
  const [activeLoads, setActiveLoads] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Publishes the buffer as a newest-first snapshot unless frozen by pause. */
  const publish = useCallback(() => {
    if (pausedRef.current) return;
    setTelegrams(bufferRef.current!.snapshot.map(e => e.telegram).reverse());
  }, []);

  const trackRemoved = useCallback((removed: TelegramEntry[]) => {
    for (const e of removed) idsRef.current.delete(e.id);
  }, []);

  /** Merges entries into the buffer; returns whether anything changed. */
  const mergeIntoBuffer = useCallback(
    (entries: TelegramEntry[]): boolean => {
      const { added, removed } = bufferRef.current!.merge(entries);
      for (const e of added) idsRef.current.add(e.id);
      trackRemoved(removed);
      return added.length > 0 || removed.length > 0;
    },
    [trackRemoved],
  );

  const saveCoverage = useCallback(() => {
    saveCoverageIntervals(coverageRef.current!.covered);
  }, []);

  /**
   * Progressively fills one uncovered sub-range, newest-first, publishing after
   * every chunk so the UI builds as data streams in (#284). Pages backward in
   * `HISTORY_CHUNK_SIZE` requests until the gap is exhausted or `budget` rows
   * have been fetched; a budget cut-off leaves the older remainder uncovered for
   * a later load. Returns how many telegrams were fetched (for cross-gap budgeting).
   */
  const fetchGapProgressive = useCallback(
    async (gapStart: number, gapEnd: number, budget: number): Promise<number> => {
      let cursor = gapEnd;
      let fetched = 0;
      while (cursor >= gapStart && fetched < budget) {
        const limit = Math.min(HISTORY_CHUNK_SIZE, budget - fetched);
        const { entries, limitReached } = await fetchRange(gapStart, cursor, limit);
        if (entries.length === 0) {
          // Nothing left in this window — the rest is covered-but-empty.
          coverageRef.current!.addCovered(gapStart, cursor);
          break;
        }
        if (mergeIntoBuffer(entries)) publish();
        cacheRef.current!.store(entries).catch(() => {});
        fetched += entries.length;
        const oldestTs = entries[entries.length - 1].ts;
        coverageRef.current!.addCovered(oldestTs, cursor);
        if (!limitReached) {
          // The whole remaining window came back — the gap is fully covered.
          coverageRef.current!.addCovered(gapStart, cursor);
          break;
        }
        // Page further back. Re-including `oldestTs` (dedup handles the repeat)
        // avoids dropping siblings that share that millisecond; step past it only
        // when a whole chunk sat on one timestamp, to guarantee progress.
        cursor = oldestTs < cursor ? oldestTs : cursor - 1;
      }
      return fetched;
    },
    [mergeIntoBuffer, publish],
  );

  /**
   * Fills the uncovered sub-ranges of [startMs, endMs] newest-first, chunk by
   * chunk, up to `budget` telegrams total. Older gaps (and the remainder of the
   * gap where the budget runs out) stay uncovered for on-demand loading, so a
   * load never blocks on more history than asked for (#284).
   */
  const fillGapsBudgeted = useCallback(
    async (startMs: number, endMs: number, budget: number) => {
      const gaps = coverageRef.current!.gaps(startMs, endMs);
      let remaining = budget;
      for (let i = gaps.length - 1; i >= 0 && remaining > 0; i--) {
        remaining -= await fetchGapProgressive(gaps[i][0], gaps[i][1], remaining);
      }
      saveCoverage();
    },
    [fetchGapProgressive, saveCoverage],
  );

  /** Fills every uncovered sub-range of [startMs, endMs], bounded by the buffer size. */
  const fillGaps = useCallback(
    (startMs: number, endMs: number) => fillGapsBudgeted(startMs, endMs, maxSize),
    [fillGapsBudgeted, maxSize],
  );

  /** Wraps a background load with the shared loading/error state. */
  const runLoad = useCallback(
    async (work: () => Promise<void>) => {
      setActiveLoads(n => n + 1);
      try {
        await work();
        setLoadError(null);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'History load failed');
      } finally {
        setActiveLoads(n => n - 1);
      }
    },
    [],
  );

  const loadRange = useCallback(
    (startMs: number, endMs: number) =>
      runLoad(async () => {
        // Cache hits paint immediately; the backend only fills the gaps.
        const cached = await cacheRef.current!.loadRange(startMs, endMs).catch(() => []);
        if (cached.length > 0 && mergeIntoBuffer(cached)) publish();
        await fillGaps(startMs, endMs);
      }),
    [runLoad, mergeIntoBuffer, publish, fillGaps],
  );

  // ── Startup: restore cache + coverage, then fill gaps up to now ─────────────
  useEffect(() => {
    // When restore is disabled the view starts empty; only live telegrams and
    // manual history loads populate it (the setting is read once, at mount).
    if (!restoreFromCache) return;
    let cancelled = false;
    void runLoad(async () => {
      const coverage = coverageRef.current!;
      for (const [s, e] of loadCoverageIntervals()) coverage.addCovered(s, e);

      // Clamp everything to the backend's retention window when known.
      try {
        const res = await fetch(apiUrl('/api/database/info'));
        const info = await res.json();
        if (info.retention_days != null) {
          const minMs = Date.now() - (info.retention_days + 1) * 86_400_000;
          coverage.trim(minMs);
          cacheRef.current!.evictBefore(minMs).catch(() => {});
        }
      } catch {
        // Retention unknown — keep coverage as persisted.
      }
      if (cancelled) return;

      const cached = await cacheRef.current!.loadAll().catch(() => [] as TelegramEntry[]);
      if (cancelled) return;
      // Hydrate only the newest slice for a fast first paint; the older cached
      // remainder stays in IDB and is pulled in on demand via the history
      // loader / lazy loads (#284). Never exceed the configured buffer size.
      const budget = Math.min(INITIAL_LOAD_LIMIT, maxSize);
      const initialCached = cached.slice(0, budget);
      if (initialCached.length > 0 && mergeIntoBuffer(initialCached)) publish();

      // Fill the most recent gaps up to the budget (#211): the dashboard-switch
      // / closed-tab window arrives without user action, but older history is
      // deferred so startup stays cheap on low-power hosts.
      const coveredStart = coverage.covered[0]?.[0];
      const oldestCached = cached.length > 0 ? cached[cached.length - 1].ts : undefined;
      const start = Math.min(coveredStart ?? Infinity, oldestCached ?? Infinity);
      if (Number.isFinite(start)) {
        await fillGapsBudgeted(start, Date.now(), budget);
      }
    });
    return () => {
      cancelled = true;
    };
    // Startup restore runs exactly once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Periodic flush: IDB batch, coverage save, size eviction ─────────────────
  useEffect(() => {
    let ticks = 0;

    const flush = () => {
      const pending = pendingRef.current;
      if (pending.length > 0) {
        pendingRef.current = [];
        cacheRef.current!.store(pending).catch(() => {});
      }
      // A quiet-but-connected stream still covers the elapsed time.
      if (connectedRef.current) coverageRef.current!.extendLive(Date.now());
      saveCoverage();
    };

    const interval = setInterval(() => {
      flush();
      if (++ticks % EVICT_EVERY_TICKS === 0) {
        void cacheRef.current!
          .evictToSize(MAX_CACHE_SIZE)
          .then(oldestSurviving => {
            if (oldestSurviving !== null) {
              coverageRef.current!.trim(oldestSurviving);
              saveCoverage();
            }
          })
          .catch(() => {});
      }
    }, FLUSH_INTERVAL_MS);

    window.addEventListener('pagehide', flush);
    return () => {
      clearInterval(interval);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [saveCoverage]);

  // Shrink/grow the buffer when the configured load limit changes.
  useEffect(() => {
    const removed = bufferRef.current!.setMaxSize(maxSize);
    if (removed.length > 0) {
      trackRemoved(removed);
      publish();
    }
  }, [maxSize, trackRemoved, publish]);

  const addLive = useCallback(
    (t: Telegram) => {
      const entry = toEntry(t);
      // A gap fetch racing the live stream may already have delivered this row.
      if (idsRef.current.has(entry.id)) return;
      trackRemoved(bufferRef.current!.add(entry));
      idsRef.current.add(entry.id);
      coverageRef.current!.extendLive(entry.ts);
      pendingRef.current.push(entry);
      if (pendingRef.current.length >= FLUSH_BATCH_SIZE) {
        const batch = pendingRef.current;
        pendingRef.current = [];
        cacheRef.current!.store(batch).catch(() => {});
      }
      if (pausedRef.current) setPausedCount(c => c + 1);
      else publish();
    },
    [trackRemoved, publish],
  );

  const setConnected = useCallback(
    (connected: boolean) => {
      if (connectedRef.current === connected) return;
      connectedRef.current = connected;
      const coverage = coverageRef.current!;
      if (connected) {
        // Anchor the live interval at the (re)connect instant and pull in
        // whatever happened while the stream was down.
        const now = Date.now();
        coverage.extendLive(now);
        const coveredStart = coverage.covered[0]?.[0];
        if (coveredStart !== undefined) void runLoad(() => fillGaps(coveredStart, now));
      } else {
        // Everything up to this instant was seen; afterwards is a gap.
        coverage.extendLive(Date.now());
        coverage.closeLive();
        saveCoverage();
      }
    },
    [runLoad, fillGaps, saveCoverage],
  );

  const setPaused = useCallback(
    (paused: boolean) => {
      pausedRef.current = paused;
      setPausedCount(0);
      // Resuming reveals everything ingested while frozen.
      if (!paused) publish();
    },
    [publish],
  );

  const clear = useCallback(async () => {
    trackRemoved(bufferRef.current!.clear());
    pendingRef.current = [];
    coverageRef.current!.clear();
    saveCoverage();
    setTelegrams([]);
    await cacheRef.current!.clear().catch(() => {});
  }, [trackRemoved, saveCoverage]);

  return {
    telegrams,
    addLive,
    setConnected,
    setPaused,
    pausedCount,
    loadRange,
    isLoading: activeLoads > 0,
    loadError,
    clear,
  };
}
