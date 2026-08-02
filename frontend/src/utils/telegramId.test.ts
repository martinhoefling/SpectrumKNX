import { describe, it, expect } from 'vitest';
import { telegramId, telegramTs, toEntry } from './telegramId';
import { makeTelegram } from '../test/telegramFactory';

describe('telegramId', () => {
  it('derives a stable id from timestamp, addresses and payload', () => {
    const t = makeTelegram();
    expect(telegramId(t)).toBe('2024-01-01T10:00:00.000000Z|1.2.3|1/2/3|01');
    expect(telegramId(t)).toBe(telegramId(makeTelegram()));
  });

  it('distinguishes telegrams differing only in payload at the same instant', () => {
    const a = makeTelegram({ raw_data: '01' });
    const b = makeTelegram({ raw_data: '00' });
    expect(telegramId(a)).not.toBe(telegramId(b));
  });

  it('treats a missing payload as empty', () => {
    const t = makeTelegram({ raw_data: null });
    expect(telegramId(t)).toBe('2024-01-01T10:00:00.000000Z|1.2.3|1/2/3|');
  });

  it('parses the epoch-ms timestamp', () => {
    const t = makeTelegram({ timestamp: '2024-01-01T00:00:01.000Z' });
    expect(telegramTs(t)).toBe(Date.parse('2024-01-01T00:00:01.000Z'));
  });

  it('wraps a telegram into an entry', () => {
    const t = makeTelegram();
    const entry = toEntry(t);
    expect(entry.telegram).toBe(t);
    expect(entry.id).toBe(telegramId(t));
    expect(entry.ts).toBe(telegramTs(t));
  });
});
