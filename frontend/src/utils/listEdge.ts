/**
 * A published telegram list replaced by editing the previous one in place:
 * `next` is `prev` with a contiguous run copied across and new rows only
 * outside that run. Live follow and pause-buffer portions are this shape
 * (newest-first: a short head prepend plus a tail drop), so callers can skip
 * the full-buffer sort, filter, and row rebuild.
 *
 * The previous list hangs off the newest array only. Tagging the successor
 * clears the predecessor's edge so the snapshots do not chain.
 */

const EDGE: unique symbol = Symbol('listEdge');

export interface ListEdge<T> {
  prev: readonly T[];
  /** Index in `prev` where the copied run starts. */
  prevFrom: number;
  /** Index in the next list where that run lands. */
  dest: number;
  keep: number;
}

type Edged<T> = { [EDGE]?: ListEdge<T> };

export function tagListEdge<T>(
  next: T[],
  prev: readonly T[],
  prevFrom: number,
  dest: number,
  keep: number,
): T[] {
  const edge: ListEdge<T> = { prev, prevFrom, dest, keep };
  Object.defineProperty(next, EDGE, {
    value: edge,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  // Symbol keys are invisible to hasOwnProperty. Drop the predecessor's edge
  // so published snapshots do not keep every previous buffer alive.
  delete (prev as Edged<T>)[EDGE];
  return next;
}

export function readListEdge<T>(list: readonly T[]): ListEdge<T> | null {
  const edge = (list as Edged<T>)[EDGE];
  return edge ?? null;
}

/** Rows inserted in front of / behind the copied run, and rows that fell off `prev`. */
export function edgeMembers<T>(next: readonly T[], edge: ListEdge<T>): { added: T[]; removed: T[] } {
  const added: T[] = [];
  for (let i = 0; i < edge.dest; i++) added.push(next[i]);
  for (let i = edge.dest + edge.keep; i < next.length; i++) added.push(next[i]);
  const removed: T[] = [];
  for (let i = 0; i < edge.prevFrom; i++) removed.push(edge.prev[i]);
  for (let i = edge.prevFrom + edge.keep; i < edge.prev.length; i++) removed.push(edge.prev[i]);
  return { added, removed };
}
