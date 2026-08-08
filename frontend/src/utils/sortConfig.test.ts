import { describe, it, expect, beforeEach } from 'vitest';
import {
  readSortConfigPref, writeSortConfigPref, toggleSortLevel, sortTelegrams, effectiveSortLevels,
  type SortConfig,
} from './sortConfig';
import type { Telegram } from '../hooks/useWebSocket';

function telegram(overrides: Partial<Telegram>): Telegram {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    source_address: '1.1.1',
    source_name: null,
    target_address: '1/1/1',
    target_name: null,
    telegram_type: 'GroupValueWrite',
    simplified_type: 'Write',
    direction: 'Incoming',
    dpt: '1.001',
    dpt_main: 1,
    dpt_sub: 1,
    dpt_name: '1.001 - Switch',
    value_numeric: 1,
    value_json: null,
    value_formatted: 'On',
    unit: null,
    raw_data: '01',
    raw_hex: '01',
    ...overrides,
  } as Telegram;
}

describe('toggleSortLevel', () => {
  it('plain click replaces the whole config with a single desc level', () => {
    const config: SortConfig = [{ key: 'source_address', direction: 'asc' }];
    expect(toggleSortLevel(config, 'target_address', false)).toEqual([{ key: 'target_address', direction: 'desc' }]);
  });

  it('plain click on the sole existing level toggles its direction', () => {
    const config: SortConfig = [{ key: 'timestamp', direction: 'desc' }];
    expect(toggleSortLevel(config, 'timestamp', false)).toEqual([{ key: 'timestamp', direction: 'asc' }]);
  });

  it('plain click when multiple levels are active collapses to a single new level', () => {
    const config: SortConfig = [{ key: 'source_address', direction: 'asc' }, { key: 'target_address', direction: 'desc' }];
    expect(toggleSortLevel(config, 'target_address', false)).toEqual([{ key: 'target_address', direction: 'desc' }]);
  });

  it('additive click appends a new deepest level', () => {
    const config: SortConfig = [{ key: 'source_address', direction: 'asc' }];
    expect(toggleSortLevel(config, 'target_address', true)).toEqual([
      { key: 'source_address', direction: 'asc' },
      { key: 'target_address', direction: 'desc' },
    ]);
  });

  it('additive click on an already-explicit level toggles its direction in place', () => {
    const config: SortConfig = [
      { key: 'source_address', direction: 'asc' },
      { key: 'target_address', direction: 'desc' },
    ];
    expect(toggleSortLevel(config, 'target_address', true)).toEqual([
      { key: 'source_address', direction: 'asc' },
      { key: 'target_address', direction: 'asc' },
    ]);
  });
});

describe('effectiveSortLevels', () => {
  it('appends an implicit trailing TIME tiebreaker when TIME is not explicit', () => {
    const config: SortConfig = [{ key: 'source_address', direction: 'asc' }];
    expect(effectiveSortLevels(config)).toEqual([
      { key: 'source_address', direction: 'asc' },
      { key: 'timestamp', direction: 'desc' },
    ]);
  });

  it('does not duplicate TIME when already explicit', () => {
    const config: SortConfig = [{ key: 'source_address', direction: 'asc' }, { key: 'timestamp', direction: 'asc' }];
    expect(effectiveSortLevels(config)).toEqual(config);
  });
});

describe('sortTelegrams', () => {
  it('sorts by a single level (timestamp desc, the default)', () => {
    const items = [
      telegram({ timestamp: '2026-01-01T00:00:01.000Z', target_address: '1/1/1' }),
      telegram({ timestamp: '2026-01-01T00:00:03.000Z', target_address: '1/1/2' }),
      telegram({ timestamp: '2026-01-01T00:00:02.000Z', target_address: '1/1/3' }),
    ];
    const sorted = sortTelegrams(items, [{ key: 'timestamp', direction: 'desc' }]);
    expect(sorted.map(t => t.target_address)).toEqual(['1/1/2', '1/1/3', '1/1/1']);
  });

  it('applies multiple levels in order, with TIME as the implicit deepest tiebreaker', () => {
    const items = [
      telegram({ source_address: '1.1.2', timestamp: '2026-01-01T00:00:02.000Z' }),
      telegram({ source_address: '1.1.1', timestamp: '2026-01-01T00:00:03.000Z' }),
      telegram({ source_address: '1.1.1', timestamp: '2026-01-01T00:00:01.000Z' }),
    ];
    // Primary: source ascending. Secondary (implicit): time descending (default).
    const sorted = sortTelegrams(items, [{ key: 'source_address', direction: 'asc' }]);
    expect(sorted.map(t => `${t.source_address}@${t.timestamp}`)).toEqual([
      '1.1.1@2026-01-01T00:00:03.000Z',
      '1.1.1@2026-01-01T00:00:01.000Z',
      '1.1.2@2026-01-01T00:00:02.000Z',
    ]);
  });

  it('does not mutate the input array', () => {
    const items = [telegram({ target_address: '1/1/2' }), telegram({ target_address: '1/1/1' })];
    const original = [...items];
    sortTelegrams(items, [{ key: 'target_address', direction: 'asc' }]);
    expect(items).toEqual(original);
  });
});

describe('readSortConfigPref / writeSortConfigPref', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to a single timestamp-desc level when nothing is stored', () => {
    expect(readSortConfigPref()).toEqual([{ key: 'timestamp', direction: 'desc' }]);
  });

  it('round-trips a multi-level config', () => {
    const config: SortConfig = [{ key: 'source_address', direction: 'asc' }, { key: 'timestamp', direction: 'desc' }];
    writeSortConfigPref(config);
    expect(readSortConfigPref()).toEqual(config);
  });

  it('transparently upgrades the pre-#311 single-level object shape', () => {
    localStorage.setItem('spectrum-knx.sortConfig', JSON.stringify({ key: 'target_address', direction: 'asc' }));
    expect(readSortConfigPref()).toEqual([{ key: 'target_address', direction: 'asc' }]);
  });

  it('falls back to the default on malformed stored data', () => {
    localStorage.setItem('spectrum-knx.sortConfig', 'not json');
    expect(readSortConfigPref()).toEqual([{ key: 'timestamp', direction: 'desc' }]);
  });
});
