import type { Telegram } from '../hooks/useWebSocket';
import { toEntry, type TelegramEntry } from '../utils/telegramId';

/** Creates a mock telegram for tests; addresses default to a unique-ish key. */
export function makeTelegram(overrides: Partial<Telegram> = {}): Telegram {
  return {
    timestamp: '2024-01-01T10:00:00.000000Z',
    source_address: '1.2.3',
    source_name: 'Test Source',
    target_address: '1/2/3',
    target_name: 'Test Light',
    direction: 'Incoming',
    telegram_type: 'GroupValueWrite',
    simplified_type: 'Write',
    dpt: '1.001',
    dpt_main: 1,
    dpt_sub: 1,
    dpt_name: 'Switch',
    unit: null,
    value_numeric: 1,
    value_json: null,
    value_formatted: 'On',
    raw_data: '01',
    raw_hex: '0x01',
    ...overrides,
  };
}

/** A TelegramEntry with the given timestamp and a distinguishing key. */
export function makeEntry(timestamp: string, key = '1'): TelegramEntry {
  return toEntry(
    makeTelegram({
      timestamp,
      source_address: `1.2.${key}`,
      target_address: `1/2/${key}`,
    }),
  );
}

/** Multiple entries with incremental timestamps, 1 second apart. */
export function makeEntries(count: number, baseTime = '2024-01-01T10:00:00.000Z'): TelegramEntry[] {
  const base = new Date(baseTime).getTime();
  return Array.from({ length: count }, (_, i) =>
    makeEntry(new Date(base + i * 1000).toISOString(), String(i)),
  );
}
