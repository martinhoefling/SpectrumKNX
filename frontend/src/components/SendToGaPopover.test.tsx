import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { format } from 'date-fns';
import { SendToGaPopover } from './SendToGaPopover';

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) return { ok: true, json: async () => body } as Response;
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

test('opens on click, shows the last value and sends a DPT-1 boolean', async () => {
  const fetchMock = mockFetch({
    '/api/telegrams': { telegrams: [{ value_formatted: 'Off', unit: null, timestamp: '2026-07-17T09:00:00Z' }] },
    '/api/knx/send': { status: 'sent' },
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<SendToGaPopover address="16/0/1" name="SRV_Alive" dptMain={1} dptSub={11} />);

  // Popover is closed initially.
  expect(screen.queryByText(/Last value/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Send to this GA/ }));

  // Last value loads and DPT-1 renders On/Off (no free-text field).
  await waitFor(() => expect(screen.getByText('Off')).toBeInTheDocument());

  // Verify that the timestamp is also formatted and displayed.
  const expectedTime = format(new Date('2026-07-17T09:00:00Z'), 'yyyy-MM-dd HH:mm:ss');
  expect(screen.getByText(`(${expectedTime})`)).toBeInTheDocument();

  expect(screen.queryByPlaceholderText(/Value/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /^On$/ }));

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/knx/send'));
    expect(call).toBeTruthy();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body).toMatchObject({ address: '16/0/1', payload: true, dpt: '1.011' });
  });
});

test('triggers a GroupValueRead from the Read button', async () => {
  const fetchMock = mockFetch({
    '/api/telegrams': { telegrams: [] },
    '/api/knx/read': { status: 'ok' },
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<SendToGaPopover address="1/1/97" name="Helligkeit" dptMain={9} dptSub={4} />);
  fireEvent.click(screen.getByRole('button', { name: /Send to this GA/ }));

  // Non-DPT-1 shows the free value field.
  await waitFor(() => expect(screen.getByPlaceholderText(/Value/)).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /Read/ }));

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/knx/read'));
    expect(call).toBeTruthy();
    expect(JSON.parse((call![1] as RequestInit).body as string)).toMatchObject({ address: '1/1/97' });
  });
});
