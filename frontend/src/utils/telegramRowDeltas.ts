export interface RowDelta {
  deltaStr: string | null;
  deltaNextStr: string | null;
  deltaMs: number | null;
}

export type TelegramRowOf<T> = T & RowDelta;

interface Stamped { timestamp: string }

function timeMs(timestamp: string): number {
  return new Date(timestamp).getTime();
}

function formatDeltaMs(diffMs: number, sign: '+' | '-'): string {
  const mm = String(Math.floor(diffMs / 60000)).padStart(2, '0');
  const ss = String(Math.floor((diffMs % 60000) / 1000)).padStart(2, '0');
  const ms = String(diffMs % 1000).padStart(3, '0');
  return `${sign} ${mm}:${ss}.${ms}`;
}

/** Min/max without spreading the timestamp array into `Math.min` / `Math.max`. */
export function timestampBounds(
  items: readonly Stamped[],
  direction: 'asc' | 'desc' | null,
): { minTs: number; maxTs: number } {
  if (items.length === 0) return { minTs: Infinity, maxTs: -Infinity };
  if (direction === 'asc' || direction === 'desc') {
    const a = timeMs(items[0].timestamp);
    const b = timeMs(items[items.length - 1].timestamp);
    return a <= b ? { minTs: a, maxTs: b } : { minTs: b, maxTs: a };
  }
  let minTs = Infinity;
  let maxTs = -Infinity;
  for (let i = 0; i < items.length; i++) {
    const ts = timeMs(items[i].timestamp);
    if (ts < minTs) minTs = ts;
    if (ts > maxTs) maxTs = ts;
  }
  return { minTs, maxTs };
}

function withDelta<T extends Stamped>(
  t: T,
  idx: number,
  items: readonly Stamped[],
  minTs: number,
  maxTs: number,
  timeSortDirection: 'asc' | 'desc' | null,
): TelegramRowOf<T> {
  let deltaStr: string | null = null;
  let deltaNextStr: string | null = null;
  let deltaMs: number | null = null;
  const currTs = timeMs(t.timestamp);
  const hasOlderInList = currTs > minTs;
  const hasYoungerInList = currTs < maxTs;
  if (idx > 0) {
    const prev = timeMs(items[idx - 1].timestamp);
    const rawDiff = currTs - prev;
    deltaMs = Math.abs(rawDiff);
    const sign: '+' | '-' = timeSortDirection
      ? (timeSortDirection === 'asc' ? '+' : '-')
      : (rawDiff >= 0 ? '+' : '-');
    const hasRequiredNeighbor = sign === '+' ? hasOlderInList : hasYoungerInList;
    deltaStr = hasRequiredNeighbor ? formatDeltaMs(deltaMs, sign) : null;
  }
  if (idx < items.length - 1) {
    const next = timeMs(items[idx + 1].timestamp);
    const rawDiffToNext = next - currTs;
    const nextSign: '+' | '-' = timeSortDirection
      ? (timeSortDirection === 'asc' ? '-' : '+')
      : (rawDiffToNext >= 0 ? '-' : '+');
    const hasRequiredNeighbor = nextSign === '+' ? hasOlderInList : hasYoungerInList;
    deltaNextStr = hasRequiredNeighbor ? formatDeltaMs(Math.abs(rawDiffToNext), nextSign) : null;
  }
  return { ...t, deltaStr, deltaNextStr, deltaMs };
}

export function buildTelegramRows<T extends Stamped>(
  items: readonly T[],
  timeSortDirection: 'asc' | 'desc' | null,
): TelegramRowOf<T>[] {
  if (items.length === 0) return [];
  const { minTs, maxTs } = timestampBounds(items, timeSortDirection);
  return items.map((t, idx) => withDelta(t, idx, items, minTs, maxTs, timeSortDirection));
}

export interface RowPatch<T> {
  prevFrom: number;
  dest: number;
  keep: number;
  prev: readonly T[];
}

/**
 * Rebuilds only the new rows and the boundary rows whose neighbor changed.
 * Returns null when the edit does not line up with the previous rows.
 * `direction` null always rebuilds — non-time sorts are not a prepend.
 */
export function patchTelegramRows<T extends Stamped>(
  items: readonly T[],
  prevRows: readonly TelegramRowOf<T>[],
  edge: RowPatch<T>,
  direction: 'asc' | 'desc' | null,
): TelegramRowOf<T>[] | null {
  if (!direction) return null;
  if (items.length === 0) return [];
  if (prevRows.length !== edge.prev.length) return null;
  if (edge.prevFrom < 0 || edge.dest < 0 || edge.keep < 0) return null;
  if (edge.prevFrom + edge.keep > edge.prev.length) return null;
  if (edge.dest + edge.keep > items.length) return null;
  if (edge.keep > 0 && items[edge.dest] !== edge.prev[edge.prevFrom]) return null;

  const { minTs, maxTs } = timestampBounds(items, direction);
  const out = new Array<TelegramRowOf<T>>(items.length);
  for (let i = 0; i < edge.keep; i++) out[edge.dest + i] = prevRows[edge.prevFrom + i];

  const dirty = new Set<number>();
  for (let i = 0; i < edge.dest; i++) dirty.add(i);
  for (let i = edge.dest + edge.keep; i < items.length; i++) dirty.add(i);
  if (edge.keep > 0) {
    if (edge.dest > 0 || edge.prevFrom > 0) dirty.add(edge.dest);
    const last = edge.dest + edge.keep - 1;
    if (edge.dest + edge.keep < items.length || edge.prevFrom + edge.keep < edge.prev.length) {
      dirty.add(last);
    }
  }
  for (const idx of dirty) out[idx] = withDelta(items[idx], idx, items, minTs, maxTs, direction);
  return out;
}
