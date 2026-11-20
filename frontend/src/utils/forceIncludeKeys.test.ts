import { describe, expect, it } from 'vitest';
import { forceIncludeKeys } from './forceIncludeKeys';

const keyOf = (t: { id: string }) => t.id;

describe('forceIncludeKeys', () => {
  const all = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('returns filtered when nothing is forced', () => {
    const filtered = [all[0], all[2]];
    expect(forceIncludeKeys(all, filtered, keyOf, new Set())).toBe(filtered);
  });

  it('returns filtered when forced keys are already present', () => {
    const filtered = [all[0], all[2]];
    expect(forceIncludeKeys(all, filtered, keyOf, new Set(['a', 'c']))).toBe(filtered);
  });

  it('reinserts missing forced keys in buffer order', () => {
    const filtered = [all[0], all[2]];
    expect(forceIncludeKeys(all, filtered, keyOf, new Set(['b', 'd']))).toEqual([
      all[0], all[1], all[2], all[3],
    ]);
  });

  it('ignores forced keys absent from the buffer', () => {
    const filtered = [all[0]];
    expect(forceIncludeKeys(all, filtered, keyOf, new Set(['gone', 'b']))).toEqual([
      all[0], all[1],
    ]);
  });
});
