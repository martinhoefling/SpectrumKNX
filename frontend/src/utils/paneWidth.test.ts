import { expect, test } from 'vitest';
import { clampPaneWidth } from './paneWidth';

test('passes through widths inside the limits', () => {
  expect(clampPaneWidth(400, 1500)).toBe(400);
  expect(clampPaneWidth(400.6, 1500)).toBe(401);
});

test('never narrower than the minimum', () => {
  expect(clampPaneWidth(50, 1500)).toBe(220);
  expect(clampPaneWidth(-300, 1500)).toBe(220);
});

test('never wider than the maximum or 60% of the window', () => {
  expect(clampPaneWidth(2000, 2400)).toBe(720);
  expect(clampPaneWidth(2000, 1000)).toBe(600);
});

test('the minimum wins on a very narrow window', () => {
  expect(clampPaneWidth(500, 300)).toBe(220);
});
