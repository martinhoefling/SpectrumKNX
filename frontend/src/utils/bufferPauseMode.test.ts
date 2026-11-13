import { describe, expect, test } from 'vitest';
import {
  pauseModeForListFollow,
  pauseModeForToggle,
  cachePausedForMode,
  readPhaseRows,
  type PauseMode,
} from './bufferPauseMode';

describe('pauseModeForListFollow', () => {
  test('unfollow while playing → auto-pause', () => {
    expect(pauseModeForListFollow('playing', false)).toBe('auto');
  });

  test('follow while auto-paused → resume playing', () => {
    expect(pauseModeForListFollow('auto', true)).toBe('playing');
  });

  test('manual pause latches across follow on/off', () => {
    expect(pauseModeForListFollow('manual', true)).toBe('manual');
    expect(pauseModeForListFollow('manual', false)).toBe('manual');
  });

  test('stay auto while still unfollowed', () => {
    expect(pauseModeForListFollow('auto', false)).toBe('auto');
  });

  test('stay playing while still following', () => {
    expect(pauseModeForListFollow('playing', true)).toBe('playing');
  });
});

describe('pauseModeForToggle', () => {
  test('Pause from playing latches as manual', () => {
    expect(pauseModeForToggle('playing')).toBe('manual');
  });

  test('while paused, Pause icon toggles auto ↔ manual', () => {
    expect(pauseModeForToggle('auto')).toBe('manual');
    expect(pauseModeForToggle('manual')).toBe('auto');
  });
});

describe('readPhaseRows', () => {
  const frozen = ['old'];
  const ingested = ['old', 'live-response'];

  test('playing and auto-pause follow the live buffer', () => {
    expect(readPhaseRows('playing', frozen, ingested)).toBe(ingested);
    expect(readPhaseRows('auto', frozen, ingested)).toBe(ingested);
  });

  test('manual pause keeps the frozen snapshot', () => {
    expect(readPhaseRows('manual', frozen, ingested)).toBe(frozen);
  });
});

describe('cachePausedForMode', () => {
  test('frozen in auto and manual; playing flushes', () => {
    expect(cachePausedForMode('playing')).toBe(false);
    expect(cachePausedForMode('auto')).toBe(true);
    expect(cachePausedForMode('manual')).toBe(true);
  });

  test('edge flush / Play moves auto → playing without needing follow', () => {
    let mode: PauseMode = 'auto';
    expect(cachePausedForMode(mode)).toBe(true);
    mode = 'playing'; // onPauseFlush / toggle
    expect(cachePausedForMode(mode)).toBe(false);
  });

  test('manual latch survives follow; pause-icon toggles to auto without flushing', () => {
    let mode: PauseMode = pauseModeForToggle('playing');
    expect(mode).toBe('manual');
    expect(cachePausedForMode(mode)).toBe(true);
    mode = pauseModeForListFollow(mode, true);
    expect(mode).toBe('manual');
    expect(cachePausedForMode(mode)).toBe(true);
    mode = pauseModeForToggle(mode);
    expect(mode).toBe('auto');
    expect(cachePausedForMode(mode)).toBe(true);
  });
});
