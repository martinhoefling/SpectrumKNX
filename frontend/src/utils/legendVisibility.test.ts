import { afterEach, expect, test } from 'vitest';
import {
  isSeriesHidden,
  setSeriesHidden,
  clearSeriesHidden,
} from './legendVisibility';

afterEach(() => {
  // The store is module-level session state; reset between tests.
  clearSeriesHidden(['1/1/1', '2/2/2', '3/3/3']);
});

test('set and read a hidden series', () => {
  expect(isSeriesHidden('1/1/1')).toBe(false);
  setSeriesHidden('1/1/1', true);
  expect(isSeriesHidden('1/1/1')).toBe(true);
  setSeriesHidden('1/1/1', false);
  expect(isSeriesHidden('1/1/1')).toBe(false);
});

test('clearSeriesHidden resets visibility so a reselected target shows again (#205)', () => {
  setSeriesHidden('1/1/1', true);
  setSeriesHidden('2/2/2', true);

  // Deselecting 1/1/1 clears only its flag.
  clearSeriesHidden(['1/1/1']);

  expect(isSeriesHidden('1/1/1')).toBe(false);
  expect(isSeriesHidden('2/2/2')).toBe(true);
});
