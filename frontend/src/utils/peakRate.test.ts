import { expect, test } from 'vitest';
import { peakRate } from './peakRate';

test('empty input has no peak', () => {
  expect(peakRate([])).toBeNull();
});

test('a single telegram is a peak of one', () => {
  expect(peakRate([5000])).toEqual({ count: 1, startIdx: 0 });
});

test('finds the densest second and where it starts', () => {
  //            0     1     2     3     4     5     6
  const t = [0, 400, 3000, 3100, 3200, 3999, 9000];
  expect(peakRate(t)).toEqual({ count: 4, startIdx: 2 });
});

test('the window is half-open: exactly one window apart does not count together', () => {
  expect(peakRate([0, 1000])).toEqual({ count: 1, startIdx: 0 });
  expect(peakRate([0, 999])).toEqual({ count: 2, startIdx: 0 });
});

test('works on newest-first input and reports the index in that order', () => {
  const t = [9000, 3999, 3200, 3100, 3000, 400, 0];
  expect(peakRate(t)).toEqual({ count: 4, startIdx: 4 });
});

test('works on input sorted by another column', () => {
  const t = [3100, 9000, 0, 3999, 3000, 400, 3200];
  expect(peakRate(t)).toEqual({ count: 4, startIdx: 4 });
});

test('ties keep the earliest burst', () => {
  expect(peakRate([0, 100, 5000, 5100])).toEqual({ count: 2, startIdx: 0 });
  expect(peakRate([5100, 5000, 100, 0])).toEqual({ count: 2, startIdx: 3 });
});

test('identical timestamps all count', () => {
  expect(peakRate([7, 7, 7])).toEqual({ count: 3, startIdx: 0 });
});

test('honours a custom window', () => {
  expect(peakRate([0, 30_000, 59_999, 120_000], 60_000)).toEqual({ count: 3, startIdx: 0 });
});
