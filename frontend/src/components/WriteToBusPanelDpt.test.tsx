import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { WriteToBusPanel } from './WriteToBusPanel';

// Editable DPT in the Send panel (#342).

const IDLE = { state: 'idle' };

// GA whose project DPT is 5.001 (0–100 %) — the #342 case: 128 is out of range
// there, so the user must be able to override to 5.010 (0–255).
const TARGETS = [{ address: '1/2/3', name: 'Dimmer', main: 5, sub: 1 }];

function mockSend(routes: Record<string, unknown> = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    void init;
    if (url.includes('/api/knx/send/scheduled/status')) return { ok: true, json: async () => IDLE } as Response;
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) return { ok: true, json: async () => body } as Response;
    }
    if (url.includes('/api/knx/send')) return { ok: true, json: async () => ({ status: 'sent' }) } as Response;
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

const dptInput = (c: HTMLElement) => c.querySelector('input[list="wtb-dpt-options"]') as HTMLInputElement;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', mockSend());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('DPT prefills from the project when a GA is chosen', () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Group address/), { target: { value: '1/2/3' } });
  expect(dptInput(container)).toHaveValue('5.001');
  // Not overridden yet → no reset affordance.
  expect(screen.queryByTitle(/Reset to project DPT/)).not.toBeInTheDocument();
});

test('overriding the DPT changes the effective DPT and shows a reset affordance', () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Group address/), { target: { value: '1/2/3' } });

  fireEvent.change(dptInput(container), { target: { value: '5.010' } });
  expect(dptInput(container)).toHaveValue('5.010');
  expect(screen.getByTitle('Reset to project DPT 5.001')).toBeInTheDocument();
});

test('the write widget follows the overridden DPT (main 5 → 1 renders On/Off)', () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Group address/), { target: { value: '1/2/3' } });
  // main 5 → free-value input
  expect(screen.getByPlaceholderText(/Value/)).toBeInTheDocument();

  fireEvent.change(dptInput(container), { target: { value: '1.001' } });
  // main 1 → On/Off buttons, free-value input gone
  expect(screen.getByRole('button', { name: /^On$/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Off$/ })).toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/Value/)).not.toBeInTheDocument();
});

test('changing the DPT main clears a stale value', () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Group address/), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });
  expect(screen.getByPlaceholderText(/Value/)).toHaveValue('50');

  // 5.001 → 9.001: main changes (5 → 9), still a free-value widget, value cleared.
  fireEvent.change(dptInput(container), { target: { value: '9.001' } });
  expect(screen.getByPlaceholderText(/Value/)).toHaveValue('');
});

test('sending uses the overridden DPT (the #342 case: 128 as 5.010)', async () => {
  const fetchMock = mockSend({ '/api/knx/send': { status: 'sent' } });
  vi.stubGlobal('fetch', fetchMock);

  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Group address/), { target: { value: '1/2/3' } });
  fireEvent.change(dptInput(container), { target: { value: '5.010' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '128' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));

  await waitFor(() => expect(screen.getByText(/Sent 128 to 1\/2\/3/)).toBeInTheDocument());
  const sendCall = fetchMock.mock.calls.find(
    ([u]) => String(u).includes('/api/knx/send') && !String(u).includes('scheduled'),
  );
  const body = JSON.parse((sendCall![1] as RequestInit).body as string);
  expect(body).toMatchObject({ address: '1/2/3', payload: 128, dpt: '5.010' });
});

test('an unknown DPT surfaces the backend error inline', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) return { ok: true, json: async () => IDLE } as Response;
    if (url.includes('/api/knx/send')) {
      return { ok: false, status: 400, json: async () => ({ detail: 'Unknown DPT type: 5.999' }) } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Group address/), { target: { value: '1/2/3' } });
  fireEvent.change(dptInput(container), { target: { value: '5.999' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));

  await waitFor(() => expect(screen.getByText(/Unknown DPT type: 5\.999/)).toBeInTheDocument());
});

test('reset restores the project DPT and drops the override', () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Group address/), { target: { value: '1/2/3' } });
  fireEvent.change(dptInput(container), { target: { value: '5.010' } });

  fireEvent.click(screen.getByTitle('Reset to project DPT 5.001'));
  expect(dptInput(container)).toHaveValue('5.001');
  expect(screen.queryByTitle(/Reset to project DPT/)).not.toBeInTheDocument();
});
