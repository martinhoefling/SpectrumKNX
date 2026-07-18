import { describe, it, expect, beforeEach } from 'vitest';
import { TelegramBufferService } from './telegram-buffer-service';
import { makeEntry, makeEntries } from '../test/telegramFactory';
import type { TelegramEntry } from '../utils/telegramId';

describe('TelegramBufferService', () => {
  let service: TelegramBufferService;

  beforeEach(() => {
    service = new TelegramBufferService();
  });

  describe('basic operations', () => {
    it('initializes with default settings', () => {
      expect(service.maxSize).toBe(2000);
      expect(service.length).toBe(0);
      expect(service.isEmpty).toBe(true);
      expect(service.snapshot).toEqual([]);
    });

    it('adds a single entry', () => {
      const entry = makeEntry('2024-01-01T10:00:00.000Z');
      const removed = service.add(entry);

      expect(service.length).toBe(1);
      expect(service.isEmpty).toBe(false);
      expect(removed).toEqual([]);
      expect(service.snapshot[0]).toBe(entry);
    });

    it('adds multiple entries', () => {
      const entries = makeEntries(3);
      const removed = service.add(entries);

      expect(service.length).toBe(3);
      expect(removed).toEqual([]);
      expect(service.snapshot).toEqual(entries);
    });

    it('clears the buffer', () => {
      const entries = makeEntries(3);
      service.add(entries);

      const cleared = service.clear();

      expect(cleared).toEqual(entries);
      expect(service.length).toBe(0);
      expect(service.isEmpty).toBe(true);
    });

    it('reports id membership', () => {
      const entry = makeEntry('2024-01-01T10:00:00.000Z');
      service.add(entry);
      expect(service.has(entry.id)).toBe(true);
      expect(service.has('nope')).toBe(false);
    });
  });

  describe('chronological ordering', () => {
    it('maintains order when added in sequence', () => {
      const e1 = makeEntry('2024-01-01T10:00:01.000Z', '1');
      const e2 = makeEntry('2024-01-01T10:00:02.000Z', '2');
      const e3 = makeEntry('2024-01-01T10:00:03.000Z', '3');

      service.add(e1);
      service.add(e2);
      service.add(e3);

      expect(service.snapshot).toEqual([e1, e2, e3]);
    });

    it('sorts when entries are added out of order', () => {
      const e1 = makeEntry('2024-01-01T10:00:01.000Z', '1');
      const e2 = makeEntry('2024-01-01T10:00:02.000Z', '2');
      const e3 = makeEntry('2024-01-01T10:00:03.000Z', '3');

      service.add(e3);
      service.add(e1);
      service.add(e2);

      expect(service.snapshot).toEqual([e1, e2, e3]);
    });

    it('inserts an entry at its chronological position', () => {
      const e1 = makeEntry('2024-01-01T10:00:01.000Z', '1');
      const e3 = makeEntry('2024-01-01T10:00:03.000Z', '3');
      service.add([e1, e3]);

      const e2 = makeEntry('2024-01-01T10:00:02.000Z', '2');
      service.add(e2);

      expect(service.snapshot).toEqual([e1, e2, e3]);
    });

    it('sorts an unsorted first batch', () => {
      const e1 = makeEntry('2024-01-01T10:00:01.000Z', '1');
      const e2 = makeEntry('2024-01-01T10:00:02.000Z', '2');
      service.add([e2, e1]);
      expect(service.snapshot).toEqual([e1, e2]);
    });
  });

  describe('buffer overflow', () => {
    beforeEach(() => {
      service = new TelegramBufferService(3);
    });

    it('removes oldest entries when the buffer overflows', () => {
      const entries = makeEntries(5);
      const removed = service.add(entries);

      expect(service.length).toBe(3);
      expect(removed).toEqual(entries.slice(0, 2));
      expect(service.snapshot).toEqual(entries.slice(2));
    });

    it('handles single-entry overflow', () => {
      const entries = makeEntries(3);
      service.add(entries);

      const extra = makeEntry('2024-01-01T10:00:04.000Z', '4');
      const removed = service.add(extra);

      expect(service.length).toBe(3);
      expect(removed).toEqual([entries[0]]);
      expect(service.snapshot).toEqual([entries[1], entries[2], extra]);
    });
  });

  describe('merge', () => {
    it('merges unique entries in chronological order', () => {
      const e1 = makeEntry('2024-01-01T10:00:01.000Z', '1');
      const e3 = makeEntry('2024-01-01T10:00:03.000Z', '3');
      service.add([e1, e3]);

      const newEntries = [
        makeEntry('2024-01-01T10:00:02.000Z', '2'),
        makeEntry('2024-01-01T10:00:04.000Z', '4'),
      ];

      const result = service.merge(newEntries);

      expect(result.added).toEqual(newEntries);
      expect(result.removed).toEqual([]);
      expect(service.snapshot.map(e => e.ts)).toEqual(
        [e1, newEntries[0], e3, newEntries[1]].map(e => e.ts),
      );
    });

    it('filters out duplicate entries by id', () => {
      const e1 = makeEntry('2024-01-01T10:00:01.000Z', '1');
      const e2 = makeEntry('2024-01-01T10:00:02.000Z', '2');
      service.add([e1, e2]);

      const result = service.merge([
        e1, // duplicate
        makeEntry('2024-01-01T10:00:03.000Z', '3'), // new
        e2, // duplicate
      ]);

      expect(result.added.length).toBe(1);
      expect(service.length).toBe(3);
    });
  });

  describe('size management', () => {
    it('updates max size without overflow', () => {
      service.add(makeEntries(3));
      const removed = service.setMaxSize(5);

      expect(service.maxSize).toBe(5);
      expect(service.length).toBe(3);
      expect(removed).toEqual([]);
    });

    it('removes oldest entries when reducing max size', () => {
      const entries = makeEntries(5);
      service.add(entries);

      const removed = service.setMaxSize(3);

      expect(service.maxSize).toBe(3);
      expect(removed).toEqual(entries.slice(0, 2));
      expect(service.snapshot).toEqual(entries.slice(2));
    });
  });

  describe('edge cases', () => {
    it('handles empty arrays', () => {
      expect(service.add([])).toEqual([]);
      expect(service.merge([])).toEqual({ added: [], removed: [] });
    });

    it('keeps entries with identical timestamps', () => {
      const sameTime = '2024-01-01T10:00:00.000Z';
      const e1 = makeEntry(sameTime, '1');
      const e2 = makeEntry(sameTime, '2');

      service.add(e1);
      service.add(e2);

      expect(service.length).toBe(2);
    });

    it('returns immutable snapshots', () => {
      service.add(makeEntries(2));

      const snapshot1 = service.snapshot;
      const snapshot2 = service.snapshot;

      expect(snapshot1).not.toBe(snapshot2);
      expect(snapshot1).toEqual(snapshot2);
      (snapshot1 as TelegramEntry[]).pop();
      expect(service.length).toBe(2);
    });
  });
});
