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
  /** Formatted value text per column, only for an "events" bucket (#341) —
   * unchartable telegrams (e.g. DPT16 text) have no numeric `data` to plot,
   * just a discrete occurrence with a label shown in the dot's tooltip/legend. */
  labels?: (string | null)[];
}

export interface ChartBucket {
  unit: string;
  isBinary: boolean;
  /** GAs that never resolve to a number or boolean (e.g. text/complex DPTs)
   * are grouped here as discrete, unfilled event dots instead of a numeric
   * line or an always-empty series (#341). Mutually exclusive with isBinary. */
  isEvents: boolean;
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

    // A GA whose telegrams never resolve to a number or boolean (e.g. DPT16
    // text, or a complex/unknown DPT with no chosen override) can't be
    // plotted as a line — it used to land in the 'unknown' bucket as an
    // always-empty series. Route those GAs into a dedicated "events" bucket
    // of discrete dots instead (#341).
    const binaryAddrs = new Set<string>();
    const decodableAddrs = new Set<string>();
    for (const t of relevant) {
      if (t.dpt_main === 1 || typeof t.value_json === 'boolean') {
        binaryAddrs.add(t.target_address);
        continue;
      }
      const overrideKey = t.dpt_main == null ? dptOverrides[t.target_address] : undefined;
      let val = t.value_numeric;
      if (val === null && typeof t.value_json === 'number') val = t.value_json;
      else if (val === null && overrideKey) val = overrideValue(t);
      if (val !== null) decodableAddrs.add(t.target_address);
    }
    const eventAddrs = new Set(
      relevant
        .map(t => t.target_address)
        .filter((a, i, arr) => arr.indexOf(a) === i && !binaryAddrs.has(a) && !decodableAddrs.has(a))
    );

    // 2. Group into physical units / buckets
    // We treat DPT1 (boolean/binary) as a special bucket called 'binary'
    const grouped = new Map<string, typeof relevant>();
    const addressToUnit: Record<string, string> = {};

    for (const t of relevant) {
      if (eventAddrs.has(t.target_address)) continue; // built as the shared 'events' bucket below

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
        isEvents: false,
        timestamps,
        series
      });
    }

    // 3b. Events bucket (#341): one shared lane group for every unchartable
    // GA, dots only — no forward-fill, since each is a discrete occurrence
    // rather than a held state.
    if (eventAddrs.size > 0) {
      const eventRows = relevant.filter(t => eventAddrs.has(t.target_address));
      const tsSet = new Set<number>();
      eventRows.forEach(r => tsSet.add(r.ts));
      tsSet.add(maxTime);
      const timestamps = Array.from(tsSet).sort((a, b) => a - b);

      const series: ChartSeries[] = Array.from(eventAddrs).map(addr => {
        const rows = eventRows.filter(r => r.target_address === addr);
        const name = rows[0]?.target_name || addr;
        const real: boolean[] = [];
        const data: (number | null)[] = [];
        const labels: (string | null)[] = [];
        for (const ts of timestamps) {
          const match = rows.find(r => r.ts === ts);
          real.push(!!match);
          data.push(match ? 1 : null);
          labels.push(match ? (match.value_formatted ?? (match.value_json != null ? String(match.value_json) : null)) : null);
        }
        return { address: addr, name, data, real, labels };
      });

      buckets.push({ unit: 'events', isBinary: false, isEvents: true, timestamps, series });
      eventAddrs.forEach(a => { addressToUnit[a] = 'events'; });
    }

    // Order buckets by metric (unit), not by which telegram arrived first. The
    // grouping Map above preserves insertion order, so without this the vertical
    // order of the charts flipped whenever a new telegram or history chunk made
    // a different metric the earliest one plotted (#312).
    buckets.sort((a, b) => a.unit.localeCompare(b.unit));

    return { buckets, minTime, maxTime, addressToUnit };
  }, [telegrams, selectedTargets, dptOverrides]);
}
