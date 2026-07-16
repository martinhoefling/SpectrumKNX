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
