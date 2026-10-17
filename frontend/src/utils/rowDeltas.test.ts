import { expect, test } from 'vitest';
import { rowDeltas } from './rowDeltas';

test('no rows, one row', () => {
  expect(rowDeltas([], 'desc')).toEqual([]);
  expect(rowDeltas([1000], 'desc')).toEqual([{ above: null, below: null }]);
});

test('newest first: above is the younger neighbour (-), below the older one (+)', () => {
  expect(rowDeltas([9000, 5900, 5000], 'desc')).toEqual([
    { above: null, below: { ms: 3100, sign: '+' } },
    { above: { ms: 3100, sign: '-' }, below: { ms: 900, sign: '+' } },
    { above: { ms: 900, sign: '-' }, below: null },
  ]);
});

test('oldest first: above is the older neighbour (+), below the younger one (-)', () => {
  expect(rowDeltas([5000, 5900, 9000], 'asc')).toEqual([
    { above: null, below: { ms: 900, sign: '-' } },
    { above: { ms: 900, sign: '+' }, below: { ms: 3100, sign: '-' } },
    { above: { ms: 3100, sign: '+' }, below: null },
  ]);
});

test('the gap below one row is the gap above the next', () => {
  const rows = rowDeltas([100, 350, 351, 4000], 'asc');
  for (let i = 0; i < rows.length - 1; i++) expect(rows[i].below!.ms).toBe(rows[i + 1].above!.ms);
});

test('under another sort the signs follow the real order of each pair', () => {
  // display order by some other column: 5000, 9000, 1000
  expect(rowDeltas([5000, 9000, 1000], null)).toEqual([
    { above: null, below: { ms: 4000, sign: '-' } },
    { above: { ms: 4000, sign: '+' }, below: { ms: 8000, sign: '+' } },
    { above: { ms: 8000, sign: '-' }, below: null },
  ]);
});

test('equal timestamps: no gap that would point past either end of the list', () => {
  // The two oldest share a timestamp; "+ 0" on either would claim an older telegram exists.
  const rows = rowDeltas([1000, 1000, 2000], null);
  expect(rows[0].below).toEqual({ ms: 0, sign: '-' });
  expect(rows[1].above).toBeNull();
  expect(rows[1].below).toEqual({ ms: 1000, sign: '-' });
  expect(rows[2].above).toEqual({ ms: 1000, sign: '+' });
});
