import { getPref, setPref } from './prefs';
import type { SortConfig, SortKey } from '../components/TelegramTable';

const SORT_PREF = 'sortConfig';
const SORT_KEYS: SortKey[] = ['timestamp', 'source_address', 'target_address', 'simplified_type', 'dpt_name', 'value_numeric'];
const DEFAULT_SORT: SortConfig = { key: 'timestamp', direction: 'desc' };

/** Reads the persisted sort config (key + direction), falling back to the default. */
export function readSortConfigPref(): SortConfig {
  try {
    const raw = getPref(SORT_PREF);
    if (raw) {
      const p = JSON.parse(raw) as Partial<SortConfig>;
      if (p.key && SORT_KEYS.includes(p.key) && (p.direction === 'asc' || p.direction === 'desc')) {
        return { key: p.key, direction: p.direction };
      }
    }
  } catch {
    // Ignore malformed stored value
  }
  return { ...DEFAULT_SORT };
}

/** Persists the sort config so it survives reloads and is shared across views. */
export function writeSortConfigPref(config: SortConfig): void {
  setPref(SORT_PREF, JSON.stringify(config));
}
