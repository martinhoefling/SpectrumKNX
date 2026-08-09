import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DatabaseOverlay } from './DatabaseOverlay';

const INFO = {
  backend: 'postgresql',
  telegram_count: 637687,
  oldest_timestamp: '2026-08-05T02:00:00',
  newest_timestamp: '2026-08-09T08:30:31',
  size_bytes: 116_916_224,
  retention_days: null,
  supports_size_stats: true,
  supports_optimize: true,
  read_only: false,
};

function mockFetch(purgeHandler: (body: unknown) => unknown) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/database/info')) {
      return { ok: true, json: async () => INFO } as Response;
    }
    if (url.includes('/api/database/purge')) {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      return { ok: true, json: async () => purgeHandler(body) } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch(() => ({ deleted: 0 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('purge-before-date uses local midnight, not UTC midnight, as the cutoff (#416)', async () => {
  let purgeBody: { older_than?: string } | undefined;
  vi.stubGlobal('fetch', mockFetch(body => {
    purgeBody = body as { older_than?: string };
    return { deleted: 0 };
  }));

  render(<DatabaseOverlay onClose={() => {}} />);
  await waitFor(() => expect(screen.getByText('postgresql')).toBeInTheDocument());

  const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
  fireEvent.change(dateInput, { target: { value: '2026-08-05' } });
  fireEvent.click(screen.getByRole('button', { name: /Preview/ }));

  await waitFor(() => expect(purgeBody?.older_than).toBeDefined());

  // A date-only string parses as UTC midnight per the JS spec — the buggy
  // cutoff. Local midnight is what the user actually picked; the two only
  // coincide when the test runner happens to be in UTC, so assert against
  // the *local* interpretation explicitly rather than a fixed offset.
  const expectedLocalMidnight = new Date('2026-08-05T00:00:00').toISOString();
  const buggyUtcMidnight = new Date('2026-08-05').toISOString();
  expect(purgeBody?.older_than).toBe(expectedLocalMidnight);
  if (expectedLocalMidnight !== buggyUtcMidnight) {
    expect(purgeBody?.older_than).not.toBe(buggyUtcMidnight);
  }
});
