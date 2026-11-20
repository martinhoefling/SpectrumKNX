import { describe, expect, test } from 'vitest';
import {
  actionableMarkedKeysFrom,
  addMarkReason,
  clearAllMarks,
  clearHiddenReasons,
  clearNonHiddenReasons,
  hasMarkReason,
  hiddenKeysFrom,
  isMarked,
  isOnlyContextMark,
  markedKeysFrom,
  removeMarkReason,
  setSoleMarkReason,
  syncAutoMarkReason,
  syncContextMarkReasons,
  toggleMarkReason,
  visibleMarkedKeysFrom,
  type MarkReasonsMap,
} from './markReasons';

describe('markReasons', () => {
  test('add / remove / toggle reasons per key', () => {
    let map: MarkReasonsMap = {};
    map = addMarkReason(map, 'a', 'mouse');
    expect(isMarked(map, 'a')).toBe(true);
    expect(hasMarkReason(map, 'a', 'mouse')).toBe(true);

    map = addMarkReason(map, 'a', 'manual');
    expect(map.a).toEqual(['mouse', 'manual']);

    map = toggleMarkReason(map, 'a', 'manual');
    expect(hasMarkReason(map, 'a', 'manual')).toBe(false);
    expect(hasMarkReason(map, 'a', 'mouse')).toBe(true);

    map = removeMarkReason(map, 'a', 'mouse');
    expect(isMarked(map, 'a')).toBe(false);
    expect(markedKeysFrom(map)).toEqual([]);
  });

  test('setSoleMarkReason moves a reason without wiping other reasons', () => {
    let map: MarkReasonsMap = { a: ['mouse', 'manual'], b: ['goto'] };
    map = setSoleMarkReason(map, 'mouse', ['b']);
    expect(hasMarkReason(map, 'a', 'mouse')).toBe(false);
    expect(hasMarkReason(map, 'a', 'manual')).toBe(true);
    expect(hasMarkReason(map, 'b', 'mouse')).toBe(true);
    expect(hasMarkReason(map, 'b', 'goto')).toBe(true);
  });

  test('syncContextMarkReasons mirrors the context key set', () => {
    let map: MarkReasonsMap = { a: ['context'], b: ['manual'] };
    map = syncContextMarkReasons(map, new Set(['b', 'c']));
    expect(hasMarkReason(map, 'a', 'context')).toBe(false);
    expect(isMarked(map, 'a')).toBe(false);
    expect(hasMarkReason(map, 'b', 'context')).toBe(true);
    expect(hasMarkReason(map, 'b', 'manual')).toBe(true);
    expect(hasMarkReason(map, 'c', 'context')).toBe(true);
  });

  test('syncAutoMarkReason keeps auto only on the latest key without manual', () => {
    let map: MarkReasonsMap = { a: ['mouse', 'auto'], b: ['manual'] };
    map = syncAutoMarkReason(map, 'b');
    expect(hasMarkReason(map, 'a', 'auto')).toBe(false);
    expect(hasMarkReason(map, 'b', 'auto')).toBe(false);
    expect(hasMarkReason(map, 'b', 'manual')).toBe(true);

    map = syncAutoMarkReason(map, 'c');
    expect(hasMarkReason(map, 'c', 'auto')).toBe(true);
    expect(hasMarkReason(map, 'b', 'manual')).toBe(true);

    map = syncAutoMarkReason(map, null);
    expect(hasMarkReason(map, 'c', 'auto')).toBe(false);
  });

  test('clearAllMarks empties the map', () => {
    expect(clearAllMarks({ a: ['mouse'], b: ['goto'] })).toEqual({});
  });

  test('visible vs hidden mark keys', () => {
    const map: MarkReasonsMap = {
      a: ['context'],
      b: ['manual'],
      c: ['context', 'mouse'],
      d: ['hidden'],
      e: ['manual', 'hidden'],
    };
    expect(visibleMarkedKeysFrom(map).sort()).toEqual(['a', 'b', 'c']);
    expect(actionableMarkedKeysFrom(map).sort()).toEqual(['a', 'b', 'c']);
    expect(hiddenKeysFrom(map).sort()).toEqual(['d', 'e']);
    expect(isOnlyContextMark(map, 'a')).toBe(true);
    expect(isOnlyContextMark(map, 'c')).toBe(false);
  });

  test('clearNonHiddenReasons keeps only hidden; clearHiddenReasons drops it', () => {
    const map: MarkReasonsMap = {
      a: ['mouse', 'hidden'],
      b: ['manual'],
      c: ['hidden'],
    };
    expect(clearNonHiddenReasons(map)).toEqual({ a: ['hidden'], c: ['hidden'] });
    expect(clearHiddenReasons(map)).toEqual({ a: ['mouse'], b: ['manual'] });
  });
});
