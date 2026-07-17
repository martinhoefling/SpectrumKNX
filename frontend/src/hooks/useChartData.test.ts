import { renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useChartData } from './useChartData';
import type { Telegram } from './useWebSocket';

const base: Telegram = {
  timestamp: '2026-07-16T10:00:00.000Z',
  source_address: '1.1.1',
  target_address: '1/1/1',
  telegram_type: 'GroupValueWrite',
  dpt: null, dpt_main: null, dpt_sub: null, dpt_name: null,
  value_numeric: null, value_json: null, raw_data: null,
};

const at = (s: number, o: Partial<Telegram>): Telegram => ({
  ...base,
  timestamp: `2026-07-16T10:00:${String(s).padStart(2, '0')}.000Z`,
  ...o,
});

describe('useChartData — DPT backfill / duplicate graphs (#206)', () => {
  test('a GA decoded after import collapses to one bucket, dropping pre-import raw rows', () => {
    const telegrams = [
      // pre-import: no DPT, raw numeric payload
      at(1, { target_address: '1/1/1', value_json: 100 }),
      at(2, { target_address: '1/1/1', value_json: 101 }),
      // post-import: decoded °C
      at(3, { target_address: '1/1/1', dpt_main: 9, dpt_sub: 1, unit: '°C', value_numeric: 20 }),
      at(4, { target_address: '1/1/1', dpt_main: 9, dpt_sub: 1, unit: '°C', value_numeric: 21 }),
    ];
    const { result } = renderHook(() => useChartData(telegrams, ['1/1/1']));
    expect(result.current.buckets.map(b => b.unit)).toEqual(['°C']);
  });

  test('a GA that is never decoded still plots in the unknown bucket', () => {
    const telegrams = [
      at(1, { target_address: '1/1/1', value_json: 100 }),
      at(2, { target_address: '1/1/1', value_json: 101 }),
    ];
    const { result } = renderHook(() => useChartData(telegrams, ['1/1/1']));
    expect(result.current.buckets).toHaveLength(1);
    expect(result.current.buckets[0].unit).toBe('unknown');
  });
});

describe('useChartData — extend last segment to newest telegram (#208)', () => {
  test("a binary series' held state extends to the newest telegram of another GA", () => {
    const telegrams = [
      // Binary GA: switched ON at t=1, then no further telegrams.
      at(1, { target_address: '1/1/1', dpt_main: 1, value_numeric: 1 }),
      // A different numeric GA keeps reporting until t=5 (the newest telegram).
      at(3, { target_address: '2/2/2', dpt_main: 9, dpt_sub: 1, unit: '°C', value_numeric: 20 }),
      at(5, { target_address: '2/2/2', dpt_main: 9, dpt_sub: 1, unit: '°C', value_numeric: 21 }),
    ];
    const { result } = renderHook(() => useChartData(telegrams, ['1/1/1', '2/2/2']));
    const maxTime = result.current.maxTime!;

    const binary = result.current.buckets.find(b => b.isBinary)!;
    // The binary bucket's timeline now reaches the newest telegram (t=5)...
    expect(binary.timestamps[binary.timestamps.length - 1]).toBe(maxTime);
    // ...and the ON state (1) is carried all the way to that right edge.
    const series = binary.series.find(s => s.address === '1/1/1')!;
    expect(series.data[series.data.length - 1]).toBe(1);
  });

  test('does not add spurious columns when a bucket already ends at the newest telegram', () => {
    const telegrams = [
      at(1, { target_address: '1/1/1', dpt_main: 9, dpt_sub: 1, unit: '°C', value_numeric: 20 }),
      at(2, { target_address: '1/1/1', dpt_main: 9, dpt_sub: 1, unit: '°C', value_numeric: 21 }),
    ];
    const { result } = renderHook(() => useChartData(telegrams, ['1/1/1']));
    // Two telegrams → two timestamp columns; maxTime already present, no extra.
    expect(result.current.buckets[0].timestamps).toHaveLength(2);
  });
});
