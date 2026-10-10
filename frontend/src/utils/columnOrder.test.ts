import { expect, test, beforeEach } from 'vitest';
import { moveColumn, normalizeColumnOrder, readColumnOrderPref, writeColumnOrderPref } from './columnOrder';

const DEFAULTS = ['time', 'delta', 'source', 'target', 'type', 'dpt', 'value'];

beforeEach(() => localStorage.clear());

test('moves a column before or after another', () => {
  expect(moveColumn(DEFAULTS, 'target', 'source', 'before')).toEqual(['time', 'delta', 'target', 'source', 'type', 'dpt', 'value']);
  expect(moveColumn(DEFAULTS, 'time', 'value', 'after')).toEqual(['delta', 'source', 'target', 'type', 'dpt', 'value', 'time']);
  expect(moveColumn(DEFAULTS, 'value', 'time', 'before')).toEqual(['value', 'time', 'delta', 'source', 'target', 'type', 'dpt']);
  expect(moveColumn(DEFAULTS, 'source', 'dpt', 'after')).toEqual(['time', 'delta', 'target', 'type', 'dpt', 'source', 'value']);
});

test('dropping a column where it already is changes nothing', () => {
  expect(moveColumn(DEFAULTS, 'source', 'target', 'before')).toEqual(DEFAULTS);
  expect(moveColumn(DEFAULTS, 'target', 'source', 'after')).toEqual(DEFAULTS);
  expect(moveColumn(DEFAULTS, 'source', 'source', 'before')).toEqual(DEFAULTS);
  expect(moveColumn(DEFAULTS, 'nope', 'source', 'before')).toEqual(DEFAULTS);
});

test('a stored order survives changes to the column set', () => {
  // unknown id dropped, duplicate collapsed
  expect(normalizeColumnOrder(['value', 'gone', 'time', 'value', 'delta', 'source', 'target', 'type', 'dpt'], DEFAULTS))
    .toEqual(['value', 'time', 'delta', 'source', 'target', 'type', 'dpt']);
  // a column the stored order has never seen goes after its default predecessor:
  // delta after time, type after target, dpt after type
  expect(normalizeColumnOrder(['value', 'target', 'source', 'time'], DEFAULTS))
    .toEqual(['value', 'target', 'type', 'dpt', 'source', 'time', 'delta']);
  // garbage falls back to the defaults
  expect(normalizeColumnOrder('nonsense', DEFAULTS)).toEqual(DEFAULTS);
  expect(normalizeColumnOrder(null, DEFAULTS)).toEqual(DEFAULTS);
});

test('the order round-trips through the stored preference', () => {
  expect(readColumnOrderPref(DEFAULTS)).toEqual(DEFAULTS);
  const moved = moveColumn(DEFAULTS, 'target', 'source', 'before');
  writeColumnOrderPref(moved);
  expect(readColumnOrderPref(DEFAULTS)).toEqual(moved);
  localStorage.setItem('spectrum-knx.columnOrder', '{not json');
  expect(readColumnOrderPref(DEFAULTS)).toEqual(DEFAULTS);
});
