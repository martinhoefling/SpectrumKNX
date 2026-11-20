import type { Telegram } from '../hooks/useWebSocket';

/**
 * Filter-aware pause-backlog count. The backlog array is newest-first and is
 * mutated in place (stable identity). A full pass runs only when `epoch` or
 * the array identity changes; each arrival classifies just the new rows.
 */
export interface PausedVisState {
  epoch: unknown;
  backlog: readonly Telegram[] | null;
  pausedCount: number;
  len: number;
  flags: boolean[];
  count: number;
  /** Anchor timestamps (ms), ascending. */
  anchors: number[];
}

export function createPausedVisState(): PausedVisState {
  return {
    epoch: null,
    backlog: null,
    pausedCount: 0,
    len: 0,
    flags: [],
    count: 0,
    anchors: [],
  };
}

export interface PausedVisArgs {
  epoch: unknown;
  /** Newest-first pause backlog. Same reference across arrivals. */
  backlog: readonly Telegram[];
  pausedCount: number;
  beforeMs: number;
  afterMs: number;
  /** Window anchor (primary match or flagged). Ignored when the window is 0. */
  isAnchor: (t: Telegram) => boolean;
  /** Whether this backlog row is currently shown. */
  keep: (t: Telegram, anchors: readonly number[]) => boolean;
  /** Anchor timestamps from the published list plus `backlog`. Unsorted ok. */
  collectAnchors: (backlog: readonly Telegram[]) => number[];
}

export function syncPausedVisibility(state: PausedVisState, args: PausedVisArgs): number {
  if (state.epoch !== args.epoch || state.backlog !== args.backlog) {
    rebuild(state, args);
    return state.count;
  }
  // First row of a pause session: published anchors may have moved on while the
  // backlog was empty. One pass here, then each further arrival is incremental.
  if (state.len === 0 && args.backlog.length > 0) {
    rebuild(state, args);
    return state.count;
  }
  if (args.pausedCount === state.pausedCount && args.backlog.length === state.len) {
    return state.count;
  }
  if (args.pausedCount > state.pausedCount) applyAdded(state, args);
  else applyRemoved(state, args);
  return state.count;
}

/** True when `t` falls inside any anchor window. Anchors must be sorted ascending. */
export function coveredByAnchors(
  anchors: readonly number[],
  t: number,
  beforeMs: number,
  afterMs: number,
): boolean {
  if (anchors.length === 0 || (beforeMs <= 0 && afterMs <= 0)) return false;
  const i = lowerBound(anchors, t - afterMs);
  return i < anchors.length && anchors[i] <= t + beforeMs;
}

function rebuild(state: PausedVisState, args: PausedVisArgs): void {
  const anchors = args.collectAnchors(args.backlog);
  anchors.sort((a, b) => a - b);
  const flags = new Array<boolean>(args.backlog.length);
  let count = 0;
  for (let i = 0; i < args.backlog.length; i++) {
    const vis = args.keep(args.backlog[i], anchors);
    flags[i] = vis;
    if (vis) count++;
  }
  state.anchors = anchors;
  state.flags = flags;
  state.count = count;
  state.len = args.backlog.length;
  state.pausedCount = args.pausedCount;
  state.backlog = args.backlog;
  state.epoch = args.epoch;
}

function applyAdded(state: PausedVisState, args: PausedVisArgs): void {
  const { backlog, pausedCount, beforeMs, afterMs } = args;
  const newLen = backlog.length;
  const oldLen = state.len;
  const added = pausedCount - state.pausedCount;
  const removedOld = Math.min(oldLen, Math.max(0, oldLen + added - newLen));
  const keptOld = oldLen - removedOld;
  const newOnes = newLen - keptOld;

  for (let i = keptOld; i < state.flags.length; i++) {
    if (state.flags[i]) state.count--;
  }
  const oldFlags = state.flags.slice(0, keptOld);
  const newFlags = new Array<boolean>(newOnes);

  const windowOn = beforeMs > 0 || afterMs > 0;
  if (windowOn) {
    for (let i = newOnes - 1; i >= 0; i--) {
      if (args.isAnchor(backlog[i])) insertAnchor(state.anchors, timeMs(backlog[i].timestamp));
    }
  }
  for (let i = 0; i < newOnes; i++) {
    const vis = args.keep(backlog[i], state.anchors);
    newFlags[i] = vis;
    if (vis) state.count++;
  }
  state.flags = newFlags.concat(oldFlags);
  state.len = newLen;
  state.pausedCount = pausedCount;

  if (windowOn) {
    for (let i = 0; i < newOnes; i++) {
      if (args.isAnchor(backlog[i])) {
        promoteInWindow(state, backlog, timeMs(backlog[i].timestamp), beforeMs, afterMs, args.keep);
      }
    }
  }
}

function applyRemoved(state: PausedVisState, args: PausedVisArgs): void {
  const keepN = args.backlog.length;
  for (let i = keepN; i < state.flags.length; i++) {
    if (state.flags[i]) state.count--;
  }
  state.flags.length = keepN;
  state.len = keepN;
  state.pausedCount = args.pausedCount;
}

function promoteInWindow(
  state: PausedVisState,
  backlog: readonly Telegram[],
  anchorTs: number,
  beforeMs: number,
  afterMs: number,
  keep: (t: Telegram, anchors: readonly number[]) => boolean,
): void {
  const lo = anchorTs - beforeMs;
  const hi = anchorTs + afterMs;
  const visit = (i: number) => {
    if (state.flags[i]) return;
    if (keep(backlog[i], state.anchors)) {
      state.flags[i] = true;
      state.count++;
    }
  };
  if (!isNewestFirst(backlog)) {
    for (let i = 0; i < backlog.length; i++) {
      const ts = timeMs(backlog[i].timestamp);
      if (ts >= lo && ts <= hi) visit(i);
    }
    return;
  }
  const start = firstIndexTsLE(backlog, hi);
  const end = firstIndexTsLT(backlog, lo);
  for (let i = start; i < end; i++) visit(i);
}

function timeMs(timestamp: string): number {
  return new Date(timestamp).getTime();
}

function isNewestFirst(backlog: readonly Telegram[]): boolean {
  if (backlog.length < 2) return true;
  return timeMs(backlog[0].timestamp) >= timeMs(backlog[backlog.length - 1].timestamp);
}

/** First index whose timestamp is `<= tsMax` in a newest-first list. */
function firstIndexTsLE(backlog: readonly Telegram[], tsMax: number): number {
  let lo = 0;
  let hi = backlog.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timeMs(backlog[mid].timestamp) > tsMax) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose timestamp is `< tsMin` in a newest-first list. */
function firstIndexTsLT(backlog: readonly Telegram[], tsMin: number): number {
  let lo = 0;
  let hi = backlog.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timeMs(backlog[mid].timestamp) >= tsMin) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function lowerBound(arr: readonly number[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function insertAnchor(anchors: number[], ts: number): void {
  const i = lowerBound(anchors, ts);
  if (anchors[i] === ts) return;
  anchors.splice(i, 0, ts);
}
