import type { Telegram } from '../hooks/useWebSocket';

/**
 * A telegram wrapped with its client-side identity, as handled by the caching
 * services (#246): a stable `id` for deduplication and the epoch-ms timestamp
 * for chronological ordering and coverage bookkeeping.
 */
export interface TelegramEntry {
  id: string;
  /** Epoch milliseconds parsed from the telegram's ISO timestamp. */
  ts: number;
  telegram: Telegram;
}

/**
 * Derives a stable client-side id — the backend does not expose one (#246).
 * Timestamps carry microsecond precision, so collisions require two identical
 * telegrams within the same microsecond; strictly finer than the previous
 * timestamp-only dedup.
 */
export const telegramId = (t: Telegram): string =>
  `${t.timestamp}|${t.source_address}|${t.target_address}|${t.raw_data ?? ''}`;

export const telegramTs = (t: Telegram): number => new Date(t.timestamp).getTime();

export const toEntry = (telegram: Telegram): TelegramEntry => ({
  id: telegramId(telegram),
  ts: telegramTs(telegram),
  telegram,
});
