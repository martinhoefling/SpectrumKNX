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

describe('useChartData — addressToUnit (#349 chart lock)', () => {
  test('maps every plotted GA to its bucket unit', () => {
    const telegrams = [
      at(1, { target_address: '1/1/1', dpt_main: 9, dpt_sub: 1, unit: '°C', value_numeric: 20 }),
      at(2, { target_address: '1/1/2', dpt_main: 9, dpt_sub: 1, unit: '°C', value_numeric: 21 }),
      at(3, { target_address: '1/1/3', dpt_main: 1, value_json: true }),
    ];
    const { result } = renderHook(() => useChartData(telegrams, ['1/1/1', '1/1/2', '1/1/3']));
    expect(result.current.addressToUnit).toEqual({
      '1/1/1': '°C', '1/1/2': '°C', '1/1/3': 'binary',
    });
  });

  test('is empty when nothing is selected', () => {
    const { result } = renderHook(() => useChartData([], []));
    expect(result.current.addressToUnit).toEqual({});
  });
});

describe('useChartData — datatype override for untyped GAs (#315)', () => {
  test('untyped raw-byte telegrams with no chosen datatype land in the events bucket (#341)', () => {
    const telegrams = [
      at(1, { target_address: '1/1/1', value_json: [0x0c, 0x1a] as unknown as Record<string, unknown> }),
      at(2, { target_address: '1/1/1', value_json: [0x0c, 0x1b] as unknown as Record<string, unknown> }),
    ];
    const { result } = renderHook(() => useChartData(telegrams, ['1/1/1']));
    // Unplottable as a numeric line, but not silently dropped either — shown
    // as discrete event dots instead (#341).
    expect(result.current.buckets).toHaveLength(1);
    expect(result.current.buckets[0].unit).toBe('events');
    expect(result.current.buckets[0].isEvents).toBe(true);
    const series = result.current.buckets[0]?.series[0];
    expect(series?.real).toEqual([true, true]);
  });

  test('a chosen datatype decodes raw payloads and groups by its unit', () => {
    const telegrams = [
      at(1, { target_address: '1/1/1', value_json: [0x0c, 0x1a] as unknown as Record<string, unknown> }),
      at(2, { target_address: '1/1/1', value_json: [0x00, 0x00] as unknown as Record<string, unknown> }),
    ];
    // DPT 9 (2-byte float): 0x0C1A ≈ 21.0, 0x0000 = 0.
    const { result } = renderHook(() => useChartData(telegrams, ['1/1/1'], { '1/1/1': '9' }));
    const bucket = result.current.buckets[0];
    expect(bucket.unit).toBe('DPT 9');
    const series = bucket.series.find(s => s.address === '1/1/1')!;
    expect(series.data[0]).toBeCloseTo(21.0, 4);
    expect(series.data[series.data.length - 1]).toBeCloseTo(0, 6);
  });

  test('a percent datatype buckets under its unit', () => {
    const telegrams = [
      at(1, { target_address: '1/1/1', value_json: [0xff] as unknown as Record<string, unknown> }),
    ];
    const { result } = renderHook(() => useChartData(telegrams, ['1/1/1'], { '1/1/1': '5.001' }));
    expect(result.current.buckets[0].unit).toBe('%');
    expect(result.current.buckets[0].series[0].data[0]).toBeCloseTo(100, 6);
  });
});

describe('useChartData — events bucket for unchartable DPTs (#341)', () => {
  test('text (DPT16) telegrams land in a shared events bucket with formatted labels', () => {
    const telegrams = [
      at(1, { target_address: '1/1/1', dpt_main: 16, dpt_sub: 1, value_json: 'Hello', value_formatted: 'Hello' }),
      at(2, { target_address: '1/1/1', dpt_main: 16, dpt_sub: 1, value_json: 'World', value_formatted: 'World' }),
    ];
    const { result } = renderHook(() => useChartData(telegrams, ['1/1/1']));
    expect(result.current.buckets).toHaveLength(1);
    expect(result.current.buckets[0].unit).toBe('events');
    expect(result.current.addressToUnit['1/1/1']).toBe('events');
    const series = result.current.buckets[0].series[0];
    expect(series.labels).toEqual(['Hello', 'World']);
  });

  test('binary and numeric GAs are not swept into the events bucket', () => {
    const telegrams = [
      at(1, { target_address: '1/1/1', dpt_main: 1, value_json: true }),
      at(2, { target_address: '1/1/2', dpt_main: 9, dpt_sub: 1, unit: '°C', value_numeric: 20 }),
      at(3, { target_address: '1/1/3', dpt_main: 16, dpt_sub: 1, value_json: 'Alarm', value_formatted: 'Alarm' }),
    ];
    const { result } = renderHook(() => useChartData(telegrams, ['1/1/1', '1/1/2', '1/1/3']));
    expect(result.current.addressToUnit).toEqual({
      '1/1/1': 'binary', '1/1/2': '°C', '1/1/3': 'events',
    });
    const eventsBucket = result.current.buckets.find(b => b.unit === 'events')!;
    expect(eventsBucket.series.map(s => s.address)).toEqual(['1/1/3']);
  });

  test('an events-bucket series does not forward-fill between occurrences', () => {
    const telegrams = [
      at(1, { target_address: '1/1/1', dpt_main: 16, dpt_sub: 1, value_json: 'A', value_formatted: 'A' }),
    ];
    // A second, unrelated GA extends maxTime — the lone event should not
    // "hold" a value across that appended column.
    const telegramsWithLaterOther = [
      ...telegrams,
      at(5, { target_address: '1/1/2', dpt_main: 1, value_json: true }),
    ];
    const { result } = renderHook(() => useChartData(telegramsWithLaterOther, ['1/1/1', '1/1/2']));
    const eventsSeries = result.current.buckets.find(b => b.unit === 'events')!.series[0];
    expect(eventsSeries.data).toEqual([1, null]);
  });
});

describe('useChartData — stable bucket order (#312)', () => {
  test('orders buckets by metric regardless of which telegram is earliest', () => {
    // '%' arrives first here, 'W' arrives first when reordered — the vertical
    // order of the charts must not depend on telegram timing.
    const early = [
      at(1, { target_address: '1/1/1', dpt_main: 5, dpt_sub: 1, unit: '%', value_numeric: 50 }),
      at(2, { target_address: '2/2/2', dpt_main: 14, unit: 'W', value_numeric: 1200 }),
    ];
    const swapped = [
      at(1, { target_address: '2/2/2', dpt_main: 14, unit: 'W', value_numeric: 1200 }),
      at(2, { target_address: '1/1/1', dpt_main: 5, dpt_sub: 1, unit: '%', value_numeric: 50 }),
    ];
    const targets = ['1/1/1', '2/2/2'];

    const a = renderHook(() => useChartData(early, targets)).result.current.buckets.map(b => b.unit);
    const b = renderHook(() => useChartData(swapped, targets)).result.current.buckets.map(b => b.unit);

    expect(a).toEqual(['%', 'W']);
    expect(b).toEqual(['%', 'W']);
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

  test('marks each real telegram column so cyclic same-value repeats are dotted (#195)', () => {
    const telegrams = [
      // A cyclic "alive" GA sending the same value 1 three times.
      at(1, { target_address: '1/1/1', dpt_main: 1, dpt_sub: 11, value_numeric: 1 }),
      at(3, { target_address: '1/1/1', dpt_main: 1, dpt_sub: 11, value_numeric: 1 }),
      at(5, { target_address: '1/1/1', dpt_main: 1, dpt_sub: 11, value_numeric: 1 }),
    ];
    const { result } = renderHook(() => useChartData(telegrams, ['1/1/1']));
    const series = result.current.buckets[0].series[0];
    // Every telegram is a real receipt even though the value never changes.
    expect(series.real).toEqual([true, true, true]);
    expect(series.data).toEqual([1, 1, 1]);
  });

  test('forward-filled columns from another GA are not marked real (#195)', () => {
    const telegrams = [
      at(1, { target_address: '1/1/1', dpt_main: 9, dpt_sub: 1, unit: '°C', value_numeric: 20 }),
      // A second GA in the same bucket adds a timestamp column at t=3; GA 1/1/1
      // holds its value there (forward-fill) but did not receive a telegram.
      at(3, { target_address: '2/2/2', dpt_main: 9, dpt_sub: 1, unit: '°C', value_numeric: 30 }),
    ];
    const { result } = renderHook(() => useChartData(telegrams, ['1/1/1', '2/2/2']));
    const s1 = result.current.buckets[0].series.find(s => s.address === '1/1/1')!;
    // Column order is [t1, t3]; 1/1/1 is real only at t1.
    expect(s1.real).toEqual([true, false]);
    expect(s1.data).toEqual([20, 20]);
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
