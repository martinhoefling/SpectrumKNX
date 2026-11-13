import { describe, expect, test } from 'vitest';
import { buildWriteDptOptions, COMMON_DPTS } from './dpt';

describe('buildWriteDptOptions', () => {
  test('seeds common subtypes and bare main types when the catalog is empty', () => {
    const keys = buildWriteDptOptions().map(o => o.key);
    for (const key of COMMON_DPTS) expect(keys).toContain(key);
    // Bare Haupttypen sit before their subtypes.
    expect(keys).toContain('1');
    expect(keys).toContain('5');
    expect(keys).toContain('9');
    expect(keys.indexOf('5')).toBeLessThan(keys.indexOf('5.001'));
    expect(keys.indexOf('9')).toBeLessThan(keys.indexOf('9.001'));
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
    expect(byKey['5']).toMatch(/subtypes/i);
    expect(byKey['9']).toMatch(/subtypes/i);
  });

  test('adds extras that are missing from the catalog', () => {
    const options = buildWriteDptOptions([], [{ main: 9, sub: 20 }]);
    expect(options.some(o => o.key === '9.020')).toBe(true);
    expect(options.some(o => o.key === '9')).toBe(true);
  });
});
