/** Buffer snapshot pause: playing | auto (from unfollow) | manual (user Pause). */
export type PauseMode = 'playing' | 'auto' | 'manual';

/**
 * Couples list live-follow to buffer pause mode.
 * - unfollow while playing → auto-pause
 * - follow again while auto-paused → resume (e.g. jumpToLive)
 * - manual pause is latched; follow changes do not touch it
 */
export function pauseModeForListFollow(mode: PauseMode, listFollow: boolean): PauseMode {
  if (!listFollow && mode === 'playing') return 'auto';
  if (listFollow && mode === 'auto') return 'playing';
  return mode;
}

/**
 * Buffer pause button:
 * - Playing → Pause latches as manual
 * - While already paused (Pause icon): toggle auto ↔ manual (stay frozen)
 * Resume to playing is jump-to-live / auto edge-flush / follow-while-auto — not this click.
 */
export function pauseModeForToggle(mode: PauseMode): PauseMode {
  if (mode === 'playing') return 'manual';
  return mode === 'auto' ? 'manual' : 'auto';
}

/**
 * Snapshot is frozen in auto or manual. Reaching the frozen live edge (or
 * jumpToLive / Play) moves mode to playing and flushes — independently of
 * whether live-follow stays on after the flush.
 */
export function cachePausedForMode(mode: PauseMode): boolean {
  return mode !== 'playing';
}
