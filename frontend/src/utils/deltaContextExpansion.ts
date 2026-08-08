// Time-Delta-Context expansion (#309/#318/#319): given which telegrams
// already match the active filters, pull in every other telegram within a
// before/after window around each matching (or per-message-flagged) telegram
// — even though it wouldn't otherwise pass the filter. Shared by the live
// Group Monitor and History Search views so the algorithm can't drift.

interface Timestamped {
  timestamp: string;
}

/**
 * @param items The full (already sorted) buffer.
 * @param matches Per-item result of the primary filter match, same order as `items`.
 * @param anchorKeyOf Stable per-item identity, for testing `flaggedKeys` membership.
 * @param flaggedKeys Keys of telegrams individually flagged to always anchor a
 *   context window around themselves (#319), regardless of the primary filter.
 * @param beforeMs / @param afterMs The effective (already #318-gated) window.
 */
export function expandWithDeltaContext<T extends Timestamped>(
  items: T[],
  matches: boolean[],
  anchorKeyOf: (t: T) => string,
  flaggedKeys: ReadonlySet<string>,
  beforeMs: number,
  afterMs: number,
): T[] {
  // A flagged telegram is always shown and always anchors its own window,
  // independent of whether it passes the primary filter.
  const effectiveMatch = items.map((t, i) => matches[i] || flaggedKeys.has(anchorKeyOf(t)));

  if (beforeMs <= 0 && afterMs <= 0) {
    return items.filter((_, i) => effectiveMatch[i]);
  }

  const anchorTimestamps = items
    .filter((_, i) => effectiveMatch[i])
    .map(t => new Date(t.timestamp).getTime());

  if (anchorTimestamps.length === 0) return [];

  return items.filter((t, i) => {
    if (effectiveMatch[i]) return true;
    const ts = new Date(t.timestamp).getTime();
    return anchorTimestamps.some(mts => ts >= mts - beforeMs && ts <= mts + afterMs);
  });
}
