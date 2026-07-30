export interface UiSessionState {
  quickFilter: {
    open: boolean;
    enabled: boolean;
    patterns: Record<string, string>;
  };
  listFollow: boolean;
  listAnchorKey: string | null;
  zoomRange: [number, number] | null;
  statsSearch: string;
  buildingSearch: string;
  lastSeenLimit: number;
  lastSeenLive: boolean;
  lastSeenSearch: string;
  /** Master enable/disable of the filter set (#370); absent → enabled. */
  filtersEnabled: boolean;
}

export const DEFAULT_UI_STATE: UiSessionState = {
  quickFilter: {
    open: false,
    enabled: false,
    patterns: {},
  },
  listFollow: true,
  listAnchorKey: null,
  zoomRange: null,
  statsSearch: '',
  buildingSearch: '',
  lastSeenLimit: 20,
  lastSeenLive: true,
  lastSeenSearch: '',
  filtersEnabled: true,
};

export const UI_STORAGE_KEY = 'spectrum-knx-ui';

interface StoredUiState extends UiSessionState {
  v: number;
}

export function saveUiState(state: UiSessionState): void {
  try {
    const stored: StoredUiState = { v: 1, ...state };
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage unavailable - fallback to in-memory state in App.tsx
  }
}

export function loadUiState(): UiSessionState | null {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<StoredUiState>;
    if (p.v !== 1) return null;
    return sanitize(p);
  } catch {
    return null;
  }
}

function sanitize(p: Partial<StoredUiState>): UiSessionState {
  const q = (p.quickFilter ?? {}) as Partial<UiSessionState['quickFilter']>;
  const patterns = q.patterns && typeof q.patterns === 'object' && !Array.isArray(q.patterns)
    ? Object.fromEntries(
        Object.entries(q.patterns).filter(
          (entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string'
        )
      )
    : {};

  const zoom = Array.isArray(p.zoomRange) && p.zoomRange.length === 2 && typeof p.zoomRange[0] === 'number' && typeof p.zoomRange[1] === 'number'
    ? (p.zoomRange as [number, number])
    : null;

  return {
    quickFilter: {
      open: typeof q.open === 'boolean' ? q.open : false,
      enabled: typeof q.enabled === 'boolean' ? q.enabled : false,
      patterns,
    },
    listFollow: typeof p.listFollow === 'boolean' ? p.listFollow : true,
    listAnchorKey: typeof p.listAnchorKey === 'string' ? p.listAnchorKey : null,
    zoomRange: zoom,
    statsSearch: typeof p.statsSearch === 'string' ? p.statsSearch : '',
    buildingSearch: typeof p.buildingSearch === 'string' ? p.buildingSearch : '',
    lastSeenLimit: typeof p.lastSeenLimit === 'number' ? p.lastSeenLimit : 20,
    lastSeenLive: typeof p.lastSeenLive === 'boolean' ? p.lastSeenLive : true,
    lastSeenSearch: typeof p.lastSeenSearch === 'string' ? p.lastSeenSearch : '',
    filtersEnabled: typeof p.filtersEnabled === 'boolean' ? p.filtersEnabled : true,
  };
}
