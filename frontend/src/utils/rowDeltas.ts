/** A gap to a neighbouring row. `+`: the neighbour is older, this telegram came
 * that long after it. `-`: the neighbour is younger, this one came before it. */
export interface RowDelta {
  ms: number;
  sign: '+' | '-';
}

export interface RowDeltas {
  /** Gap to the row displayed above; null for the first row. */
  above: RowDelta | null;
  /** Gap to the row displayed below; null for the last row. */
  below: RowDelta | null;
}

/**
 * Time gaps between each row and both of its neighbours in display order, so a
 * row can be read on its own: how long after the telegram before it, and how
 * long until the one after it. Ported from the devTabSel fork.
 *
 * Under a time sort the signs follow the sort direction (newest first: the row
 * above is younger, hence `-`; the row below is older, hence `+`). Under any
 * other sort they follow the actual order of the two timestamps. A gap is
 * dropped when its sign would point at a telegram that cannot exist — a `+`
 * on the oldest telegram of the list, a `-` on the youngest — which only
 * happens for equal timestamps under a non-time sort.
 */
export function rowDeltas(timestampsMs: number[], timeSort: 'asc' | 'desc' | null): RowDeltas[] {
  const n = timestampsMs.length;
  if (n === 0) return [];
  let oldest = Infinity, youngest = -Infinity;
  for (const t of timestampsMs) {
    if (t < oldest) oldest = t;
    if (t > youngest) youngest = t;
  }

  const gap = (curr: number, neighbour: number, sign: '+' | '-'): RowDelta | null => {
    const possible = sign === '+' ? curr > oldest : curr < youngest;
    return possible ? { ms: Math.abs(curr - neighbour), sign } : null;
  };

  return timestampsMs.map((curr, i) => {
    let above: RowDelta | null = null;
    let below: RowDelta | null = null;
    if (i > 0) {
      const prev = timestampsMs[i - 1];
      above = gap(curr, prev, timeSort ? (timeSort === 'asc' ? '+' : '-') : curr >= prev ? '+' : '-');
    }
    if (i < n - 1) {
      const next = timestampsMs[i + 1];
      below = gap(curr, next, timeSort ? (timeSort === 'asc' ? '-' : '+') : next >= curr ? '-' : '+');
    }
    return { above, below };
  });
}
