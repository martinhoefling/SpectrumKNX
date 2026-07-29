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
      patterns: { source_address: '1.1.1' },
    },
    listFollow: false,
    listAnchorKey: 'some-key',
    zoomRange: [1000, 2000],
    statsSearch: 'stats',
    buildingSearch: 'building',
    lastSeenLimit: 50,
    lastSeenLive: false,
    lastSeenSearch: 'lastseen',
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
