import type { TelegramEntry } from '../utils/telegramId';

/**
 * In-memory telegram buffer with ring-buffer behavior, ported from the
 * Home Assistant knx-frontend Group Monitor (#246).
 *
 * - Chronological insertion with a fast-path append for live telegrams.
 * - Deduplicating `merge()` for historical loads.
 * - Automatic overflow eviction of the oldest entries.
 * - Immutable `snapshot` for safe use as React state.
 */
export class TelegramBufferService {
  private _buffer: TelegramEntry[] = [];

  private _maxSize: number;

  constructor(maxSize = 2000) {
    this._maxSize = maxSize;
  }

  /**
   * Adds one or more entries, keeping the buffer sorted by timestamp.
   * Only sorts when the fast path (all newer than the current tail, and
   * themselves in order) does not apply.
   * @returns Entries removed due to buffer overflow (empty if none).
   */
  add(entries: TelegramEntry | TelegramEntry[]): TelegramEntry[] {
    const entryArray = Array.isArray(entries) ? entries : [entries];
    if (entryArray.length === 0) return [];

    const newAreSorted = entryArray.every((e, i) => i === 0 || entryArray[i - 1].ts <= e.ts);
    const lastTs = this._buffer.length > 0 ? this._buffer[this._buffer.length - 1].ts : -Infinity;

    this._buffer.push(...entryArray);
    if (!newAreSorted || entryArray[0].ts < lastTs) {
      this._buffer.sort((a, b) => a.ts - b.ts);
    }

    if (this._buffer.length > this._maxSize) {
      return this._buffer.splice(0, this._buffer.length - this._maxSize);
    }
    return [];
  }

  /**
   * Adds multiple entries, skipping ids already present.
   * @returns The unique entries actually added and any overflow evictions.
   */
  merge(newEntries: TelegramEntry[]): { added: TelegramEntry[]; removed: TelegramEntry[] } {
    const existingIds = new Set(this._buffer.map(e => e.id));
    const unique = newEntries.filter(e => !existingIds.has(e.id));
    unique.sort((a, b) => a.ts - b.ts);
    return { added: unique, removed: this.add(unique) };
  }

  /**
   * Updates the maximum size, evicting the oldest entries when shrinking.
   * @returns Entries removed by the size reduction (empty if none).
   */
  setMaxSize(size: number): TelegramEntry[] {
    this._maxSize = size;
    if (this._buffer.length > size) {
      return this._buffer.splice(0, this._buffer.length - size);
    }
    return [];
  }

  get maxSize(): number {
    return this._maxSize;
  }

  get length(): number {
    return this._buffer.length;
  }

  get isEmpty(): boolean {
    return this._buffer.length === 0;
  }

  /** Immutable copy of the buffer, oldest first. */
  get snapshot(): readonly TelegramEntry[] {
    return [...this._buffer];
  }

  /** Removes everything and returns the removed entries. */
  clear(): TelegramEntry[] {
    const cleared = [...this._buffer];
    this._buffer.length = 0;
    return cleared;
  }

  has(id: string): boolean {
    return this._buffer.some(e => e.id === id);
  }
}
