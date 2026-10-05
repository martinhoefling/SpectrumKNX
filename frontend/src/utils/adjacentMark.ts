/**
 * Index of the marked row to jump to from row `from` (#442): the nearest one
 * after it (`dir` 1) or before it (`dir` -1), wrapping around at either end.
 * `markedIndices` must be ascending and non-empty.
 */
export function adjacentMark(markedIndices: number[], from: number, dir: 1 | -1): number {
  return dir === 1
    ? markedIndices.find(i => i > from) ?? markedIndices[0]
    : markedIndices.findLast(i => i < from) ?? markedIndices[markedIndices.length - 1];
}
