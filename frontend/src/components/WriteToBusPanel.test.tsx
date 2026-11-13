import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { WriteToBusPanel } from './WriteToBusPanel';

const IDLE = { state: 'idle' };
const RUNNING_JOB = {
  state: 'running', id: 'abc', address: '1/2/3', interval_seconds: 5, sends_done: 3, sends_skipped: 0,
};

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
  localStorage.clear();
  vi.stubGlobal('fetch', mockFetch({ '/api/knx/send/scheduled/status': IDLE }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('sends immediately from a row when no delay or interval is set', async () => {
  const fetchMock = mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send': { status: 'sent' },
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<WriteToBusPanel targets={[]} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Group address/), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));

  await waitFor(() => expect(screen.getByText(/Sent 50 to 1\/2\/3/)).toBeInTheDocument());
});

test('adds and removes rows, sending to multiple GAs independently (#215)', async () => {
  const fetchMock = mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send': { status: 'sent' },
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<WriteToBusPanel targets={[]} onClose={() => {}} />);

  // One row initially; its delete button is disabled.
  expect(screen.getAllByPlaceholderText(/Group address/)).toHaveLength(1);
  expect(screen.getByRole('button', { name: /At least one row is required/ })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: /Add a row below/ }));
  const gaInputs = screen.getAllByPlaceholderText(/Group address/);
  expect(gaInputs).toHaveLength(2);

  fireEvent.change(gaInputs[0], { target: { value: '1/2/3' } });
  fireEvent.change(gaInputs[1], { target: { value: '4/5/6' } });
  const valueInputs = screen.getAllByPlaceholderText(/Value/);
  fireEvent.change(valueInputs[1], { target: { value: '1' } });
  fireEvent.click(screen.getAllByRole('button', { name: /Write/ })[1]);

  await waitFor(() => expect(screen.getByText(/Sent 1 to 4\/5\/6/)).toBeInTheDocument());
  const sendBody = JSON.parse(
    (fetchMock.mock.calls.find(([u]) => String(u).includes('/api/knx/send') && !String(u).includes('scheduled'))![1] as RequestInit).body as string
  );
  expect(sendBody.address).toBe('4/5/6');
});

test('plus inserts a row below the clicked one and trash removes that row', () => {
  render(<WriteToBusPanel targets={[]} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Group address/), { target: { value: '1/2/3' } });
  fireEvent.click(screen.getByRole('button', { name: /Add a row below/ }));

  let addresses = screen.getAllByPlaceholderText(/Group address/);
  fireEvent.change(addresses[1], { target: { value: '4/5/6' } });
  fireEvent.click(screen.getAllByRole('button', { name: /Add a row below/ })[0]);

  addresses = screen.getAllByPlaceholderText(/Group address/);
  expect(addresses.map(el => (el as HTMLInputElement).value)).toEqual(['1/2/3', '', '4/5/6']);

  fireEvent.click(screen.getAllByRole('button', { name: /Delete this row/ })[1]);
  addresses = screen.getAllByPlaceholderText(/Group address/);
  expect(addresses.map(el => (el as HTMLInputElement).value)).toEqual(['1/2/3', '4/5/6']);
});

test('starts a single scheduled job from a row and shows the cancel control', async () => {
  const fetchMock = mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send/scheduled': RUNNING_JOB,
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<WriteToBusPanel targets={[]} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Group address/), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });
  fireEvent.change(screen.getByPlaceholderText('Every s'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));

  await waitFor(() => expect(screen.getByText(/Cyclic send to 1\/2\/3 every 5s — 3 sent/)).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument();

  const scheduledCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/knx/send/scheduled'));
  const body = JSON.parse((scheduledCall![1] as RequestInit).body as string);
  expect(body.interval_seconds).toBe(5);
});

test('picks up an already-running job on mount', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/knx/send/scheduled/status': RUNNING_JOB }));
  render(<WriteToBusPanel targets={[]} onClose={() => {}} />);
  await waitFor(() => expect(screen.getByText(/Cyclic send to 1\/2\/3/)).toBeInTheDocument());
});

// ── Row persistence across panel toggling (#254) ─────────────────────────────

const ROWS_KEY = 'spectrumknx-write-panel-rows';

test('restores persisted rows on mount (#254)', () => {
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '9.001', value: '21.5', delay: '', every: '' },
    { address: '4/5/6', dpt: '', value: '1', delay: '2', every: '10' },
  ]));

  render(<WriteToBusPanel targets={[]} onClose={() => {}} />);

  const gaInputs = screen.getAllByPlaceholderText(/Group address/);
  expect(gaInputs).toHaveLength(2);
  expect(gaInputs[0]).toHaveValue('1/2/3');
  expect(gaInputs[1]).toHaveValue('4/5/6');
  expect(screen.getAllByPlaceholderText(/Value/)[0]).toHaveValue('21.5');
  expect(screen.getByDisplayValue('10')).toBeInTheDocument(); // "Every s" of row 2
  expect(screen.getByDisplayValue('9.001')).toBeInTheDocument(); // editable DPT field of row 1
});

test('persists row edits so toggling the panel keeps them (#254)', async () => {
  const { unmount } = render(<WriteToBusPanel targets={[]} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Group address/), { target: { value: '7/0/1' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '42' } });
  fireEvent.change(screen.getByPlaceholderText('Delay s'), { target: { value: '3' } });

  await waitFor(() => {
    expect(JSON.parse(localStorage.getItem(ROWS_KEY)!)).toEqual([
      { address: '7/0/1', dpt: '', value: '42', delay: '3', every: '' },
    ]);
  });

  // Simulate the visibility toggle: unmount and mount a fresh panel.
  unmount();
  render(<WriteToBusPanel targets={[]} onClose={() => {}} />);
  expect(screen.getByPlaceholderText(/Group address/)).toHaveValue('7/0/1');
  expect(screen.getByPlaceholderText(/Value/)).toHaveValue('42');
  expect(screen.getByPlaceholderText('Delay s')).toHaveValue('3');
});

test('falls back to a single empty row on malformed storage', () => {
  localStorage.setItem(ROWS_KEY, '{broken');
  render(<WriteToBusPanel targets={[]} onClose={() => {}} />);
  const gaInputs = screen.getAllByPlaceholderText(/Group address/);
  expect(gaInputs).toHaveLength(1);
  expect(gaInputs[0]).toHaveValue('');
});

test('DPT-1 target renders On/Off and records the GA in recents', async () => {
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send': { status: 'sent' },
  }));

  render(<WriteToBusPanel targets={[{ address: '12/0/0', name: 'Heating mode', main: 1, sub: 1 }]} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Group address/), { target: { value: '12/0/0' } });
  fireEvent.click(screen.getByRole('button', { name: /^on$/ }));

  await waitFor(() => expect(screen.getByText(/Sent on to 12\/0\/0/)).toBeInTheDocument());
  expect(JSON.parse(localStorage.getItem('spectrumknx-recent-send-gas')!)).toEqual(['12/0/0']);
});

// ── Last value per row (#439) ────────────────────────────────────────────────

const telegramOn = (address: string, over: Record<string, unknown> = {}) => ({
  timestamp: '2026-01-01T10:00:00.000000+00:00',
  source_address: '1.1.5', source_name: 'Sensor', target_address: address, target_name: null,
  direction: 'Incoming', telegram_type: 'GroupValueWrite', simplified_type: 'Write',
  dpt: '9.001', dpt_main: 9, dpt_sub: 1, dpt_name: 'Temperature', unit: '°C',
  value_numeric: 21.5, value_json: null, value_formatted: '21.5', raw_data: '0c1a', raw_hex: '0x0c1a',
  ...over,
});

const lastValueOf = () => screen.getByText('Last:').parentElement!;

test('shows the last value of the entered group address (#439)', async () => {
  const fetchMock = mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/telegrams/last': { telegrams: [telegramOn('1/2/3')] },
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<WriteToBusPanel targets={[]} onClose={() => {}} />);
  // Nothing to show until a complete group address is entered.
  expect(screen.queryByText('Last:')).not.toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText(/Group address/), { target: { value: '1/2/3' } });
  await waitFor(() => expect(lastValueOf()).toHaveTextContent('21.5 °C'));
  expect(lastValueOf()).toHaveTextContent('Write');
  expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/telegrams/last?target_address=1%2F2%2F3'))).toBe(true);
});

test('offers a go-to button beside a last value and not when there is none', async () => {
  const onGotoTelegram = vi.fn();
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/telegrams/last': { telegrams: [telegramOn('1/2/3')] },
  }));
  const { rerender } = render(
    <WriteToBusPanel targets={[]} onClose={() => {}} onGotoTelegram={onGotoTelegram} />,
  );
  fireEvent.change(screen.getByPlaceholderText(/Group address/), { target: { value: '1/2/3' } });
  const button = await screen.findByRole('button', { name: 'Go to telegram' });
  expect(button).toHaveClass('quick-filter-bar-toggle');
  expect(lastValueOf().compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  fireEvent.click(button);
  expect(onGotoTelegram).toHaveBeenCalledWith(expect.objectContaining({
    target_address: '1/2/3', value_formatted: '21.5',
  }));

  rerender(<WriteToBusPanel targets={[]} onClose={() => {}} onGotoTelegram={onGotoTelegram} />);
  fireEvent.change(screen.getByPlaceholderText(/Group address/), { target: { value: '1/2' } });
  expect(screen.queryByRole('button', { name: 'Go to telegram' })).not.toBeInTheDocument();
});

test('says so when the group address has no recorded value', async () => {
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/telegrams/last': { telegrams: [] },
  }));
  render(<WriteToBusPanel targets={[]} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Group address/), { target: { value: '1/2/3' } });
  await waitFor(() => expect(lastValueOf()).toHaveTextContent('no value yet'));
});

test('a read waits for the response, ignoring the read request itself (#439)', async () => {
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/telegrams/last': { telegrams: [telegramOn('1/2/3')] },
    '/api/knx/read': { status: 'sent' },
  }));
  const { rerender } = render(<WriteToBusPanel targets={[]} onClose={() => {}} latestTelegram={null} />);
  fireEvent.change(screen.getByPlaceholderText(/Group address/), { target: { value: '1/2/3' } });
  await waitFor(() => expect(lastValueOf()).toHaveTextContent('21.5 °C'));

  fireEvent.click(screen.getByRole('button', { name: /Read/ }));
  await waitFor(() => expect(lastValueOf()).toHaveTextContent('waiting for response'));

  // Our own read request comes back on the live feed: it has no value and must
  // neither replace the shown one nor end the wait.
  const readRequest = telegramOn('1/2/3', {
    timestamp: '2026-01-01T10:05:00.000000+00:00', telegram_type: 'GroupValueRead', simplified_type: 'Read',
    value_numeric: null, value_formatted: null, raw_data: null, raw_hex: null,
  });
  rerender(<WriteToBusPanel targets={[]} onClose={() => {}} latestTelegram={readRequest} />);
  expect(lastValueOf()).toHaveTextContent('21.5 °C');
  expect(lastValueOf()).toHaveTextContent('waiting for response');

  // A telegram for another address changes nothing.
  rerender(<WriteToBusPanel targets={[]} onClose={() => {}} latestTelegram={telegramOn('9/9/9', { value_formatted: '99' })} />);
  expect(lastValueOf()).toHaveTextContent('21.5 °C');

  const response = telegramOn('1/2/3', {
    timestamp: '2026-01-01T10:05:00.120000+00:00', telegram_type: 'GroupValueResponse', simplified_type: 'Response',
    value_numeric: 22.3, value_formatted: '22.3',
  });
  rerender(<WriteToBusPanel targets={[]} onClose={() => {}} latestTelegram={response} />);
  await waitFor(() => expect(lastValueOf()).toHaveTextContent('22.3 °C'));
  expect(lastValueOf()).toHaveTextContent('Response');
  expect(lastValueOf()).not.toHaveTextContent('waiting for response');
});

// ── Address and name fields stay paired ──────────────────────────────────────

const NAMED = [
  { address: '1/1/97', name: 'EGD_BWM55TG2A_Helligkeit', main: 9, sub: 4 },
  { address: '1/2/3', name: 'Living room light', main: 1, sub: 1 },
];

test('leaving the address field fills the matching name', () => {
  render(<WriteToBusPanel targets={NAMED} onClose={() => {}} />);
  const address = screen.getByPlaceholderText(/Group address/);
  const name = screen.getByPlaceholderText('Group name');
  fireEvent.change(address, { target: { value: '1/1/97' } });
  expect(name).toHaveValue('');
  fireEvent.blur(address);
  expect(name).toHaveValue('EGD_BWM55TG2A_Helligkeit');
  expect(address).toHaveValue('1/1/97');
});

test('leaving the name field fills the matching address', () => {
  render(<WriteToBusPanel targets={NAMED} onClose={() => {}} />);
  const address = screen.getByPlaceholderText(/Group address/);
  const name = screen.getByPlaceholderText('Group name');
  fireEvent.change(name, { target: { value: 'Living room light' } });
  expect(address).toHaveValue('');
  fireEvent.blur(name);
  expect(address).toHaveValue('1/2/3');
  expect(name).toHaveValue('Living room light');
});

test('Enter in the name field selects the highlighted suggestion', () => {
  render(<WriteToBusPanel targets={NAMED} onClose={() => {}} />);
  const name = screen.getByPlaceholderText('Group name');
  fireEvent.change(name, { target: { value: 'Helligkeit' } });
  fireEvent.keyDown(name, { key: 'Enter' });
  expect(screen.getByPlaceholderText(/Group address/)).toHaveValue('1/1/97');
  expect(name).toHaveValue('EGD_BWM55TG2A_Helligkeit');
});

test('an incomplete value resolves both fields of that row only', () => {
  render(<WriteToBusPanel targets={NAMED} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /Add a row below/ }));
  const addresses = screen.getAllByPlaceholderText(/Group address/);
  const names = screen.getAllByPlaceholderText('Group name');

  fireEvent.change(addresses[0], { target: { value: '1/1' } });
  fireEvent.blur(addresses[0]);
  expect(addresses[0]).toHaveValue('1/1/97');
  expect(names[0]).toHaveValue('EGD_BWM55TG2A_Helligkeit');
  expect(addresses[1]).toHaveValue('');
  expect(names[1]).toHaveValue('');

  fireEvent.change(names[1], { target: { value: 'Living' } });
  fireEvent.blur(names[1]);
  expect(addresses[1]).toHaveValue('1/2/3');
  expect(names[1]).toHaveValue('Living room light');
  expect(addresses[0]).toHaveValue('1/1/97');
  expect(names[0]).toHaveValue('EGD_BWM55TG2A_Helligkeit');
});

test('choosing a name suggestion updates both fields', () => {
  render(<WriteToBusPanel targets={NAMED} onClose={() => {}} />);
  const name = screen.getByPlaceholderText('Group name');
  fireEvent.change(name, { target: { value: 'Living' } });
  fireEvent.mouseDown(screen.getByRole('option', { name: /Living room light/ }));
  expect(screen.getByPlaceholderText(/Group address/)).toHaveValue('1/2/3');
  expect(name).toHaveValue('Living room light');
});
