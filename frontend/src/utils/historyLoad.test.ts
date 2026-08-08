import { expect, test } from 'vitest';
import { applyFilterParams, buildHistoryUrl, rangeToMs } from './historyLoad';
import { DEFAULT_FILTERS } from '../types/filters';

test('applyFilterParams sends the Time-Delta-Context window when enabled', () => {
  const url = applyFilterParams('/api/telegrams', { ...DEFAULT_FILTERS, deltaBeforeMs: 500, deltaAfterMs: 250 });
  expect(url).toContain('delta_before_ms=500');
  expect(url).toContain('delta_after_ms=250');
});

test('applyFilterParams omits the window while disabled, even with stored values (#318)', () => {
  const url = applyFilterParams('/api/telegrams', {
    ...DEFAULT_FILTERS, deltaBeforeMs: 500, deltaAfterMs: 250, deltaContextEnabled: false,
  });
  expect(url).not.toContain('delta_before_ms');
  expect(url).not.toContain('delta_after_ms');
});

test('buildHistoryUrl handles relative ranges correctly', () => {
  const url = buildHistoryUrl({ kind: 'relative', seconds: 3600 }, 100);
  expect(url).toContain('limit=100');
  expect(url).toContain('start_time=');
});

test('buildHistoryUrl parses absolute local datetimes as local time and formats to UTC ISO', () => {
  const startTime = '2001-01-01T07:00';
  const endTime = '2001-01-01T09:00';
  const url = buildHistoryUrl({ kind: 'absolute', startTime, endTime }, 50);

  const expectedStart = new Date(startTime).toISOString();
  const expectedEnd = new Date(endTime).toISOString();

  expect(url).toContain('limit=50');
  expect(url).toContain(`start_time=${encodeURIComponent(expectedStart)}`);
  expect(url).toContain(`end_time=${encodeURIComponent(expectedEnd)}`);
});

test('rangeToMs resolves relative ranges to epoch ms', () => {
  const now = Date.now();
  const { startMs, endMs } = rangeToMs({ kind: 'relative', seconds: 10 }, now);
  expect(endMs).toBe(now);
  expect(startMs).toBe(now - 10000);
});

test('rangeToMs resolves absolute ranges to local timezone epoch ms', () => {
  const startTime = '2001-01-01T07:00';
  const endTime = '2001-01-01T09:00';
  const { startMs, endMs } = rangeToMs({ kind: 'absolute', startTime, endTime });

  expect(startMs).toBe(new Date(startTime).getTime());
  expect(endMs).toBe(new Date(endTime).getTime());
});
