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
