import { useMemo } from 'react';
import type { Telegram } from '../hooks/useWebSocket';

export interface ChartSeries {
  address: string;
  name: string;
  data: (number | null)[]; // y-values corresponding to the shared timestamps array
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
}

export function useChartData(telegrams: Telegram[], selectedTargets: string[]): ChartDataResult {
  return useMemo(() => {
    if (selectedTargets.length === 0 || telegrams.length === 0) {
      return { buckets: [], minTime: null, maxTime: null };
    }

    // 1. Filter out only relevant telegrams and parse timestamps
    const relevant = telegrams
      .filter(t => t.target_address && selectedTargets.includes(t.target_address))
      // Filter out reads/responses if they don't have a value (to keep plot clean), usually we plot values.
      // Easiest is to ensure value_numeric or value_json is != null
      .filter(t => t.value_numeric !== null || t.value_json !== null)
      .map(t => ({
        ...t,
        ts: new Date(t.timestamp).getTime()
      }))
      // Sort strictly by time ascending, important for uPlot's X-axis requirement
      .sort((a, b) => a.ts - b.ts);

    if (relevant.length === 0) {
      return { buckets: [], minTime: null, maxTime: null };
    }

    const minTime = relevant[0].ts;
    const maxTime = relevant[relevant.length - 1].ts;

    // 2. Group into physical units / buckets
    // We treat DPT1 (boolean/binary) as a special bucket called 'binary'
    const grouped = new Map<string, typeof relevant>();

    for (const t of relevant) {
      let bucketKey = t.unit || 'unknown';
      if (t.dpt_main === 1) bucketKey = 'binary';
      // Also catch anything with a boolean value_json if type is unknown
      if (typeof t.value_json === 'boolean') bucketKey = 'binary';

      if (!grouped.has(bucketKey)) grouped.set(bucketKey, []);
      grouped.get(bucketKey)!.push(t);
    }

    // 3. For each bucket, build the aligned data matrix
    const buckets: ChartBucket[] = [];

    for (const [unit, rows] of grouped.entries()) {
      const isBinary = unit === 'binary';
      
      // Get all unique timestamps for this bucket
      const tsSet = new Set<number>();
      rows.forEach(r => tsSet.add(r.ts));
      const timestamps = Array.from(tsSet).sort((a, b) => a - b);

      // Find all unique targets within this bucket
      const targetsInBucket = Array.from(new Set(rows.map(r => r.target_address)));
      
      const series: ChartSeries[] = targetsInBucket.map(addr => {
        // Find the friendly name
        const name = rows.find(r => r.target_address === addr)?.target_name || addr;
        
        // Map timestamps to values
        let lastVal: number | null = null;
        const data = timestamps.map(ts => {
          // Find if there's a telegram for this exact target at this exact timestamp
          const match = rows.find(r => r.target_address === addr && r.ts === ts);
          if (match) {
            let val = match.value_numeric;
            if (val === null && typeof match.value_json === 'boolean') {
              val = match.value_json ? 1 : 0;
            } else if (val === null && typeof match.value_json === 'number') {
              val = match.value_json;
            }
            if (val !== null) lastVal = Number(val);
          }
          return lastVal;
        });

        return { address: addr, name, data };
      });

      buckets.push({
        unit,
        isBinary,
        timestamps,
        series
      });
    }

    return { buckets, minTime, maxTime };
  }, [telegrams, selectedTargets]);
}
