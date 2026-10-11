import { useCallback, useSyncExternalStore } from 'react';

// Devices ticked in the Building Structure, and whether everything else is
// hidden (#505) — to get a sender and a receiver that sit far apart in the
// tree directly under each other.
//
// Module scope mirrored to sessionStorage, like the tree's expand state, so
// it survives leaving the panel and reloading the tab.

const STORAGE_KEY = 'buildingSelection';

interface State {
  devices: string[];
  onlySelected: boolean;
}

const load = (): State => {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    if (parsed && typeof parsed === 'object') {
      const p = parsed as Partial<State>;
      return {
        devices: Array.isArray(p.devices) ? p.devices.filter((d): d is string => typeof d === 'string') : [],
        onlySelected: p.onlySelected === true,
      };
    }
  } catch {
    // Ignore unavailable/malformed storage
  }
  return { devices: [], onlySelected: false };
};

let state: State = load();
let selected: ReadonlySet<string> = new Set(state.devices);
const listeners = new Set<() => void>();

const update = (next: State) => {
  state = next;
  selected = new Set(next.devices);
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage write failures (e.g. private mode quota)
  }
  listeners.forEach(l => l());
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const getSnapshot = () => state;

export const toggleDeviceSelected = (address: string) =>
  update({
    ...state,
    devices: selected.has(address) ? state.devices.filter(d => d !== address) : [...state.devices, address],
  });

export const setOnlySelected = (onlySelected: boolean) => update({ ...state, onlySelected });

/** Unticks every device and shows the whole tree again. */
export const clearDeviceSelection = () => update({ devices: [], onlySelected: false });

export interface BuildingSelection {
  /** Addresses of the ticked devices. */
  selected: ReadonlySet<string>;
  /** True while only ticked devices are shown — never with nothing ticked. */
  hideOthers: boolean;
  /** The toggle's own state, kept while nothing is ticked. */
  onlySelected: boolean;
}

export function useBuildingSelection(): BuildingSelection {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  return { selected, hideOthers: s.onlySelected && s.devices.length > 0, onlySelected: s.onlySelected };
}

/** One device's tick state and its toggle. */
export function useDeviceSelected(address: string): [boolean, () => void] {
  useSyncExternalStore(subscribe, getSnapshot);
  const toggle = useCallback(() => toggleDeviceSelected(address), [address]);
  return [selected.has(address), toggle];
}

/** Test helper: start from an empty selection. */
export const resetBuildingSelection = () => update({ devices: [], onlySelected: false });
