import { describe, expect, it, vi } from 'vitest';
import type { Telegram } from '../hooks/useWebSocket';
import {
  createPausedVisState,
  syncPausedVisibility,
  type PausedVisArgs,
} from './pausedVisibility';

const row = (iso: string, keep: boolean): Telegram =>
  ({ timestamp: iso, source_address: keep ? 'keep' : 'drop' }) as Telegram;

const args = (
  backlog: Telegram[],
  pausedCount: number,
  keep: (t: Telegram) => boolean,
  extra?: Partial<PausedVisArgs>,
): PausedVisArgs => ({
  epoch: 'filters',
  backlog,
  pausedCount,
  beforeMs: 0,
  afterMs: 0,
  isAnchor: () => false,
  keep: (t) => keep(t),
  collectAnchors: () => [],
  ...extra,
});

describe('syncPausedVisibility', () => {
  it('classifies only the newly arrived row while the backlog array is stable', () => {
    const backlog = [row('2024-01-01T10:00:00.000Z', true)];
    const state = createPausedVisState();
    const keep = vi.fn((t: Telegram) => t.source_address === 'keep');
    expect(syncPausedVisibility(state, args(backlog, 1, keep))).toBe(1);
    expect(keep).toHaveBeenCalledTimes(1);

    keep.mockClear();
    backlog.unshift(row('2024-01-01T10:00:01.000Z', false));
    expect(syncPausedVisibility(state, args(backlog, 2, keep))).toBe(1);
    expect(keep).toHaveBeenCalledTimes(1);
    expect(keep.mock.calls[0][0].source_address).toBe('drop');

    // Same inputs again (strict-mode re-render) must not count twice.
    expect(syncPausedVisibility(state, args(backlog, 2, keep))).toBe(1);
  });

  it('drops the oldest flags when the tail is revealed', () => {
    const backlog = [
      row('2024-01-01T10:00:02.000Z', true),
      row('2024-01-01T10:00:01.000Z', false),
      row('2024-01-01T10:00:00.000Z', true),
    ];
    const state = createPausedVisState();
    const keep = (t: Telegram) => t.source_address === 'keep';
    expect(syncPausedVisibility(state, args(backlog, 3, keep))).toBe(2);
    backlog.length = 2;
    expect(syncPausedVisibility(state, args(backlog, 2, keep))).toBe(1);
  });

  it('replaces the oldest row when the buffer cap evicts it', () => {
    const backlog = [
      row('2024-01-01T10:00:01.000Z', true),
      row('2024-01-01T10:00:00.000Z', true),
    ];
    const state = createPausedVisState();
    const keep = (t: Telegram) => t.source_address === 'keep';
    expect(syncPausedVisibility(state, args(backlog, 2, keep))).toBe(2);
    backlog.unshift(row('2024-01-01T10:00:02.000Z', false));
    backlog.length = 2;
    expect(syncPausedVisibility(state, args(backlog, 3, keep))).toBe(1);
    expect(backlog.map(t => t.source_address)).toEqual(['drop', 'keep']);
  });

  it('pulls an older non-match into the count when a new anchor arrives', () => {
    const older = row('2024-01-01T10:00:00.000Z', false);
    const backlog = [older];
    const state = createPausedVisState();
    const anchorMs = Date.parse('2024-01-01T10:00:00.500Z');
    const keep = (t: Telegram, anchors: readonly number[]) => {
      if (t.source_address === 'keep') return true;
      const ts = Date.parse(t.timestamp);
      return anchors.some(a => ts >= a - 1000 && ts <= a + 1000);
    };
    const base: Partial<PausedVisArgs> = {
      beforeMs: 1000,
      afterMs: 1000,
      isAnchor: (t) => t.source_address === 'keep',
      keep,
      collectAnchors: (rows) => rows
        .filter(t => t.source_address === 'keep')
        .map(t => Date.parse(t.timestamp)),
    };
    expect(syncPausedVisibility(state, args(backlog, 1, () => false, base))).toBe(0);

    const newer = row('2024-01-01T10:00:00.500Z', true);
    backlog.unshift(newer);
    expect(anchorMs).toBe(Date.parse(newer.timestamp));
    expect(syncPausedVisibility(state, args(backlog, 2, () => false, base))).toBe(2);
  });

  it('rescans the whole backlog when the filter epoch changes', () => {
    const backlog = [
      row('2024-01-01T10:00:01.000Z', true),
      row('2024-01-01T10:00:00.000Z', false),
    ];
    const state = createPausedVisState();
    const keep = vi.fn((t: Telegram) => t.source_address === 'keep');
    syncPausedVisibility(state, args(backlog, 2, keep));
    keep.mockClear();
    expect(syncPausedVisibility(state, { ...args(backlog, 2, keep), epoch: 'next' })).toBe(1);
    expect(keep).toHaveBeenCalledTimes(2);
  });
});
