export interface PeakRate {
  /** Most telegrams seen inside any one window. */
  count: number;
  /** Index (into the input) of the earliest telegram of that window. */
  startIdx: number;
}

/**
 * Busiest window in a list of telegram times (#441): the largest number of
 * telegrams falling within `windowMs` of each other, and where that burst
 * starts. Input order is arbitrary — the table may be sorted by any column —
 * but the common time-sorted cases skip the sort. Ties keep the earliest burst.
 */
export function peakRate(timesMs: number[], windowMs = 1000): PeakRate | null {
  const n = timesMs.length;
  if (n === 0) return null;

  let asc = true, desc = true;
  for (let i = 1; i < n && (asc || desc); i++) {
    if (timesMs[i] < timesMs[i - 1]) asc = false;
    if (timesMs[i] > timesMs[i - 1]) desc = false;
  }
  // order[k] = input index of the k-th earliest telegram
  let order: (k: number) => number;
  if (asc) order = k => k;
  else if (desc) order = k => n - 1 - k;
  else {
    const sorted = Array.from({ length: n }, (_, i) => i).sort((a, b) => timesMs[a] - timesMs[b]);
    order = k => sorted[k];
  }

  let best = 0, bestStart = 0, lo = 0;
  for (let hi = 0; hi < n; hi++) {
    const t = timesMs[order(hi)];
    while (t - timesMs[order(lo)] >= windowMs) lo++;
    if (hi - lo + 1 > best) {
      best = hi - lo + 1;
      bestStart = lo;
    }
  }
  return { count: best, startIdx: order(bestStart) };
}
