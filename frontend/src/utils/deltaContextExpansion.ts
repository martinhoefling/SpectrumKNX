// Time-Delta-Context expansion (#309/#318/#319): given which telegrams
// already match the active filters, pull in every other telegram within a
// before/after window around each matching (or per-message-flagged) telegram
// — even though it wouldn't otherwise pass the filter. Shared by the live
// Group Monitor and History Search views so the algorithm can't drift.

interface Timestamped {
  timestamp: string;
}

export interface DeltaExpansionResult<T> {
  /** The full visible set: filter matches, flagged anchors, and pulled-in context rows. */
  items: T[];
  /** Identity keys (via `anchorKeyOf`) of items present only because they fell
   * within a window — i.e. they neither matched the filter nor were flagged.
   * Used to visually mark context-only rows (#343). */
  contextKeys: Set<string>;
}

/**
 * @param items The full (already sorted) buffer.
 * @param matches Per-item result of the primary filter match, same order as `items`.
 * @param anchorKeyOf Stable per-item identity, for testing `flaggedKeys` membership.
 * @param flaggedKeys Keys of telegrams individually flagged to always anchor a
 *   context window around themselves (#319), regardless of the primary filter.
 * @param beforeMs / @param afterMs The effective (already #318-gated) window.
 * @param anchorMatches Whether every filter match anchors a window (the global
 *   "all" state). When false only the flagged telegrams do, so the context can
 *   be limited to single messages (#319); matches are shown either way.
 */
export function expandWithDeltaContext<T extends Timestamped>(
  items: T[],
  matches: boolean[],
  anchorKeyOf: (t: T) => string,
  flaggedKeys: ReadonlySet<string>,
  beforeMs: number,
  afterMs: number,
  anchorMatches = true,
): DeltaExpansionResult<T> {
  // A flagged telegram is always shown and always anchors its own window,
  // independent of whether it passes the primary filter.
  const flagged = items.map(t => flaggedKeys.has(anchorKeyOf(t)));
  const effectiveMatch = (i: number) => matches[i] || flagged[i];

  if (beforeMs <= 0 && afterMs <= 0) {
    return { items: items.filter((_, i) => effectiveMatch(i)), contextKeys: new Set() };
  }

  const anchorTimestamps: number[] = [];
  const times = new Array<number>(items.length);
  for (let i = 0; i < items.length; i++) {
    const ts = new Date(items[i].timestamp).getTime();
    times[i] = ts;
    if (flagged[i] || (anchorMatches && matches[i])) anchorTimestamps.push(ts);
  }

  if (anchorTimestamps.length === 0) {
    return { items: items.filter((_, i) => effectiveMatch(i)), contextKeys: new Set() };
  }

  // One sweep over time order. Display order is not always chronological.
  anchorTimestamps.sort((a, b) => a - b);
  const order = items.map((_, i) => i);
  order.sort((i, j) => times[i] - times[j] || i - j);
  const covered = new Uint8Array(items.length);
  let left = 0;
  let right = 0;
  for (const i of order) {
    const t = times[i];
    const hi = t + beforeMs;
    const lo = t - afterMs;
    while (right < anchorTimestamps.length && anchorTimestamps[right] <= hi) right++;
    while (left < right && anchorTimestamps[left] < lo) left++;
    if (left < right) covered[i] = 1;
  }

  const contextKeys = new Set<string>();
  const kept = items.filter((t, i) => {
    // Filter matches and flagged anchors are never context rows (#343).
    if (matches[i] || flagged[i]) return true;
    if (covered[i]) {
      contextKeys.add(anchorKeyOf(t));
      return true;
    }
    return false;
  });
  return { items: kept, contextKeys };
}
