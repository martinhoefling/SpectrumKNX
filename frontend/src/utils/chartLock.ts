import type { ChartBucket } from '../hooks/useChartData';

/** A bucket as actually rendered: possibly one of several split-off charts
 * for a unit that was locked one or more times (#349). Only the last group
 * for a unit can be locked/unlocked — earlier ones are permanently closed. */
export interface DisplayBucket {
  bucket: ChartBucket;
  /** Stable React key — buckets sharing a unit are no longer unit-unique. */
  key: string;
  /** 1-based position among this unit's split charts, and the total count. */
  groupIndex: number;
  groupCount: number;
  /** Whether this is the unit's currently-open (lockable) chart. */
  isLatest: boolean;
}

/**
 * Splits each bucket whose unit has one or more lock thresholds into several
 * charts, dividing that unit's group addresses by *selection order* — the
 * GAs selected before a lock stay in the chart that was open when it was
 * locked; anything selected after spills into the next (new) chart (#349).
 *
 * @param lockThresholds Per-unit list of "GAs assigned so far" counts at each
 *   lock action, e.g. `{ lx: [3] }` = the first 3 selected lx GAs (by
 *   selection order) stay in chart 1; any further lx GA starts chart 2.
 */
export function splitLockedBuckets(
  buckets: ChartBucket[],
  selectedTargets: string[],
  addressToUnit: Record<string, string>,
  lockThresholds: Record<string, number[]>,
): DisplayBucket[] {
  const result: DisplayBucket[] = [];

  for (const bucket of buckets) {
    const bucketAddrs = new Set(bucket.series.map(s => s.address));
    // This unit's GAs in selection order, restricted to what's actually plotted here.
    const ordered = selectedTargets.filter(a => addressToUnit[a] === bucket.unit && bucketAddrs.has(a));
    const seriesByAddr = new Map(bucket.series.map(s => [s.address, s]));

    const thresholds = lockThresholds[bucket.unit];
    if (!thresholds || thresholds.length === 0) {
      result.push({
        // Always in selection order, not the bucket's arrival-order series array.
        bucket: { ...bucket, series: ordered.map(a => seriesByAddr.get(a)!) },
        key: bucket.unit, groupIndex: 1, groupCount: 1, isLatest: true,
      });
      continue;
    }

    const sorted = [...thresholds].sort((a, b) => a - b);
    const slices: string[][] = [];
    let start = 0;
    for (const t of sorted) {
      slices.push(ordered.slice(start, t));
      start = t;
    }
    slices.push(ordered.slice(start));

    const nonEmpty = slices.filter(s => s.length > 0);
    nonEmpty.forEach((addrs, i) => {
      result.push({
        // Reorder to selection order, not the bucket's original (arrival-order) series array.
        bucket: { ...bucket, series: addrs.map(a => seriesByAddr.get(a)!) },
        key: `${bucket.unit}#${i}`,
        groupIndex: i + 1,
        groupCount: nonEmpty.length,
        isLatest: i === nonEmpty.length - 1,
      });
    });
  }

  return result;
}
