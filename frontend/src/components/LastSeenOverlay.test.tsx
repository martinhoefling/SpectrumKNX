import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { LastSeenOverlay } from './LastSeenOverlay';
import type { FilterOptions } from '../types/filters';

const FILTER_OPTIONS: FilterOptions = {
  sources: [],
  targets: [
    { address: '16/0/1', name: 'SRV_Alive', main: 1, sub: 11 },
    { address: '1/1/97', name: 'EGD_BWM55TG2A_Helligkeit', main: 9, sub: 4 },
  ],
  types: [],
  dpts: [],
  ga_group_names: {},
  pa_line_names: {},
};

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) {
        return { ok: true, json: async () => body } as Response;
      }
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch({ '/api/telegrams': { telegrams: [] } }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('write row renders On/Off for a DPT 1 GA and sends a boolean, like the send bar (#213)', async () => {
  const fetchMock = mockFetch({
    '/api/telegrams': { telegrams: [] },
    '/api/knx/send': { status: 'sent' },
  });
  vi.stubGlobal('fetch', fetchMock);

  render(
    <LastSeenOverlay
      filterOptions={FILTER_OPTIONS}
      initialAddresses={['16/0/1']}
      initialMode="ga"
      writeEnabled
      onClose={() => {}}
    />
  );

  // DPT-aware controls instead of a free value field that would cause a ConversionError.
  expect(screen.queryByPlaceholderText(/Value/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('On'));

  await waitFor(() => {
    const sendCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/knx/send'));
    expect(sendCall).toBeTruthy();
    const body = JSON.parse((sendCall![1] as RequestInit).body as string);
    expect(body).toMatchObject({ address: '16/0/1', payload: true, dpt: '1.011' });
  });
});

test('write row keeps the value field and Write button for non-boolean DPTs', async () => {
  render(
    <LastSeenOverlay
      filterOptions={FILTER_OPTIONS}
      initialAddresses={['1/1/97']}
      initialMode="ga"
      writeEnabled
      onClose={() => {}}
    />
  );

  expect(await screen.findByPlaceholderText(/Value/)).toBeInTheDocument();
  expect(screen.getByText('Write', { selector: 'button' })).toBeInTheDocument();
  expect(screen.queryByText('On')).not.toBeInTheDocument();
});

test('renders instruction when no addresses are selected, and clicking a sidebar address selects it', async () => {
  const fetchMock = mockFetch({
    '/api/telegrams': {
      telegrams: [
        {
          timestamp: '2026-07-18T10:00:00Z',
          source_address: '1.1.1',
          source_name: 'Btn',
          target_address: '16/0/1',
          target_name: 'SRV_Alive',
          telegram_type: 'GroupValueWrite',
          simplified_type: 'Write',
          dpt: '1.011',
          dpt_main: 1,
          dpt_sub: 11,
          value_numeric: 1,
          value_formatted: 'On',
          raw_data: '0x01',
        },
      ],
    },
  });
  vi.stubGlobal('fetch', fetchMock);

  render(
    <LastSeenOverlay
      filterOptions={FILTER_OPTIONS}
      initialAddresses={[]}
      initialMode="ga"
      writeEnabled
      onClose={() => {}}
    />
  );

  // Verify empty instruction
  expect(screen.getByText('Select one or more addresses on the left sidebar to view their last seen values.')).toBeInTheDocument();

  // Click on the address in the sidebar
  const sidebarBtn = screen.getByText('16/0/1');
  fireEvent.click(sidebarBtn);

  // It should select and fetch
  await waitFor(() => {
    expect(screen.getByText('SRV_Alive')).toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
  });
});

test('sidebar address list is ordered numerically by main/middle/sub, not as text (#348)', () => {
  const scrambled: FilterOptions = {
    ...FILTER_OPTIONS,
    targets: [
      { address: '1/1/10', name: 'ten', main: 1, sub: 1 },
      { address: '1/1/2', name: 'two', main: 1, sub: 1 },
      { address: '0/1/1', name: 'zero', main: 0, sub: 1 },
      { address: '1/1/1', name: 'one', main: 1, sub: 1 },
    ],
  };
  render(
    <LastSeenOverlay
      filterOptions={scrambled}
      initialAddresses={[]}
      initialMode="ga"
      onClose={() => {}}
    />
  );

  const rendered = ['0/1/1', '1/1/1', '1/1/2', '1/1/10'].map(a => screen.getByText(a));
  // Each address appears strictly before the next in document order.
  for (let i = 0; i < rendered.length - 1; i++) {
    expect(
      rendered[i].compareDocumentPosition(rendered[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
});

// ── Live / frozen (#374) ─────────────────────────────────────────────────────

const telegram = (second: number, value: string) => ({
  timestamp: `2026-01-01T10:00:${String(second).padStart(2, '0')}.000Z`,
  source_address: '1.1.5',
  target_address: '1/1/97',
  telegram_type: 'GroupValueWrite',
  simplified_type: 'Write',
  direction: 'Incoming',
  dpt_main: 9,
  dpt_sub: 4,
  value_formatted: value,
  value_numeric: null,
  raw_hex: '0x00',
} as never);

const renderLastSeen = (props: Partial<React.ComponentProps<typeof LastSeenOverlay>>) => {
  const base = { filterOptions: FILTER_OPTIONS, initialAddresses: ['1/1/97'], initialMode: 'ga' as const, onClose: () => {} };
  const view = render(<LastSeenOverlay {...base} {...props} />);
  return { ...view, update: (next: Partial<React.ComponentProps<typeof LastSeenOverlay>>) => view.rerender(<LastSeenOverlay {...base} {...next} />) };
};

test('live shows a matching telegram the moment it arrives, without a refresh timer (#374)', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const fetchMock = mockFetch({ '/api/telegrams': { telegrams: [] } });
    vi.stubGlobal('fetch', fetchMock);
    const { update } = renderLastSeen({ autoRefresh: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    update({ autoRefresh: true, latestTelegram: telegram(1, '111 lx') });
    expect(await screen.findByText('111 lx')).toBeInTheDocument();

    // No periodic re-fetch while live.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test('frozen holds new telegrams back, counts them, and catches up when going live (#374)', async () => {
  const fetchMock = mockFetch({ '/api/telegrams': { telegrams: [] } });
  vi.stubGlobal('fetch', fetchMock);
  const { update } = renderLastSeen({ autoRefresh: false });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

  update({ autoRefresh: false, latestTelegram: telegram(1, '111 lx') });
  update({ autoRefresh: false, latestTelegram: telegram(2, '222 lx') });
  expect(screen.queryByText('111 lx')).not.toBeInTheDocument();
  expect(screen.getByText('2 new')).toBeInTheDocument();
  expect(screen.getByTitle(/^Frozen: 2 newer telegrams not shown/)).toBeInTheDocument();

  // A telegram for another address is not counted.
  update({ autoRefresh: false, latestTelegram: { ...(telegram(3, '333 lx') as object), target_address: '9/9/9' } as never });
  expect(screen.getByText('2 new')).toBeInTheDocument();

  // Going live re-reads the list and clears the hint.
  fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ telegrams: [telegram(2, '222 lx'), telegram(1, '111 lx')] }) }) as Response);
  update({ autoRefresh: true, latestTelegram: { ...(telegram(3, '333 lx') as object), target_address: '9/9/9' } as never });
  expect(await screen.findByText('222 lx')).toBeInTheDocument();
  expect(screen.queryByText('2 new')).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
