import { describe, expect, test } from 'vitest';
import { activeQuickFilter } from './quickFilter';
import { expandWithDeltaContext } from './deltaContextExpansion';
import { anchorKey } from './anchorKey';
import { makeTelegram } from '../test/telegramFactory';

const TELEGRAMS = [
  makeTelegram({ timestamp: '2024-01-01T10:00:00.000Z', target_address: '1/0/1', target_name: 'EG Licht' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:00.500Z', target_address: '2/0/1', target_name: 'OG Jalousie' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:05.000Z', target_address: '3/0/1', target_name: 'OG Heizung' }),
];

describe('activeQuickFilter', () => {
  test('is null while the bar is closed, disabled or empty', () => {
    const patterns = { target: { top: '', bottom: 'EG' } };
    expect(activeQuickFilter(false, true, patterns)).toBeNull();
    expect(activeQuickFilter(true, false, patterns)).toBeNull();
    expect(activeQuickFilter(true, true, {})).toBeNull();
    expect(activeQuickFilter(true, true, { delta: { top: '100', bottom: '' } })).toBeNull();
  });

  test('quick-filter matches anchor the Time-Delta-Context window (#520)', () => {
    const quick = activeQuickFilter(true, true, { target: { top: '', bottom: '^EG' } })!;
    const matches = TELEGRAMS.map(quick);
    const { items, contextKeys } = expandWithDeltaContext(TELEGRAMS, matches, anchorKey, new Set(), 1000, 1000);
    expect(items.map(t => t.target_name)).toEqual(['EG Licht', 'OG Jalousie']);
    expect([...contextKeys]).toEqual([anchorKey(TELEGRAMS[1])]);
  });
});
