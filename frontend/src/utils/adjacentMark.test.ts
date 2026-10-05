import { expect, test } from 'vitest';
import { adjacentMark } from './adjacentMark';

const marks = [2, 9, 30];

test('next goes to the nearest mark after the current row', () => {
  expect(adjacentMark(marks, 0, 1)).toBe(2);
  expect(adjacentMark(marks, 2, 1)).toBe(9);
  expect(adjacentMark(marks, 10, 1)).toBe(30);
});

test('previous goes to the nearest mark before the current row', () => {
  expect(adjacentMark(marks, 30, -1)).toBe(9);
  expect(adjacentMark(marks, 9, -1)).toBe(2);
  expect(adjacentMark(marks, 5, -1)).toBe(2);
});

test('both directions wrap around', () => {
  expect(adjacentMark(marks, 30, 1)).toBe(2);
  expect(adjacentMark(marks, 35, 1)).toBe(2);
  expect(adjacentMark(marks, 2, -1)).toBe(30);
  expect(adjacentMark(marks, 0, -1)).toBe(30);
});

test('a single mark is always the target', () => {
  expect(adjacentMark([7], 7, 1)).toBe(7);
  expect(adjacentMark([7], 7, -1)).toBe(7);
});
