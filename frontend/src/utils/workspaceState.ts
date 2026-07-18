import { DEFAULT_FILTERS, DIRECTIONS, type ActiveFilters } from '../types/filters';
import { getBasePath } from './basePath';

/**
 * Group Monitor workspace persistence (#211).
 *
 * The workspace is the session state lost when the app is torn down: active
 * tab, filters, open panel, visualization targets. Where it is persisted
 * depends on how the app is hosted (#249):
 *
 * - Embedded (Home Assistant dashboard iframe): `localStorage`. HA recreates
 *   the iframe with the original URL on every dashboard switch, so the URL
 *   cannot carry state — the workspace is restored from storage instead.
 * - Regular browser tab: the URL (`view=monitor` query), so reloads and
 *   bookmarks restore the workspace and the address bar stays shareable.
 *
 * Durable UI *preferences* (theme, columns, sort, …) live in `utils/prefs.ts`
 * and are deliberately not part of the workspace.
 */

export type WorkspaceTab = 'live' | 'history' | 'import';
export type WorkspaceView = 'none' | 'visualizer' | 'lastseen' | 'statistics' | 'building' | 'database';

export interface WorkspaceState {
  tab: WorkspaceTab;
  view: WorkspaceView;
  filterOpen: boolean;
  filters: ActiveFilters;
  /** Group addresses selected for visualization. */
  plot: string[];
  lastSeenAddresses: string[];
  lastSeenMode: 'ga' | 'pa';
}

export const DEFAULT_WORKSPACE: WorkspaceState = {
  tab: 'live',
  view: 'none',
  filterOpen: true,
  filters: DEFAULT_FILTERS,
  plot: [],
  lastSeenAddresses: [],
  lastSeenMode: 'ga',
};

export const WORKSPACE_STORAGE_KEY = 'spectrum-knx-workspace';

const TABS: WorkspaceTab[] = ['live', 'history', 'import'];
const VIEWS: WorkspaceView[] = ['none', 'visualizer', 'lastseen', 'statistics', 'building', 'database'];

/**
 * Whether the app runs inside another page (Home Assistant dashboard iframe /
 * ingress). Cross-origin access to `window.top` may throw — which itself
 * proves we are framed.
 */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

// ── localStorage (embedded mode) ─────────────────────────────────────────────

interface StoredWorkspace extends WorkspaceState {
  v: number;
}

export function saveWorkspace(state: WorkspaceState): void {
  try {
    const stored: StoredWorkspace = { v: 1, ...state };
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage unavailable — the workspace just won't survive the teardown.
  }
}

export function loadWorkspace(): WorkspaceState | null {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<StoredWorkspace>;
    if (p.v !== 1) return null;
    return sanitize(p);
  } catch {
    return null;
  }
}

/** Validates a stored/parsed candidate field-by-field, defaulting the rest. */
function sanitize(p: Partial<WorkspaceState>): WorkspaceState {
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const f = (p.filters ?? {}) as Partial<ActiveFilters>;
  return {
    tab: TABS.includes(p.tab as WorkspaceTab) ? (p.tab as WorkspaceTab) : 'live',
    view: VIEWS.includes(p.view as WorkspaceView) ? (p.view as WorkspaceView) : 'none',
    filterOpen: typeof p.filterOpen === 'boolean' ? p.filterOpen : true,
    filters: {
      ...DEFAULT_FILTERS,
      sources: strings(f.sources),
      targets: strings(f.targets),
      types: strings(f.types),
      directions: strings(f.directions).filter(d => DIRECTIONS.includes(d)),
      dpts: strings(f.dpts).filter(d => /^\d+(\.\d+)?$/.test(d)),
      deltaBeforeMs: Math.max(0, Number(f.deltaBeforeMs) || 0),
      deltaAfterMs: Math.max(0, Number(f.deltaAfterMs) || 0),
      sourceTargetRelation: f.sourceTargetRelation === 'OR' ? 'OR' : 'AND',
    },
    plot: strings(p.plot),
    lastSeenAddresses: strings(p.lastSeenAddresses),
    lastSeenMode: p.lastSeenMode === 'pa' ? 'pa' : 'ga',
  };
}

// ── URL (regular mode) ───────────────────────────────────────────────────────
// Filter params reuse the share-link vocabulary from viewUrl.ts (#150) so the
// two URL formats stay consistent.

/** Builds the query string for a workspace; empty when everything is default. */
export function buildMonitorSearch(state: WorkspaceState): string {
  const p = new URLSearchParams();
  if (state.tab !== 'live') p.set('tab', state.tab);
  if (state.view !== 'none') p.set('panel', state.view);
  if (!state.filterOpen) p.set('fp', '0');
  const f = state.filters;
  if (f.sources.length > 0) p.set('src', f.sources.join(','));
  if (f.targets.length > 0) p.set('tgt', f.targets.join(','));
  if (f.types.length > 0) p.set('type', f.types.join(','));
  if (f.directions.length > 0) p.set('dir', f.directions.join(','));
  if (f.dpts.length > 0) p.set('dpt', f.dpts.join(','));
  if (f.deltaBeforeMs > 0) p.set('before', String(f.deltaBeforeMs));
  if (f.deltaAfterMs > 0) p.set('after', String(f.deltaAfterMs));
  if (f.sourceTargetRelation === 'OR') p.set('rel_st', 'OR');
  if (state.plot.length > 0) p.set('plot', state.plot.join(','));
  if (state.lastSeenAddresses.length > 0) p.set('ls', state.lastSeenAddresses.join(','));
  if (state.lastSeenMode !== 'ga') p.set('lsm', state.lastSeenMode);
  if ([...p.keys()].length === 0) return '';
  p.set('view', 'monitor');
  return p.toString();
}

const list = (v: string | null): string[] => (v ? v.split(',').filter(Boolean) : []);

/** Parses a `view=monitor` workspace URL; null for any other query. */
export function parseMonitorSearch(search: string): WorkspaceState | null {
  const p = new URLSearchParams(search);
  if (p.get('view') !== 'monitor') return null;
  return sanitize({
    tab: p.get('tab') as WorkspaceTab,
    view: p.get('panel') as WorkspaceView,
    filterOpen: p.get('fp') !== '0',
    filters: {
      ...DEFAULT_FILTERS,
      sources: list(p.get('src')),
      targets: list(p.get('tgt')),
      types: list(p.get('type')),
      directions: list(p.get('dir')),
      dpts: list(p.get('dpt')),
      deltaBeforeMs: Number(p.get('before')) || 0,
      deltaAfterMs: Number(p.get('after')) || 0,
      sourceTargetRelation: p.get('rel_st') === 'OR' ? 'OR' : 'AND',
    },
    plot: list(p.get('plot')),
    lastSeenAddresses: list(p.get('ls')),
    lastSeenMode: (p.get('lsm') as 'ga' | 'pa') ?? 'ga',
  });
}

/** Reflects the workspace into the address bar without adding history entries. */
export function applyWorkspaceUrl(state: WorkspaceState): void {
  const search = buildMonitorSearch(state);
  const url = `${getBasePath()}/${search ? '?' + search : ''}`;
  try {
    window.history.replaceState(null, '', url);
  } catch {
    // Sandboxed contexts may forbid history access — the workspace is simply
    // not reflected.
  }
}
