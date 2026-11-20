import { readListEdge } from './listEdge';

export interface StripeLookup {
  get(key: string): number | undefined;
}

/**
 * Pool index by telegram key. A tagged prepend shifts the base instead of
 * rebuilding the map, so a full buffer does not rehash on every portion.
 * `update` is idempotent for the same array.
 */
export function createStripeState<T>() {
  let map = new Map<string, number>();
  let base = 0;
  let pool: readonly T[] | null = null;
  let lookup: StripeLookup = { get: () => undefined };

  return {
    update(next: readonly T[], keyOf: (item: T) => string): StripeLookup {
      if (next === pool) return lookup;
      const edge = readListEdge(next);
      const canEdit = !!edge
        && edge.prev === pool
        && pool !== null
        && edge.prevFrom >= 0
        && edge.dest >= 0
        && edge.keep >= 0
        && edge.prevFrom + edge.keep <= edge.prev.length
        && edge.dest + edge.keep <= next.length;
      if (canEdit && edge) {
        base += edge.dest - edge.prevFrom;
        for (let i = 0; i < edge.prevFrom; i++) map.delete(keyOf(edge.prev[i]));
        for (let i = edge.prevFrom + edge.keep; i < edge.prev.length; i++) map.delete(keyOf(edge.prev[i]));
        for (let i = 0; i < edge.dest; i++) map.set(keyOf(next[i]), i - base);
        for (let i = edge.dest + edge.keep; i < next.length; i++) map.set(keyOf(next[i]), i - base);
      } else {
        map = new Map();
        base = 0;
        for (let i = 0; i < next.length; i++) map.set(keyOf(next[i]), i);
      }
      pool = next;
      const stored = map;
      const origin = base;
      lookup = {
        get(key: string) {
          const value = stored.get(key);
          return value === undefined ? undefined : value + origin;
        },
      };
      return lookup;
    },
  };
}
