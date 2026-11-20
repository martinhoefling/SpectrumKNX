/** Why a telegram list row is marked. Extensible — more reasons may follow. */
export type MarkReason = 'mouse' | 'goto' | 'context' | 'manual' | 'auto' | 'hidden';

/** Time-Delta-Context mark reason (implicit from the soft context window; actionable). */
export const CONTEXT_MARK_REASONS: readonly MarkReason[] = ['context'];

/** Per-telegram mark reasons (anchorKey → non-empty reason list). */
export type MarkReasonsMap = Record<string, MarkReason[]>;

export const MARK_REASONS: readonly MarkReason[] = ['mouse', 'goto', 'context', 'manual', 'auto', 'hidden'];

export function isContextMarkReason(reason: MarkReason): boolean {
  return reason === 'context';
}

export function isHiddenMarkReason(reason: MarkReason): boolean {
  return reason === 'hidden';
}

export function isMarked(map: MarkReasonsMap, key: string): boolean {
  return (map[key]?.length ?? 0) > 0;
}

export function hasMarkReason(map: MarkReasonsMap, key: string, reason: MarkReason): boolean {
  return !!map[key]?.includes(reason);
}

export function markedKeysFrom(map: MarkReasonsMap): string[] {
  return Object.keys(map).filter(k => (map[k]?.length ?? 0) > 0);
}

/** Keys with the `hidden` reason — always omitted from the list. */
export function hiddenKeysFrom(map: MarkReasonsMap): string[] {
  return Object.keys(map).filter(k => hasMarkReason(map, k, 'hidden'));
}

/**
 * Marked keys that are not hidden — always kept in the list, and what the
 * top marks-pill / prev-next act on.
 */
export function visibleMarkedKeysFrom(map: MarkReasonsMap): string[] {
  return Object.keys(map).filter(
    k => (map[k]?.length ?? 0) > 0 && !hasMarkReason(map, k, 'hidden'),
  );
}

/** @deprecated alias — visible (non-hidden) marked keys. */
export function actionableMarkedKeysFrom(map: MarkReasonsMap): string[] {
  return visibleMarkedKeysFrom(map);
}

export function isOnlyContextMark(map: MarkReasonsMap, key: string): boolean {
  const reasons = map[key];
  return !!reasons && reasons.length > 0 && reasons.every(isContextMarkReason);
}

function withReasons(map: MarkReasonsMap, key: string, reasons: MarkReason[]): MarkReasonsMap {
  const next = { ...map };
  if (reasons.length === 0) delete next[key];
  else next[key] = reasons;
  return next;
}

/** Add `reason` to `key` (no-op if already present). */
export function addMarkReason(map: MarkReasonsMap, key: string, reason: MarkReason): MarkReasonsMap {
  const cur = map[key] ?? [];
  if (cur.includes(reason)) return map;
  return withReasons(map, key, [...cur, reason]);
}

/** Remove `reason` from `key`; drops the entry when no reasons remain. */
export function removeMarkReason(map: MarkReasonsMap, key: string, reason: MarkReason): MarkReasonsMap {
  const cur = map[key];
  if (!cur?.includes(reason)) return map;
  return withReasons(map, key, cur.filter(r => r !== reason));
}

/** Toggle `reason` on `key`. */
export function toggleMarkReason(map: MarkReasonsMap, key: string, reason: MarkReason): MarkReasonsMap {
  return hasMarkReason(map, key, reason)
    ? removeMarkReason(map, key, reason)
    : addMarkReason(map, key, reason);
}

/**
 * Give `reason` only to `keys` (clears that reason everywhere else).
 * Other reasons on those keys are preserved.
 */
export function setSoleMarkReason(
  map: MarkReasonsMap,
  reason: MarkReason,
  keys: Iterable<string>,
): MarkReasonsMap {
  const want = new Set(keys);
  let next: MarkReasonsMap = { ...map };
  for (const key of Object.keys(next)) {
    if (want.has(key)) continue;
    next = removeMarkReason(next, key, reason);
  }
  for (const key of want) {
    next = addMarkReason(next, key, reason);
  }
  return next;
}

/** Drop every reason from every key. */
export function clearAllMarks(map: MarkReasonsMap): MarkReasonsMap {
  return Object.keys(map).length === 0 ? map : {};
}

/** Keep only `hidden` on each key (for Clear marks). */
export function clearNonHiddenReasons(map: MarkReasonsMap): MarkReasonsMap {
  const next: MarkReasonsMap = {};
  for (const [key, reasons] of Object.entries(map)) {
    if (reasons.includes('hidden')) next[key] = ['hidden'];
  }
  return next;
}

/** Remove `hidden` everywhere (for Clear hidden). */
export function clearHiddenReasons(map: MarkReasonsMap): MarkReasonsMap {
  let next = map;
  for (const key of Object.keys(map)) {
    next = removeMarkReason(next, key, 'hidden');
  }
  return next;
}

/**
 * Sync the `context` reason to match `contextKeys`: add for members,
 * remove for keys that left the window.
 */
export function syncContextMarkReasons(
  map: MarkReasonsMap,
  contextKeys: ReadonlySet<string> | undefined | null,
): MarkReasonsMap {
  const want = contextKeys ?? new Set<string>();
  let next = map;
  for (const key of Object.keys(next)) {
    if (!want.has(key) && hasMarkReason(next, key, 'context')) {
      next = removeMarkReason(next, key, 'context');
    }
  }
  for (const key of want) {
    next = addMarkReason(next, key, 'context');
  }
  return next;
}

/**
 * Keep `auto` only on the latest selected key (or nowhere if null).
 * Skips keys that already have a user `manual` mark; never keeps both.
 */
export function syncAutoMarkReason(
  map: MarkReasonsMap,
  latestKey: string | null,
): MarkReasonsMap {
  let next = map;
  for (const key of Object.keys(next)) {
    if (key === latestKey) continue;
    if (hasMarkReason(next, key, 'auto')) {
      next = removeMarkReason(next, key, 'auto');
    }
  }
  if (!latestKey) return next;
  if (hasMarkReason(next, latestKey, 'manual')) {
    return removeMarkReason(next, latestKey, 'auto');
  }
  return addMarkReason(next, latestKey, 'auto');
}
