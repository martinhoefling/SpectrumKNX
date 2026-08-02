import { beforeEach, describe, expect, test } from 'vitest';
import { loadRecentGas, pushRecentGa } from './recentGas';

describe('recentGas', () => {
  beforeEach(() => localStorage.clear());

  test('starts empty and records sends newest-first', () => {
    expect(loadRecentGas()).toEqual([]);
    pushRecentGa('1/2/3');
    pushRecentGa('4/5/6');
    expect(loadRecentGas()).toEqual(['4/5/6', '1/2/3']);
  });

  test('re-sending moves the address to the front without duplicating', () => {
    pushRecentGa('1/2/3');
    pushRecentGa('4/5/6');
    pushRecentGa('1/2/3');
    expect(loadRecentGas()).toEqual(['1/2/3', '4/5/6']);
  });

  test('keeps at most 10 entries', () => {
    for (let i = 0; i < 15; i++) pushRecentGa(`1/1/${i}`);
    const recents = loadRecentGas();
    expect(recents).toHaveLength(10);
    expect(recents[0]).toBe('1/1/14');
  });

  test('tolerates corrupt storage', () => {
    localStorage.setItem('spectrumknx-recent-send-gas', 'not json');
    expect(loadRecentGas()).toEqual([]);
  });
});
