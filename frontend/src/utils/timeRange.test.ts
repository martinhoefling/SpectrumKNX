import { expect, test } from 'vitest';
import { expandDegenerateRange, DEGENERATE_RANGE_PAD_MS } from './timeRange';

test('leaves a normal range untouched', () => {
  expect(expandDegenerateRange(1000, 5000)).toEqual([1000, 5000]);
});

test('pads a zero-width range so the axis is not degenerate (#239)', () => {
  const t = 1_700_000_000_000;
  expect(expandDegenerateRange(t, t)).toEqual([t - DEGENERATE_RANGE_PAD_MS, t + DEGENERATE_RANGE_PAD_MS]);
});

test('pads an inverted range as well (defensive)', () => {
  const [a, b] = expandDegenerateRange(5000, 4000);
  expect(b).toBeGreaterThan(a);
});

test('honours a custom pad', () => {
  expect(expandDegenerateRange(10, 10, 5)).toEqual([5, 15]);
});
