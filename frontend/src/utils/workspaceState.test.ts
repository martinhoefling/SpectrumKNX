import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_WORKSPACE,
  WORKSPACE_STORAGE_KEY,
  saveWorkspace,
  loadWorkspace,
  buildMonitorSearch,
  parseMonitorSearch,
  applyWorkspaceUrl,
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
    sourceTargetRelation: 'OR',
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
