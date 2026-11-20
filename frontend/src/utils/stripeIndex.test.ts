import { describe, expect, it } from 'vitest';
import { tagListEdge } from './listEdge';
import { createStripeState } from './stripeIndex';

describe('createStripeState', () => {
  it('shifts indices on a prepend and leaves a second update of the same list alone', () => {
    const keyOf = (item: { id: string }) => item.id;
    const state = createStripeState<{ id: string }>();
    const first = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(state.update(first, keyOf).get('b')).toBe(1);

    const next = tagListEdge([{ id: 'd' }, first[0], first[1]], first, 0, 1, 2);
    const lookup = state.update(next, keyOf);
    expect(lookup.get('d')).toBe(0);
    expect(lookup.get('a')).toBe(1);
    expect(lookup.get('b')).toBe(2);
    expect(lookup.get('c')).toBeUndefined();
    expect(state.update(next, keyOf)).toBe(lookup);
    expect(lookup.get('a')).toBe(1);
  });
});
