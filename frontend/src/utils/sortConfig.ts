import { getPref, setPref } from './prefs';
import type { Telegram } from '../hooks/useWebSocket';

export type SortKey = 'timestamp' | 'source_address' | 'target_address' | 'simplified_type' | 'dpt_name' | 'value_numeric';

export interface SortLevel {
  key: SortKey;
  direction: 'asc' | 'desc';
}

/**
 * Ordered, explicit sort levels (primary first). TIME is always the implicit
 * deepest tiebreaker even when not listed here explicitly (#311) — see
 * `sortTelegrams`.
 */
export type SortConfig = SortLevel[];

const SORT_PREF = 'sortConfig';
const SORT_KEYS: SortKey[] = ['timestamp', 'source_address', 'target_address', 'simplified_type', 'dpt_name', 'value_numeric'];
const DEFAULT_SORT: SortConfig = [{ key: 'timestamp', direction: 'desc' }];

const isValidLevel = (l: unknown): l is SortLevel =>
  !!l && typeof l === 'object' &&
  SORT_KEYS.includes((l as SortLevel).key) &&
  ((l as SortLevel).direction === 'asc' || (l as SortLevel).direction === 'desc');

/**
 * Reads the persisted sort config, falling back to the default. Transparently
 * upgrades the pre-#311 single-level object shape (`{key, direction}`) to the
 * one-element array shape.
 */
export function readSortConfigPref(): SortConfig {
  try {
    const raw = getPref(SORT_PREF);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const levels = parsed.filter(isValidLevel);
        if (levels.length > 0) return levels;
      } else if (isValidLevel(parsed)) {
        return [parsed];
      }
    }
  } catch {
    // Ignore malformed stored value
  }
  return [...DEFAULT_SORT];
}

/** Persists the sort config so it survives reloads and is shared across views. */
export function writeSortConfigPref(config: SortConfig): void {
  setPref(SORT_PREF, JSON.stringify(config));
}

/**
 * Applies a column-header click to the sort config (#311).
 * - Plain click: replace with a single-level sort by `key`, toggling
 *   direction if it was already the sole level (existing single-sort UX).
 * - Ctrl/Cmd-click (`additive`): TIME is always the implicit deepest level
 *   (see `sortTelegrams`), so a plain additive click just builds up further
 *   explicit levels. Toggles `key`'s direction in place if it's already an
 *   explicit level, otherwise appends it as a new deepest level.
 */
export function toggleSortLevel(config: SortConfig, key: SortKey, additive: boolean): SortConfig {
  const idx = config.findIndex(l => l.key === key);
  if (!additive) {
    if (config.length === 1 && config[0].key === key) {
      return [{ key, direction: config[0].direction === 'desc' ? 'asc' : 'desc' }];
    }
    return [{ key, direction: 'desc' }];
  }
  if (idx >= 0) {
    const next = [...config];
    next[idx] = { key, direction: next[idx].direction === 'desc' ? 'asc' : 'desc' };
    return next;
  }
  return [...config, { key, direction: 'desc' }];
}

/**
 * Effective comparator levels: the explicit config plus an implicit trailing
 * TIME tiebreaker, unless TIME is already one of the explicit levels (#311).
 */
export const effectiveSortLevels = (config: SortConfig): SortLevel[] =>
  config.some(l => l.key === 'timestamp') ? config : [...config, { key: 'timestamp', direction: 'desc' }];

const compareValues = (key: SortKey, a: Telegram, b: Telegram): number => {
  const aVal = a[key];
  const bVal = b[key];
  if (aVal === bVal) return 0;
  if (aVal == null) return 1;
  if (bVal == null) return -1;
  if (key === 'timestamp') return new Date(aVal as string).getTime() - new Date(bVal as string).getTime();
  return aVal < bVal ? -1 : 1;
};

/**
 * Sorts telegrams by a (possibly multi-level) config. Shared by the live
 * Group Monitor and History Search views so their comparators can't drift.
 */
export function sortTelegrams(items: Telegram[], config: SortConfig): Telegram[] {
  const levels = effectiveSortLevels(config);
  const copy = [...items];
  copy.sort((a, b) => {
    for (const { key, direction } of levels) {
      const cmp = compareValues(key, a, b);
      if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
  return copy;
}
