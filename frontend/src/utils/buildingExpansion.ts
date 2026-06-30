import { useCallback, useSyncExternalStore } from 'react';

// Persisted expand/collapse state for the Building Structure tree.
//
// The state lives at module scope (and mirrors to sessionStorage) so it
// survives the BuildingOverlay being unmounted when the user navigates away
// and back — and across reloads within the same tab. Only nodes the user has
// explicitly toggled are stored; everything else falls back to its default,
// which keeps "default open for top-level spaces" working without having to
// enumerate the whole tree up front.

const STORAGE_KEY = 'buildingExpansion';

const load = (): Record<string, boolean> => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore unavailable/malformed storage
  }
  return {};
};

let overrides: Record<string, boolean> = load();
let version = 0;
const listeners = new Set<() => void>();

const persist = () => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Ignore storage write failures (e.g. private mode quota)
  }
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const getSnapshot = () => version;

const setOverride = (key: string, open: boolean) => {
  overrides = { ...overrides, [key]: open };
  version += 1;
  persist();
  listeners.forEach(l => l());
};

/**
 * Subscribe a tree node to its persisted expand state.
 * Returns the current open state and a toggle callback.
 */
export function useExpanded(key: string, defaultOpen: boolean): [boolean, () => void] {
  useSyncExternalStore(subscribe, getSnapshot);
  const open = key in overrides ? overrides[key] : defaultOpen;
  const toggle = useCallback(() => {
    const current = key in overrides ? overrides[key] : defaultOpen;
    setOverride(key, !current);
  }, [key, defaultOpen]);
  return [open, toggle];
}
