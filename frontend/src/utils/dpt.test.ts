import { describe, expect, test } from 'vitest';
import { buildWriteDptOptions, COMMON_DPTS } from './dpt';

describe('buildWriteDptOptions', () => {
  test('seeds common types when the catalog is empty', () => {
    const keys = buildWriteDptOptions().map(o => o.key);
    expect(keys).toEqual([...COMMON_DPTS].sort((a, b) => {
      const [am, as = 0] = a.split('.').map(Number);
      const [bm, bs = 0] = b.split('.').map(Number);
      return am - bm || as - bs;
    }));
  });

  test('merges project catalog subtypes with designations', () => {
    const options = buildWriteDptOptions([
      { main: 9, sub: 1, label: '9.001 - Temperature' },
      { main: 9, sub: 5, label: '9.005 - Wind speed' },
      { main: 5, sub: 1, label: '5.001 - Percent' },
    ]);
    const byKey = Object.fromEntries(options.map(o => [o.key, o.name]));
    expect(byKey['9.001']).toBe('Temperature'); // catalog label wins over COMMON
    expect(byKey['9.005']).toBe('Wind speed');
    expect(byKey['9.004']).toBe('Illuminance (lx)'); // from COMMON_DPTS
    expect(byKey['5.001']).toBe('Percent');
  });

  test('adds extras that are missing from the catalog', () => {
    const options = buildWriteDptOptions([], [{ main: 9, sub: 20 }]);
    expect(options.some(o => o.key === '9.020')).toBe(true);
  });
});
