import { expect, test, beforeEach, vi } from 'vitest';
import {
  saveUiState,
  loadUiState,
  DEFAULT_UI_STATE,
  UI_STORAGE_KEY,
  type UiSessionState,
} from './uiState';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

test('round-trip save/load works correctly', () => {
  const state: UiSessionState = {
    quickFilter: {
      open: true,
      enabled: true,
      patterns: { source: { top: '1.1.1', bottom: '' } },
    },
    listFollow: false,
    listAnchorKey: 'some-key',
    infoBarOpen: true,
    zoomRange: [1000, 2000],
    statsSearch: 'stats',
    buildingSearch: 'building',
    lastSeenLimit: 50,
    lastSeenLive: false,
    lastSeenSearch: 'lastseen',
    filtersEnabled: false,
  };

  saveUiState(state);
  const loaded = loadUiState();
  expect(loaded).toEqual(state);
});

test('returns null when storage is empty', () => {
  expect(loadUiState()).toBeNull();
});

test('version mismatch returns null', () => {
  localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ v: 2, listFollow: false }));
  expect(loadUiState()).toBeNull();
});

test('malformed JSON returns null', () => {
  localStorage.setItem(UI_STORAGE_KEY, '{invalid json');
  expect(loadUiState()).toBeNull();
});

test('storage throws returns null/gracefully handles error', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Storage failed');
  });
  expect(loadUiState()).toBeNull();
});

test('sanitize drops invalid fields and fills defaults', () => {
  localStorage.setItem(
    UI_STORAGE_KEY,
    JSON.stringify({
      v: 1,
      quickFilter: {
        open: 'not a boolean',
        enabled: true,
        patterns: ['invalid array instead of object'],
      },
      listFollow: 'not a boolean',
      zoomRange: [10, 'not a number'],
    })
  );

  const loaded = loadUiState();
  expect(loaded).toEqual({
    ...DEFAULT_UI_STATE,
    quickFilter: {
      open: false,
      enabled: true,
      patterns: {},
    },
    listFollow: true,
    zoomRange: null,
  });
});

test('drops pre-#309 single-string pattern cells instead of guessing top/bottom', () => {
  localStorage.setItem(
    UI_STORAGE_KEY,
    JSON.stringify({
      v: 1,
      quickFilter: {
        open: true,
        enabled: true,
        patterns: { source: '1.1.1', target: { top: '1/2/3', bottom: 'kitchen' } },
      },
    })
  );

  const loaded = loadUiState();
  expect(loaded?.quickFilter.patterns).toEqual({ target: { top: '1/2/3', bottom: 'kitchen' } });
});
