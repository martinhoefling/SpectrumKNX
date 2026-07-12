import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SendTelegramBar } from './SendTelegramBar';

const IDLE = { state: 'idle' };
const RUNNING_JOB = {
  state: 'running',
  id: 'abc',
  address: '1/2/3',
  interval_seconds: 5,
  sends_done: 3,
  sends_skipped: 0,
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
  vi.stubGlobal('fetch', mockFetch({ '/api/knx/send/scheduled/status': IDLE }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('sends immediately when no delay or interval is set', async () => {
  const fetchMock = mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send': { status: 'sent' },
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<SendTelegramBar targets={[]} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Group address/), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });
  fireEvent.click(screen.getByText('Write'));

  await waitFor(() => expect(screen.getByText(/Sent 50 to 1\/2\/3/)).toBeInTheDocument());
  const sendCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/knx/send') && !String(u).includes('scheduled'));
  expect(sendCall).toBeTruthy();
});

test('starts a scheduled job when an interval is set and shows the cancel row', async () => {
  const fetchMock = mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send/scheduled': RUNNING_JOB,
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<SendTelegramBar targets={[]} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Group address/), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });
  fireEvent.change(screen.getByPlaceholderText('Every s'), { target: { value: '5' } });
  fireEvent.click(screen.getByText('Write'));

  await waitFor(() => expect(screen.getByText(/Cyclic send to 1\/2\/3 every 5s — 3 sent/)).toBeInTheDocument());
  expect(screen.getByText('Cancel')).toBeInTheDocument();

  const scheduledCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/knx/send/scheduled'));
  expect(scheduledCall).toBeTruthy();
  const body = JSON.parse((scheduledCall![1] as RequestInit).body as string);
  expect(body.interval_seconds).toBe(5);
  expect(body.delay_seconds).toBe(0);
});

test('picks up an already-running job on mount', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/knx/send/scheduled/status': RUNNING_JOB }));

  render(<SendTelegramBar targets={[]} onClose={() => {}} />);
  await waitFor(() => expect(screen.getByText(/Cyclic send to 1\/2\/3/)).toBeInTheDocument());
});
