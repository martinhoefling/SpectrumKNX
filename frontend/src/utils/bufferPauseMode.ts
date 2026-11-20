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
 * Resume to playing is the newer pill while auto-paused, a Ctrl-click on that
 * pill while manually paused, an auto edge-flush, or follow-while-auto — not
 * this click. A plain newer-pill click leaves manual pause latched and shows
 * the backlog.
 */
export function pauseModeForToggle(mode: PauseMode): PauseMode {
  if (mode === 'playing') return 'manual';
  return mode === 'auto' ? 'manual' : 'auto';
}

/**
 * Snapshot is frozen in auto or manual. Auto pause moves to playing on the
 * newer pill, a Ctrl-click on that pill while manually paused, when the
 * frozen edge flushes, or when follow turns back on. A plain click on the
 * pill leaves manual pause latched and publishes the backlog.
 */
export function cachePausedForMode(mode: PauseMode): boolean {
  return mode !== 'playing';
}
