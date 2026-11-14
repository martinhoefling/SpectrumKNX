import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS } from '../types/filters';
import { makeTelegram } from '../test/telegramFactory';
import { tagListEdge } from './listEdge';
import { deriveLiveTelegramView } from './liveTelegramView';
import type { SelectVisibleOpts } from './selectVisibleTelegrams';

const opts: SelectVisibleOpts = {
  filters: DEFAULT_FILTERS,
  filtersEnabled: true,
  quickFilterOpen: false,
  quickFilterEnabled: false,
  quickPatterns: {},
  flaggedKeys: [],
  contextForAllMatches: false,
  markReasons: {},
};

const desc = [{ key: 'timestamp' as const, direction: 'desc' as const }];
const asc = [{ key: 'timestamp' as const, direction: 'asc' as const }];

const tg = (iso: string, source: string) =>
  makeTelegram({ timestamp: iso, source_address: source, raw_hex: source });

describe('deriveLiveTelegramView', () => {
  it('keeps a newest-first buffer as the sorted list and only tallies the prepend', () => {
    const older = tg('2024-01-01T10:00:01.000Z', '1.1.1');
    const mid = tg('2024-01-01T10:00:02.000Z', '1.1.2');
    const source = [mid, older];
    const first = deriveLiveTelegramView(null, source, desc, opts);
    expect(first.sorted).toBe(source);
    expect(first.items).toBe(source);

    const newer = tg('2024-01-01T10:00:03.000Z', '1.1.3');
    const next = tagListEdge([newer, mid, older], source, 0, 1, 2);
    const second = deriveLiveTelegramView(first, next, desc, opts);
    expect(second.sorted).toBe(next);
    expect(second.items).toBe(next);
    expect(second.counts.sources).toEqual({ '1.1.1': 1, '1.1.2': 1, '1.1.3': 1 });
    expect(deriveLiveTelegramView(second, next, desc, opts)).toBe(second);
  });

  it('filters only the new row and keeps the previous visible telegram', () => {
    const keep = tg('2024-01-01T10:00:01.000Z', '1.1.1');
    const filtered = {
      ...opts,
      filters: { ...DEFAULT_FILTERS, sources: ['1.1.1'] },
    };
    const first = deriveLiveTelegramView(null, [keep], desc, filtered);
    expect(first.items).toEqual([keep]);

    const dropped = tg('2024-01-01T10:00:02.000Z', '9.9.9');
    const next = tagListEdge([dropped, keep], [keep], 0, 1, 1);
    const second = deriveLiveTelegramView(first, next, desc, filtered);
    expect(second.items).toEqual([keep]);
    expect(second.items[0]).toBe(keep);
    expect(second.counts.sources['9.9.9']).toBe(1);
  });

  it('appends a newer telegram when the timestamp sort is ascending', () => {
    const older = tg('2024-01-01T10:00:01.000Z', '1.1.1');
    const mid = tg('2024-01-01T10:00:02.000Z', '1.1.2');
    const first = deriveLiveTelegramView(null, [mid, older], asc, opts);
    expect(first.sorted.map(t => t.source_address)).toEqual(['1.1.1', '1.1.2']);

    const newer = tg('2024-01-01T10:00:03.000Z', '1.1.3');
    const next = tagListEdge([newer, mid, older], [mid, older], 0, 1, 2);
    const second = deriveLiveTelegramView(first, next, asc, opts);
    expect(second.sorted.map(t => t.source_address)).toEqual(['1.1.1', '1.1.2', '1.1.3']);
    expect(second.sorted[0]).toBe(older);
    expect(second.sorted[1]).toBe(mid);
  });
});
