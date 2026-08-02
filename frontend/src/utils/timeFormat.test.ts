import { describe, expect, test } from 'vitest';
import { spansMultipleDays, formatAxisTime, formatFullTime } from './timeFormat';

// Use fixed local-time instants so assertions don't depend on the runner's tz
// beyond what the formatters themselves use.
const t = (s: string) => new Date(s).getTime();

describe('spansMultipleDays', () => {
  test('false within a single calendar day', () => {
    expect(spansMultipleDays(t('2026-07-18T00:05:00'), t('2026-07-18T23:55:00'))).toBe(false);
  });

  test('true across a midnight boundary', () => {
    expect(spansMultipleDays(t('2026-07-18T23:00:00'), t('2026-07-19T01:00:00'))).toBe(true);
  });
});

describe('formatAxisTime', () => {
  test('time only on single-day ranges', () => {
    const s = formatAxisTime(t('2026-07-18T14:30:00'), false);
    expect(s).toBe('14:30');
  });

  test('prefixes a MM-DD date on multi-day ranges', () => {
    const s = formatAxisTime(t('2026-07-18T14:30:00'), true);
    // Locale can vary, but the time part and both date fields must be present.
    expect(s).toContain('14:30');
    expect(s).toMatch(/\b07\b/);
    expect(s).toMatch(/\b18\b/);
    expect(s.length).toBeGreaterThan('14:30'.length);
  });
});

describe('formatFullTime', () => {
  test('HH:mm:ss on single-day ranges', () => {
    expect(formatFullTime(t('2026-07-18T14:30:15'), false)).toBe('14:30:15');
  });

  test('includes year and seconds on multi-day ranges', () => {
    const s = formatFullTime(t('2026-07-18T14:30:15'), true);
    expect(s).toContain('14:30:15');
    expect(s).toContain('2026');
  });
});
