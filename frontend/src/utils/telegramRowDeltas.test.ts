import { describe, expect, it } from 'vitest';
import { buildTelegramRows, patchTelegramRows, timestampBounds } from './telegramRowDeltas';

interface Stamp {
  timestamp: string;
  id: string;
}

const at = (ms: number, id: string): Stamp => ({ timestamp: new Date(ms).toISOString(), id });

describe('timestampBounds', () => {
  it('reads the endpoints of a time-sorted list without spreading into Math.min', () => {
    const n = 200_000;
    const items = new Array<Stamp>(n);
    for (let i = 0; i < n; i++) items[i] = at(n - i, String(i));
    expect(timestampBounds(items, 'desc')).toEqual({ minTs: 1, maxTs: n });
  });

  it('scans an unsorted list when there is no time direction', () => {
    const items = [at(5, 'a'), at(1, 'b'), at(9, 'c')];
    expect(timestampBounds(items, null)).toEqual({ minTs: 1, maxTs: 9 });
  });
});

describe('patchTelegramRows', () => {
  it('keeps the untouched middle rows and matches a full rebuild', () => {
    const prev = [at(50, 'e'), at(40, 'd'), at(30, 'c'), at(20, 'b'), at(10, 'a')];
    const prevRows = buildTelegramRows(prev, 'desc');
    const newer = at(60, 'f');
    const next = [newer, prev[0], prev[1], prev[2], prev[3]];
    const patched = patchTelegramRows(next, prevRows, {
      prev,
      prevFrom: 0,
      dest: 1,
      keep: 4,
    }, 'desc');
    const full = buildTelegramRows(next, 'desc');
    expect(patched).not.toBeNull();
    expect(patched!.map(r => [r.id, r.deltaStr, r.deltaNextStr, r.deltaMs])).toEqual(
      full.map(r => [r.id, r.deltaStr, r.deltaNextStr, r.deltaMs]),
    );
    expect(patched![2]).toBe(prevRows[1]);
    expect(patched![3]).toBe(prevRows[2]);
    expect(patched![0]).not.toBe(prevRows[0]);
    expect(patched![1]).not.toBe(prevRows[0]);
  });
});
