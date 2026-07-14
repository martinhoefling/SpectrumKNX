import { describe, expect, test } from 'vitest';
import { DEFAULT_FILTERS, dptKey, matchesDpt, matchesTelegram } from './filters';

describe('dptKey', () => {
  test('pads the sub to three digits', () => {
    expect(dptKey(1, 1)).toBe('1.001');
    expect(dptKey(9, 21)).toBe('9.021');
    expect(dptKey(16, 100)).toBe('16.100');
  });

  test('bare main when sub is missing', () => {
    expect(dptKey(9)).toBe('9');
    expect(dptKey(9, null)).toBe('9');
  });
});

describe('matchesDpt', () => {
  test('exact subtype match only selects that subtype (#180)', () => {
    expect(matchesDpt(['1.001'], 1, 1)).toBe(true);
    expect(matchesDpt(['1.001'], 1, 8)).toBe(false);
    expect(matchesDpt(['1.001'], 1, null)).toBe(false);
    expect(matchesDpt(['1.001'], 5, 1)).toBe(false);
  });

  test('bare main matches every subtype', () => {
    expect(matchesDpt(['1'], 1, 1)).toBe(true);
    expect(matchesDpt(['1'], 1, 8)).toBe(true);
    expect(matchesDpt(['1'], 1, null)).toBe(true);
    expect(matchesDpt(['1'], 11, 1)).toBe(false);
  });

  test('telegram without a DPT never matches', () => {
    expect(matchesDpt(['1.001'], null, null)).toBe(false);
    expect(matchesDpt(['1'], undefined, undefined)).toBe(false);
  });
});

describe('matchesTelegram DPT filtering', () => {
  const telegram = {
    source_address: '1.1.1',
    target_address: '1/2/3',
    simplified_type: 'Write',
    dpt_main: 1,
    dpt_sub: 8,
  };

  test('filters by sub-DPT key', () => {
    expect(matchesTelegram(telegram, { ...DEFAULT_FILTERS, dpts: ['1.008'] })).toBe(true);
    expect(matchesTelegram(telegram, { ...DEFAULT_FILTERS, dpts: ['1.001'] })).toBe(false);
    expect(matchesTelegram(telegram, { ...DEFAULT_FILTERS, dpts: ['1'] })).toBe(true);
  });
});
