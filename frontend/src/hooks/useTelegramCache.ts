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
 */
export function useTelegramCache(maxSize: number): TelegramCache {
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

  /** Fetches every uncovered sub-range of [startMs, endMs] from the backend. */
  const fillGaps = useCallback(
    async (startMs: number, endMs: number) => {
      const coverage = coverageRef.current!;
      for (const [gapStart, gapEnd] of coverage.gaps(startMs, endMs)) {
        const { entries, limitReached } = await fetchRange(gapStart, gapEnd, maxSize);
        if (mergeIntoBuffer(entries)) publish();
        cacheRef.current!.store(entries).catch(() => {});
        if (limitReached && entries.length > 0) {
          // Only the newest `limit` rows arrived — the older remainder of the
          // gap stays uncovered so a later load can still fetch it.
          const oldestTs = entries[entries.length - 1].ts;
          coverage.addCovered(oldestTs, gapEnd);
        } else {
          coverage.addCovered(gapStart, gapEnd);
        }
      }
      saveCoverage();
    },
    [maxSize, mergeIntoBuffer, publish, saveCoverage],
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
    let cancelled = false;
    void runLoad(async () => {
      const coverage = coverageRef.current!;
      for (const [s, e] of loadCoverageIntervals()) coverage.addCovered(s, e);

      // Clamp everything to the backend's retention window when known.
      try {
        const res = await fetch(apiUrl('/api/database'));
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
      if (cached.length > 0 && mergeIntoBuffer(cached)) publish();

      // Fill everything between the oldest known data and now (#211): the
      // dashboard-switch / closed-tab window arrives without user action.
      const coveredStart = coverage.covered[0]?.[0];
      const oldestCached = cached.length > 0 ? cached[cached.length - 1].ts : undefined;
      const start = Math.min(coveredStart ?? Infinity, oldestCached ?? Infinity);
      if (Number.isFinite(start)) {
        await fillGaps(start, Date.now());
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
