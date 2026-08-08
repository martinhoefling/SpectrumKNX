import { describe, it, expect } from 'vitest';
import { expandWithDeltaContext } from './deltaContextExpansion';

interface Item {
  key: string;
  timestamp: string;
}

const item = (key: string, isoTime: string): Item => ({ key, timestamp: isoTime });
const keyOf = (i: Item) => i.key;

describe('expandWithDeltaContext', () => {
  it('with no window, returns only the matching items and no context keys', () => {
    const items = [item('a', '2024-01-01T10:00:00Z'), item('b', '2024-01-01T10:00:01Z')];
    const out = expandWithDeltaContext(items, [true, false], keyOf, new Set(), 0, 0);
    expect(out.items.map(keyOf)).toEqual(['a']);
    expect(out.contextKeys).toEqual(new Set());
  });

  it('pulls in non-matching items within the before/after window of a match, tagged as context (#343)', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'),
      item('b', '2024-01-01T10:00:00.500Z'), // +500ms of a, not matching
      item('c', '2024-01-01T10:00:05.000Z'), // +5s of a, outside window
    ];
    const out = expandWithDeltaContext(items, [true, false, false], keyOf, new Set(), 0, 1000);
    expect(out.items.map(keyOf)).toEqual(['a', 'b']);
    expect(out.contextKeys).toEqual(new Set(['b']));
  });

  it('a flagged item anchors its own window even when it does not match the filter, and is not itself context', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'), // flagged, doesn't match
      item('b', '2024-01-01T10:00:00.500Z'), // near the flagged item
      item('c', '2024-01-01T10:00:10.000Z'), // far from everything
    ];
    const out = expandWithDeltaContext(items, [false, false, false], keyOf, new Set(['a']), 0, 1000);
    expect(out.items.map(keyOf)).toEqual(['a', 'b']);
    expect(out.contextKeys).toEqual(new Set(['b'])); // 'a' is flagged, not context
  });

  it('a flagged item is shown even with no window at all (before=after=0)', () => {
    const items = [item('a', '2024-01-01T10:00:00Z'), item('b', '2024-01-01T10:00:01Z')];
    const out = expandWithDeltaContext(items, [false, false], keyOf, new Set(['a']), 0, 0);
    expect(out.items.map(keyOf)).toEqual(['a']);
    expect(out.contextKeys).toEqual(new Set());
  });

  it('returns nothing when there are no matches and no flags', () => {
    const items = [item('a', '2024-01-01T10:00:00Z')];
    const out = expandWithDeltaContext(items, [false], keyOf, new Set(), 100, 100);
    expect(out.items).toEqual([]);
    expect(out.contextKeys).toEqual(new Set());
  });

  it('respects asymmetric before/after windows', () => {
    const items = [
      item('before', '2024-01-01T09:59:59.500Z'), // -500ms
      item('anchor', '2024-01-01T10:00:00.000Z'),
      item('after', '2024-01-01T10:00:00.500Z'), // +500ms
    ];
    const onlyAfter = expandWithDeltaContext(items, [false, true, false], keyOf, new Set(), 0, 1000);
    expect(onlyAfter.items.map(keyOf)).toEqual(['anchor', 'after']);
    expect(onlyAfter.contextKeys).toEqual(new Set(['after']));

    const onlyBefore = expandWithDeltaContext(items, [false, true, false], keyOf, new Set(), 1000, 0);
    expect(onlyBefore.items.map(keyOf)).toEqual(['before', 'anchor']);
    expect(onlyBefore.contextKeys).toEqual(new Set(['before']));
  });
});
