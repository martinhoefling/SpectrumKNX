import type { Telegram } from '../hooks/useWebSocket';
import { adjustFilterCounts, countFilterOptions, type FilterCounts } from '../types/filters';
import { edgeMembers, readListEdge, tagListEdge, type ListEdge } from './listEdge';
import {
  matchVisibleTelegram,
  selectVisibleTelegrams,
  visibleSelectionMode,
  type SelectVisibleOpts,
} from './selectVisibleTelegrams';
import { soleTimestampDirection, sortTelegrams, type SortConfig } from './sortConfig';

export interface LiveTelegramView {
  source: readonly Telegram[];
  sorted: Telegram[];
  items: Telegram[];
  contextKeys: Set<string>;
  counts: FilterCounts;
  opts: SelectVisibleOpts;
  sortConfig: SortConfig;
  direction: 'asc' | 'desc' | null;
}

/**
 * Sorted list, visible rows, and filter counts for one published buffer.
 * A tagged prepend reuses the previous view: timestamp order is already the
 * buffer order, and only the new and dropped rows are filtered and tallied.
 * Calling again with the same source, sort, and opts returns the same view,
 * so a StrictMode double render does not apply the edit twice.
 */
export function deriveLiveTelegramView(
  prev: LiveTelegramView | null,
  source: readonly Telegram[],
  sortConfig: SortConfig,
  opts: SelectVisibleOpts,
): LiveTelegramView {
  if (prev && prev.source === source && prev.sortConfig === sortConfig && prev.opts === opts) {
    return prev;
  }

  const direction = soleTimestampDirection(sortConfig);
  const sorted = sortLive(prev, source, sortConfig, direction);
  const displayEdge = readListEdge(sorted);
  const sameOpts = prev !== null && prev.opts === opts;
  const canStep = prev !== null
    && sameOpts
    && prev.direction === direction
    && displayEdge !== null
    && displayEdge.prev === prev.sorted
    && prev.contextKeys.size === 0;

  if (prev && canStep && displayEdge) {
    const { added, removed } = edgeMembers(sorted, displayEdge);
    const counts = adjustFilterCounts(prev.counts, added, removed);
    const mode = visibleSelectionMode(opts);
    if (mode === 'full') {
      const visible = selectVisibleTelegrams(sorted, opts);
      return { source, sorted, items: visible.items, contextKeys: visible.contextKeys, counts, opts, sortConfig, direction };
    }
    if (mode === 'identity') {
      return {
        source,
        sorted,
        items: sorted,
        contextKeys: prev.contextKeys,
        counts,
        opts,
        sortConfig,
        direction,
      };
    }
    const filtered = filterByEdge(sorted, prev.items, displayEdge, matchVisibleTelegram(opts));
    if (filtered) {
      return {
        source,
        sorted,
        items: filtered,
        contextKeys: prev.contextKeys,
        counts,
        opts,
        sortConfig,
        direction,
      };
    }
    const visible = selectVisibleTelegrams(sorted, opts);
    return { source, sorted, items: visible.items, contextKeys: visible.contextKeys, counts, opts, sortConfig, direction };
  }

  const visible = selectVisibleTelegrams(sorted, opts);
  const counts = prev && prev.source === source
    ? prev.counts
    : countFilterOptions(sorted);
  return {
    source,
    sorted,
    items: visible.items,
    contextKeys: visible.contextKeys,
    counts,
    opts,
    sortConfig,
    direction,
  };
}

function sortLive(
  prev: LiveTelegramView | null,
  source: readonly Telegram[],
  sortConfig: SortConfig,
  direction: 'asc' | 'desc' | null,
): Telegram[] {
  if (direction === 'desc') return source as Telegram[];

  const srcEdge = readListEdge(source);
  if (
    direction === 'asc'
    && prev
    && prev.direction === 'asc'
    && srcEdge
    && srcEdge.prev === prev.source
    && srcEdge.prevFrom === 0
  ) {
    const dropped = srcEdge.prev.length - srcEdge.keep;
    const head = srcEdge.dest;
    const asc = prev.sorted.slice(dropped);
    for (let i = head - 1; i >= 0; i--) asc.push(source[i]);
    return tagListEdge(asc, prev.sorted, dropped, 0, prev.sorted.length - dropped);
  }

  if (direction === 'asc') return [...source].reverse();
  return sortTelegrams(source as Telegram[], sortConfig);
}

/**
 * Applies a list edit to an already-filtered visible list. Returns the previous
 * array when nothing visible changed, or null when a dropped row sits in the
 * middle and the caller should rescan.
 */
function filterByEdge(
  next: readonly Telegram[],
  prevVisible: readonly Telegram[],
  edge: ListEdge<Telegram>,
  match: (t: Telegram) => boolean,
): Telegram[] | null {
  if (prevVisible === edge.prev && edge.prevFrom === 0 && edge.dest + edge.keep === next.length) {
    // Previous visible list was the whole sorted list and the edit only
    // prepends. `next` is already that list.
    let allMatch = true;
    for (let i = 0; i < edge.dest; i++) {
      if (!match(next[i])) { allMatch = false; break; }
    }
    if (allMatch) return next as Telegram[];
  }

  const removed = new Set<Telegram>();
  for (let i = 0; i < edge.prevFrom; i++) removed.add(edge.prev[i]);
  for (let i = edge.prevFrom + edge.keep; i < edge.prev.length; i++) removed.add(edge.prev[i]);

  let start = 0;
  while (start < prevVisible.length && removed.has(prevVisible[start])) start++;
  let end = prevVisible.length;
  while (end > start && removed.has(prevVisible[end - 1])) end--;
  for (let i = start; i < end; i++) {
    if (removed.has(prevVisible[i])) return null;
  }

  const prefix: Telegram[] = [];
  for (let i = 0; i < edge.dest; i++) if (match(next[i])) prefix.push(next[i]);
  const suffix: Telegram[] = [];
  for (let i = edge.dest + edge.keep; i < next.length; i++) if (match(next[i])) suffix.push(next[i]);

  if (prefix.length === 0 && suffix.length === 0 && start === 0 && end === prevVisible.length) {
    return prevVisible as Telegram[];
  }
  const items = prefix.concat(prevVisible.slice(start, end), suffix);
  return tagListEdge(items, prevVisible, start, prefix.length, end - start);
}
