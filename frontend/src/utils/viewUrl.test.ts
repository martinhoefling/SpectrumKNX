import { describe, expect, test } from 'vitest';
import { buildViewUrl, formatRel, parseViewUrl } from './viewUrl';
import { DEFAULT_FILTERS } from '../types/filters';

describe('parseViewUrl', () => {
  test('returns null without view=viz', () => {
    expect(parseViewUrl('')).toBeNull();
    expect(parseViewUrl('?plot=1/2/3&rel=24h')).toBeNull();
  });

  test('returns null without a usable range', () => {
    expect(parseViewUrl('?view=viz&plot=1/2/3')).toBeNull();
    expect(parseViewUrl('?view=viz&rel=abc')).toBeNull();
    expect(parseViewUrl('?view=viz&rel=0h')).toBeNull();
  });

  test('parses a relative view with filters', () => {
    const v = parseViewUrl('?view=viz&plot=1/2/3,1/2/4&src=1.1.5&tgt=1/2/3&type=Write&dpt=1,9&before=500&after=1000&rel=24h&limit=5000');
    expect(v).not.toBeNull();
    expect(v!.plot).toEqual(['1/2/3', '1/2/4']);
    expect(v!.range).toEqual({ kind: 'relative', seconds: 86400 });
    expect(v!.filters.sources).toEqual(['1.1.5']);
    expect(v!.filters.targets).toEqual(['1/2/3']);
    expect(v!.filters.types).toEqual(['Write']);
    expect(v!.filters.dpts).toEqual([1, 9]);
    expect(v!.filters.deltaBeforeMs).toBe(500);
    expect(v!.filters.deltaAfterMs).toBe(1000);
    expect(v!.limit).toBe(5000);
    expect(v!.embed).toBe(false);
  });

  test('parses an absolute view and embed options', () => {
    const v = parseViewUrl('?view=viz&start=2026-01-01T00:00&end=2026-01-02T00:00&embed=1&refresh=60&theme=dark');
    expect(v!.range).toEqual({ kind: 'absolute', startTime: '2026-01-01T00:00', endTime: '2026-01-02T00:00' });
    expect(v!.embed).toBe(true);
    expect(v!.refresh).toBe(60);
    expect(v!.theme).toBe('dark');
  });

  test('parses OR source/target relation', () => {
    const v = parseViewUrl('?view=viz&rel=1h&src=1.1.5&tgt=1/2/3&rel_st=OR');
    expect(v!.filters.sourceTargetRelation).toBe('OR');
  });
});

describe('buildViewUrl', () => {
  test('round-trips through parseViewUrl', () => {
    const state = {
      plot: ['1/2/3', '4/5/6'],
      filters: {
        ...DEFAULT_FILTERS,
        sources: ['1.1.5'],
        targets: ['1/2/3'],
        types: ['Write', 'Response'],
        dpts: [9],
        deltaBeforeMs: 250,
        deltaAfterMs: 0,
        sourceTargetRelation: 'OR' as const,
      },
      range: { kind: 'relative' as const, seconds: 6 * 3600 },
      limit: 10000,
    };
    const url = buildViewUrl(state);
    const parsed = parseViewUrl(url.slice(url.indexOf('?')));
    expect(parsed).not.toBeNull();
    expect(parsed!.plot).toEqual(state.plot);
    expect(parsed!.filters).toEqual(state.filters);
    expect(parsed!.range).toEqual(state.range);
    expect(parsed!.limit).toBe(state.limit);
  });

  test('omits defaults for a minimal view', () => {
    const url = buildViewUrl({
      plot: ['1/2/3'],
      filters: DEFAULT_FILTERS,
      range: { kind: 'relative', seconds: 3600 },
    });
    expect(url).toContain('view=viz');
    expect(url).toContain('rel=1h');
    expect(url).not.toContain('src=');
    expect(url).not.toContain('before=');
    expect(url).not.toContain('limit=');
    expect(url).not.toContain('rel_st=');
  });

  test('absolute ranges keep datetime-local strings', () => {
    const url = buildViewUrl({
      plot: [],
      filters: DEFAULT_FILTERS,
      range: { kind: 'absolute', startTime: '2026-01-01T00:00', endTime: '' },
    });
    const parsed = parseViewUrl(url.slice(url.indexOf('?')));
    expect(parsed!.range).toEqual({ kind: 'absolute', startTime: '2026-01-01T00:00', endTime: '' });
  });
});

describe('formatRel', () => {
  test('picks the largest evenly-dividing unit', () => {
    expect(formatRel(86400)).toBe('1d');
    expect(formatRel(7 * 86400)).toBe('7d');
    expect(formatRel(6 * 3600)).toBe('6h');
    expect(formatRel(90 * 60)).toBe('90m');
    expect(formatRel(45)).toBe('45s');
  });
});
