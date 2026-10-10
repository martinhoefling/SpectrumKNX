import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_WORKSPACE,
  WORKSPACE_STORAGE_KEY,
  saveWorkspace,
  loadWorkspace,
  buildMonitorSearch,
  parseMonitorSearch,
  applyWorkspaceUrl,
  workspaceFromSearch,
  sameWorkspaceApartFromLayout,
  type WorkspaceState,
} from './workspaceState';
import { DEFAULT_FILTERS } from '../types/filters';

const sampleWorkspace = (): WorkspaceState => ({
  tab: 'live',
  view: 'visualizer',
  filterOpen: false,
  filters: {
    ...DEFAULT_FILTERS,
    sources: ['1.2.3'],
    targets: ['0/1/2', '0/1/3'],
    types: ['Write'],
    directions: ['Incoming'],
    dpts: ['1.001', '9'],
    deltaBeforeMs: 500,
    deltaAfterMs: 1000,
    // Only AND round-trips now — `rel_st` is no longer written (#275).
    sourceTargetRelation: 'AND',
  },
  plot: ['0/1/2'],
  lastSeenAddresses: ['0/1/2'],
  lastSeenMode: 'pa',
});

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('workspace localStorage persistence', () => {
  it('round-trips a workspace', () => {
    const ws = sampleWorkspace();
    saveWorkspace(ws);
    expect(loadWorkspace()).toEqual(ws);
  });

  it('returns null when nothing is stored', () => {
    expect(loadWorkspace()).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, '{broken');
    expect(loadWorkspace()).toBeNull();
  });

  it('returns null on an unknown version', () => {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ v: 99, tab: 'live' }));
    expect(loadWorkspace()).toBeNull();
  });

  it('sanitizes invalid fields back to defaults', () => {
    localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        tab: 'bogus',
        view: 'bogus',
        filterOpen: 'yes',
        filters: { sources: ['1.2.3', 42], dpts: ['1.001', 'nope'], deltaBeforeMs: -5, sourceTargetRelation: 'XOR' },
        plot: 'not-an-array',
        lastSeenMode: 'xy',
      }),
    );
    const ws = loadWorkspace();
    expect(ws).toEqual({
      ...DEFAULT_WORKSPACE,
      filters: { ...DEFAULT_FILTERS, sources: ['1.2.3'], dpts: ['1.001'] },
    });
  });
});

describe('monitor URL encoding', () => {
  it('encodes a default workspace as an empty query', () => {
    expect(buildMonitorSearch(DEFAULT_WORKSPACE)).toBe('');
  });

  it('round-trips a workspace through the URL', () => {
    const ws = sampleWorkspace();
    const search = buildMonitorSearch(ws);
    expect(search).toContain('view=monitor');
    expect(parseMonitorSearch('?' + search)).toEqual(ws);
  });

  it('encodes only non-default fields', () => {
    const search = buildMonitorSearch({
      ...DEFAULT_WORKSPACE,
      filters: { ...DEFAULT_FILTERS, targets: ['0/1/2'] },
    });
    const p = new URLSearchParams(search);
    expect([...p.keys()].sort()).toEqual(['tgt', 'view']);
  });

  it('returns null for non-monitor queries', () => {
    expect(parseMonitorSearch('')).toBeNull();
    expect(parseMonitorSearch('?view=viz&rel=1h')).toBeNull();
    expect(parseMonitorSearch('?tab=history')).toBeNull();
  });

  it('sanitizes hostile URL values', () => {
    const ws = parseMonitorSearch('?view=monitor&tab=evil&panel=evil&dpt=1.001,drop&lsm=zz');
    expect(ws).toEqual({
      ...DEFAULT_WORKSPACE,
      filters: { ...DEFAULT_FILTERS, dpts: ['1.001'] },
    });
  });

  it('round-trips a disabled Time-Delta-Context, keeping the stored values (#318)', () => {
    const ws: WorkspaceState = {
      ...DEFAULT_WORKSPACE,
      filters: { ...DEFAULT_FILTERS, deltaBeforeMs: 500, deltaContextEnabled: false },
    };
    const search = buildMonitorSearch(ws);
    expect(search).toContain('delta_off=1');
    const parsed = parseMonitorSearch('?' + search);
    expect(parsed!.filters.deltaContextEnabled).toBe(false);
    expect(parsed!.filters.deltaBeforeMs).toBe(500);
  });
});

describe('applyWorkspaceUrl', () => {
  it('reflects a non-default workspace into the address bar', () => {
    applyWorkspaceUrl({ ...DEFAULT_WORKSPACE, tab: 'history' });
    expect(window.location.search).toContain('view=monitor');
    expect(window.location.search).toContain('tab=history');
  });

  it('clears the query again for a default workspace', () => {
    applyWorkspaceUrl({ ...DEFAULT_WORKSPACE, tab: 'history' });
    applyWorkspaceUrl(DEFAULT_WORKSPACE);
    expect(window.location.search).toBe('');
  });
});

describe('browser history', () => {
  it('replace (the default) rewrites the current entry', () => {
    const before = window.history.length;
    applyWorkspaceUrl({ ...DEFAULT_WORKSPACE, tab: 'history' });
    applyWorkspaceUrl({ ...DEFAULT_WORKSPACE, view: 'statistics' }, 'replace');
    expect(window.history.length).toBe(before);
    expect(window.location.search).toContain('panel=statistics');
  });

  it('push adds an entry per workspace', () => {
    const before = window.history.length;
    applyWorkspaceUrl({ ...DEFAULT_WORKSPACE, tab: 'history' }, 'push');
    applyWorkspaceUrl({ ...DEFAULT_WORKSPACE, view: 'statistics' }, 'push');
    expect(window.history.length).toBe(before + 2);
    expect(window.location.search).toContain('panel=statistics');
  });

  it('reads a workspace back from the address bar, defaulting for a bare URL', () => {
    const ws = sampleWorkspace();
    expect(workspaceFromSearch('?' + buildMonitorSearch(ws))).toEqual(ws);
    expect(workspaceFromSearch('')).toEqual(DEFAULT_WORKSPACE);
    // Another view's query (a shared link) is not a monitor workspace.
    expect(workspaceFromSearch('?view=viz&plot=1/2/3')).toEqual(DEFAULT_WORKSPACE);
  });

  it('treats a filter-pane toggle as layout, not as a place to go back to', () => {
    const open = sampleWorkspace();
    const closed = { ...open, filterOpen: !open.filterOpen };
    expect(sameWorkspaceApartFromLayout(buildMonitorSearch(open), buildMonitorSearch(closed))).toBe(true);
    // …including when everything else is default and one side is the bare URL.
    expect(sameWorkspaceApartFromLayout(buildMonitorSearch({ ...DEFAULT_WORKSPACE, filterOpen: false }), '')).toBe(true);

    const otherPanel = { ...open, view: 'statistics' as const };
    expect(sameWorkspaceApartFromLayout(buildMonitorSearch(open), buildMonitorSearch(otherPanel))).toBe(false);
    const otherFilter = { ...open, filters: { ...open.filters, targets: ['9/9/9'] } };
    expect(sameWorkspaceApartFromLayout(buildMonitorSearch(open), buildMonitorSearch(otherFilter))).toBe(false);
  });
});

describe('switched-off filters (#437)', () => {
  it('round-trip through the URL and storage', () => {
    const ws: WorkspaceState = {
      ...DEFAULT_WORKSPACE,
      filters: { ...DEFAULT_FILTERS, sources: ['1.2.3'], targets: ['0/1/2', '0/1/3'], disabled: ['targets:0/1/3'] },
    };
    const search = buildMonitorSearch(ws);
    expect(new URLSearchParams(search).get('off')).toBe('targets:0/1/3');
    expect(parseMonitorSearch(search)).toEqual(ws);
    saveWorkspace(ws);
    expect(loadWorkspace()).toEqual(ws);
  });

  it('ignores markers for entries that are not selected', () => {
    const parsed = parseMonitorSearch('view=monitor&tgt=0/1/2&off=targets:9/9/9,targets:0/1/2,bogus');
    expect(parsed?.filters.targets).toEqual(['0/1/2']);
    expect(parsed?.filters.disabled).toEqual(['targets:0/1/2']);
  });

  it('a workspace stored before this existed loads with nothing switched off', () => {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ v: 1, tab: 'live', view: 'none', filterOpen: true, filters: { sources: ['1.2.3'] }, plot: [] }));
    expect(loadWorkspace()?.filters.disabled).toEqual([]);
    expect(loadWorkspace()?.filters.sources).toEqual(['1.2.3']);
  });
});
