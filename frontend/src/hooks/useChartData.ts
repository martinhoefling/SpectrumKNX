import { useMemo } from 'react';
import type { Telegram } from '../hooks/useWebSocket';
import { decodeRawDpt, rawDptUnit } from '../utils/rawDpt';

export interface ChartSeries {
  address: string;
  name: string;
  data: (number | null)[]; // y-values corresponding to the shared timestamps array
  /** Per-column flag: true where this series actually received a telegram (vs a
   * forward-filled hold). Drives the telegram dots (#195), so cyclic repeats of
   * the same value are visible instead of hidden inside a flat segment. */
  real: boolean[];
}

export interface ChartBucket {
  unit: string;
  isBinary: boolean;
  timestamps: number[]; // shared x-values (unix ms)
  series: ChartSeries[];
}

export interface ChartDataResult {
  buckets: ChartBucket[];
  minTime: number | null;
  maxTime: number | null;
  /** Each plotted GA's metric/unit bucket key, so callers can group selection
   * order by unit without redoing this classification (#349's chart lock). */
  addressToUnit: Record<string, string>;
}

export function useChartData(
  telegrams: Telegram[],
  selectedTargets: string[],
  // Per-GA datatype chosen for group addresses with no DPT in the project, so
  // their raw payloads can be decoded and plotted (#315). Keyed by address.
  dptOverrides: Record<string, string> = {},
): ChartDataResult {
  return useMemo(() => {
    if (selectedTargets.length === 0 || telegrams.length === 0) {
      return { buckets: [], minTime: null, maxTime: null, addressToUnit: {} };
    }

    // Decode an untyped GA's raw payload with its chosen datatype, if any.
    const overrideValue = (t: Telegram): number | null => {
      const key = t.dpt_main == null ? dptOverrides[t.target_address] : undefined;
      if (!key || !Array.isArray(t.value_json)) return null;
      return decodeRawDpt(t.value_json as number[], key);
    };

    // A GA whose DPT is known from the project produces decoded telegrams
    // (dpt_main set). Telegrams received *before* a project import stay
    // undecoded (dpt_main null, only a raw payload), so plotting both puts the
    // same GA in an "unknown" bucket next to its real-unit bucket — two graphs
    // for one address (#206). Once a GA has any decoded telegram, ignore its
    // undecoded ones so it collapses to a single, correctly-scaled series.
    const decodedGas = new Set(
      telegrams
        .filter(t => t.target_address && selectedTargets.includes(t.target_address) && t.dpt_main != null)
        .map(t => t.target_address)
    );

    // 1. Filter out only relevant telegrams and parse timestamps
    const relevant = telegrams
      .filter(t => t.target_address && selectedTargets.includes(t.target_address))
      // Filter out reads/responses if they don't have a value (to keep plot clean), usually we plot values.
      // Easiest is to ensure value_numeric or value_json is != null
      .filter(t => t.value_numeric !== null || t.value_json !== null)
      // Drop pre-import undecoded rows for GAs that are decoded elsewhere (#206).
      .filter(t => t.dpt_main != null || !decodedGas.has(t.target_address))
      .map(t => ({
        ...t,
        ts: new Date(t.timestamp).getTime()
      }))
      // Sort strictly by time ascending, important for uPlot's X-axis requirement
      .sort((a, b) => a.ts - b.ts);

    if (relevant.length === 0) {
      return { buckets: [], minTime: null, maxTime: null, addressToUnit: {} };
    }

    const minTime = relevant[0].ts;
    const maxTime = relevant[relevant.length - 1].ts;

    // 2. Group into physical units / buckets
    // We treat DPT1 (boolean/binary) as a special bucket called 'binary'
    const grouped = new Map<string, typeof relevant>();
    const addressToUnit: Record<string, string> = {};

    for (const t of relevant) {
      const overrideKey = t.dpt_main == null ? dptOverrides[t.target_address] : undefined;
      let bucketKey = t.unit || 'unknown';
      if (overrideKey) {
        // Group decoded-untyped GAs by their chosen unit (or the datatype key
        // when dimensionless) so they don't fall into the 'unknown' bucket (#315).
        bucketKey = rawDptUnit(overrideKey) || `DPT ${overrideKey}`;
      }
      if (t.dpt_main === 1) bucketKey = 'binary';
      // Also catch anything with a boolean value_json if type is unknown
      if (typeof t.value_json === 'boolean') bucketKey = 'binary';

      if (!grouped.has(bucketKey)) grouped.set(bucketKey, []);
      grouped.get(bucketKey)!.push(t);
      addressToUnit[t.target_address] = bucketKey;
    }

    // 3. For each bucket, build the aligned data matrix
    const buckets: ChartBucket[] = [];

    for (const [unit, rows] of grouped.entries()) {
      const isBinary = unit === 'binary';

      // Get all unique timestamps for this bucket
      const tsSet = new Set<number>();
      rows.forEach(r => tsSet.add(r.ts));
      // Extend every series' last segment to the newest telegram across all
      // plotted GAs, so a state still held after its last telegram is drawn as
      // a visible segment out to the right edge instead of a zero-width sliver
      // (#208): the per-series forward-fill below carries the last value into
      // this appended column. Anchoring on the newest telegram rather than
      // wall-clock "now" keeps it correct for loaded history and needs no
      // ticking redraw. (The single newest series still ends at its own
      // telegram — advancing past it is left to the time-axis brush, #193.)
      tsSet.add(maxTime);
      const timestamps = Array.from(tsSet).sort((a, b) => a - b);

      // Find all unique targets within this bucket
      const targetsInBucket = Array.from(new Set(rows.map(r => r.target_address)));

      const series: ChartSeries[] = targetsInBucket.map(addr => {
        // Find the friendly name
        const name = rows.find(r => r.target_address === addr)?.target_name || addr;

        // Map timestamps to values
        let lastVal: number | null = null;
        const real: boolean[] = [];
        const data = timestamps.map(ts => {
          // Find if there's a telegram for this exact target at this exact timestamp
          const match = rows.find(r => r.target_address === addr && r.ts === ts);
          real.push(!!match);
          if (match) {
            let val = match.value_numeric;
            if (val === null && typeof match.value_json === 'boolean') {
              val = match.value_json ? 1 : 0;
            } else if (val === null && typeof match.value_json === 'number') {
              val = match.value_json;
            } else if (val === null) {
              // Untyped GA: decode the raw payload with the user-chosen DPT (#315).
              val = overrideValue(match);
            }
            if (val !== null) lastVal = Number(val);
          }
          return lastVal;
        });

        return { address: addr, name, data, real };
      });

      buckets.push({
        unit,
        isBinary,
        timestamps,
        series
      });
    }

    // Order buckets by metric (unit), not by which telegram arrived first. The
    // grouping Map above preserves insertion order, so without this the vertical
    // order of the charts flipped whenever a new telegram or history chunk made
    // a different metric the earliest one plotted (#312).
    buckets.sort((a, b) => a.unit.localeCompare(b.unit));

    return { buckets, minTime, maxTime, addressToUnit };
  }, [telegrams, selectedTargets, dptOverrides]);
}
