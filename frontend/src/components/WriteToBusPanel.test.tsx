import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { BTN_DISABLED_MIX, BTN_MUTED_MIX } from '../utils/buttonStyles';
import { GaReadPhaseProvider } from './GaReadPhase';
import {
  WriteToBusPanel,
  SendJobStatusField,
  expectedPanelDpt,
  panelAddressesFromRows,
  mergeColTracks,
  midTracksTemplate,
  resolvePanelHeight,
  scrollLeftOnViewportResize,
  shouldAutoGrowPanelHeight,
} from './WriteToBusPanel';

test('status shell keeps its height when cleared and aligns count, time, and event', () => {
  const base = {
    feedback: null,
    job: { state: 'running' as const, interval_seconds: 5, sends_done: 3, address: '1/2/3' },
    showCountdownCol: false,
    showSendCountCol: true,
    showEventCols: true,
    showActionCol: true,
    actionWidth: '11px',
    address: '1/2/3',
    groupName: '',
    value: '',
    dpt: '',
    onCancel: () => {},
    onClear: () => {},
    onJump: () => {},
  };
  const readTg = telegramOn('1/2/3', {
    telegram_type: 'GroupValueRead',
    simplified_type: 'Read',
    value_numeric: null,
    value_formatted: null,
  });
  const responseTg = telegramOn('1/2/3', {
    timestamp: '2026-01-01T11:00:00.000000+00:00',
    telegram_type: 'GroupValueResponse',
    simplified_type: 'Response',
  });
  const { rerender } = render(
    <>
      <SendJobStatusField {...base} statusTelegram={readTg} />
      <SendJobStatusField {...base} statusTelegram={responseTg} />
    </>,
  );
  const shells = () => Array.from(document.querySelectorAll('[data-status-field]'));
  const filledHeight = shells()[0].style.height;
  expect(filledHeight).toBe(shells()[0].style.minHeight);
  expect(shells()[1].style.height).toBe(filledHeight);
  const grids = document.querySelectorAll('[data-status-grid]');
  expect(grids[0].style.gridTemplateColumns).toBe(grids[1].style.gridTemplateColumns);
  expect(grids[0].style.gridTemplateColumns).toContain('4ch');
  expect(grids[0].querySelector('[data-status-metric="count"]')).not.toBeNull();
  expect(grids[0].querySelector('[data-status-metric="when"]')).not.toBeNull();
  expect(grids[0].querySelector('[data-status-metric="event"]')?.textContent).toBe('READ');
  expect(grids[1].querySelector('[data-status-metric="event"]')?.textContent).toBe('RESPONSE');

  rerender(
    <SendJobStatusField
      {...base}
      statusTelegram={null}
      showEventCols={false}
      showSendCountCol={false}
      job={null}
    />,
  );
  expect(document.querySelector('[data-status-field]')!.style.height).toBe(filledHeight);
});

test('hiding the value column drops that track, not the DPT track', () => {
  const tracks = [90, 100, 20, 30, 40, 50, 60, 70];
  expect(midTracksTemplate(tracks, true)).toBe(
    'minmax(100px, 1fr) 20px 30px 40px 50px 60px 70px',
  );
  // 60px is DPT, directly before Value. 70px is Value and is the track that goes away.
  expect(midTracksTemplate(tracks, false)).toBe(
    'minmax(100px, 1fr) 20px 30px 40px 50px 60px',
  );
  expect(midTracksTemplate(null, false).split(' ').filter(part => part !== '1fr)')).toHaveLength(6);
});

test('mergeColTracks grows only unless shrink is allowed', () => {
  expect(mergeColTracks(null, [10, 20])).toEqual([10, 20]);
  expect(mergeColTracks([10, 30], [8, 40])).toEqual([10, 40]);
  expect(mergeColTracks([10, 30], [8, 40], { allowShrink: true })).toEqual([8, 40]);
});

test('scrollLeftOnViewportResize shifts left only when the bar appears or is at the right stop', () => {
  // Shrink makes the scrollbar appear: content 350 fit in 400, not in 300. Right edge stays.
  expect(scrollLeftOnViewportResize(0, 400, 300, 350)).toBe(50);
  // Thumb already at the right stop (600 of 1000-400). Shrink keeps that edge.
  expect(scrollLeftOnViewportResize(600, 400, 300, 1000)).toBe(700);
  // One pixel short of the stop still counts as the stop.
  expect(scrollLeftOnViewportResize(599, 400, 300, 1000)).toBe(699);
  // Scrollbar already visible and not at the stop: shrink leaves scrollLeft alone.
  expect(scrollLeftOnViewportResize(0, 400, 300, 800)).toBe(0);
  expect(scrollLeftOnViewportResize(200, 400, 300, 1000)).toBe(200);
  // Grow does not shift. A thumb at the stop stays there because of the clamp.
  expect(scrollLeftOnViewportResize(700, 300, 500, 1000)).toBe(500);
  expect(scrollLeftOnViewportResize(200, 300, 500, 1000)).toBe(200);
  // Unchanged viewport does not move, and content that still fits stays at 0.
  expect(scrollLeftOnViewportResize(40, 200, 200, 500)).toBe(40);
  expect(scrollLeftOnViewportResize(0, 400, 300, 250)).toBe(0);
});

test('mergeColTracks can protect columns from shrink (status with error)', () => {
  // Status col index 10: keep floor when protected during allowShrink.
  const prev = Array.from({ length: 13 }, (_, i) => (i === 10 ? 120 : 20));
  const next = Array.from({ length: 13 }, (_, i) => (i === 10 ? 80 : 15));
  expect(mergeColTracks(prev, next, { allowShrink: true, noShrinkCols: [10] })).toEqual(
    Array.from({ length: 13 }, (_, i) => (i === 10 ? 120 : 15)),
  );
  expect(mergeColTracks(prev, next, { allowShrink: true })).toEqual(next);
});

const HEIGHT_HANDLE = 'Drag to resize · double-click to reset';
const HEIGHT_PREF = 'spectrum-knx.send-panel-height';

test('the height resize handle resets a remembered panel height', () => {
  localStorage.setItem(HEIGHT_PREF, '240');
  const { container } = render(<WriteToBusPanel targets={[]} />);
  expect(screen.getByTitle(HEIGHT_HANDLE)).toBeInTheDocument();
  fireEvent.doubleClick(screen.getByTitle(HEIGHT_HANDLE));
  expect(localStorage.getItem(HEIGHT_PREF)).toBe('');
  // Reset clears the pref; host height follows measured max (may be unset in jsdom).
  const host = container.querySelector('.wtb-panel-host') as HTMLElement;
  expect(host).toBeTruthy();
});

test('resolvePanelHeight fits all when unset, otherwise honors a remembered height down to min', () => {
  const bounds = { min: 40, max: 280 };
  expect(resolvePanelHeight(null, bounds)).toBe(280);
  expect(resolvePanelHeight(120, bounds)).toBe(120);
  expect(resolvePanelHeight(30, bounds)).toBe(40);
  expect(resolvePanelHeight(500, bounds)).toBe(280);
});

test('shouldAutoGrowPanelHeight grows only when ≤8 rows and already at previous max', () => {
  expect(shouldAutoGrowPanelHeight({
    height: 200, prevMax: 200, nextMax: 240, rowCount: 5, dragging: false,
  })).toBe(true);
  expect(shouldAutoGrowPanelHeight({
    height: 200, prevMax: 200, nextMax: 240, rowCount: 8, dragging: false,
  })).toBe(true);
  expect(shouldAutoGrowPanelHeight({
    height: 200, prevMax: 200, nextMax: 240, rowCount: 9, dragging: false,
  })).toBe(false);
  expect(shouldAutoGrowPanelHeight({
    height: 120, prevMax: 200, nextMax: 240, rowCount: 5, dragging: false,
  })).toBe(false);
  expect(shouldAutoGrowPanelHeight({
    height: 200, prevMax: 200, nextMax: 240, rowCount: 5, dragging: true,
  })).toBe(false);
});

const ROWS_KEY = 'spectrumknx-write-panel-rows';

/** Mid template's first track is `minmax(..., 1fr)` (one extra whitespace token). */
function midTrackCount(container: HTMLElement): number {
  const inner = container.querySelector('.wtb-mid-inner') as HTMLElement;
  return inner.style.gridTemplateColumns.trim().split(/\s+/).length - 1;
}

const IDLE = { jobs: [] as unknown[] };
const RUNNING_JOB = {
  state: 'running',
  id: 'abc',
  address: '1/2/3',
  interval_seconds: 5,
  sends_done: 3,
  sends_skipped: 0,
  next_send_at: new Date(Date.now() + 4_000).toISOString(),
};
const WAITING_JOB = {
  state: 'waiting',
  id: 'delay-1',
  address: '1/2/3',
  delay_seconds: 30,
  interval_seconds: 5,
  sends_done: 0,
  sends_skipped: 0,
  next_send_at: new Date(Date.now() + 12_000).toISOString(),
};
const statusOf = (...jobs: unknown[]) => ({ jobs });

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
  try { localStorage.clear(); } catch { /* env may already be torn down */ }
});

test('the value column is hidden when every row is a button DPT', () => {
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '1.001', value: '', delay: '', every: '' },
    { address: '4/5/6', dpt: '1.001', value: '', delay: '', every: '' },
  ]));
  const { container } = render(<WriteToBusPanel targets={[]} />);
  expect(container.querySelector('[data-wtb-col="7"]')).toBeNull();
  expect(screen.getAllByRole('button', { name: /^on$/i })).toHaveLength(2);
  expect(midTrackCount(container)).toBe(6);
});

test('the value column stays when one row needs a value field', () => {
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '1.001', value: '', delay: '', every: '' },
    { address: '4/5/6', dpt: '9.001', value: '21', delay: '', every: '' },
  ]));
  const { container } = render(<WriteToBusPanel targets={[]} />);
  const cells = Array.from(container.querySelectorAll('[data-wtb-col="7"]'));
  expect(cells).toHaveLength(2);
  expect(cells.filter(el => el.querySelector('input'))).toHaveLength(1);
  expect(cells.filter(el => !el.querySelector('input'))).toHaveLength(1);
  expect(screen.getByRole('button', { name: /^on$/i })).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Value')).toHaveValue('21');
  expect(midTrackCount(container)).toBe(7);
});

/** Pixel widths of the mid tracks. The name track is `minmax(Npx, 1fr)`. */
function midTrackPx(template: string): number[] {
  const name = Number(template.match(/^minmax\((\d+)px/)?.[1] ?? NaN);
  const rest = template
    .replace(/^minmax\(\d+px,\s*1fr\)\s*/, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(part => Number(part.replace(/px$/, '')));
  return [name, ...rest];
}

test('changing a row DPT reoptimizes column tracks', () => {
  const rect = (width: number) => ({
    x: 0, y: 0, top: 0, left: 0, bottom: 16, right: width, width, height: 16, toJSON() { return {}; },
  }) as DOMRect;
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-dpt-field')) {
      const input = this.querySelector('input');
      const name = (this.textContent ?? '').length;
      return rect(((input?.value.length ?? 0) + name) * 8 + 24);
    }
    if (this.hasAttribute('data-value-field')) {
      const input = this.querySelector('input');
      return rect(((input?.value || input?.placeholder || '').length + 1) * 10);
    }
    return rect(24);
  });

  try {
    localStorage.setItem(ROWS_KEY, JSON.stringify([
      { address: '1/2/3', dpt: '9.001', value: '21.5', delay: '', every: '' },
    ]));
    const { container } = render(<WriteToBusPanel targets={[]} />);
    const template = () => (container.querySelector('.wtb-mid-inner') as HTMLElement).style.gridTemplateColumns;
    const before = midTrackPx(template());
    const dptBefore = before[5];
    const valueBefore = before[6];
    expect(dptBefore).toBeGreaterThan(valueBefore);

    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '1' } });
    const afterValue = midTrackPx(template());
    expect(afterValue[6]).toBeGreaterThanOrEqual(valueBefore);

    fireEvent.change(screen.getByLabelText('Datapoint type'), { target: { value: '1.001' } });
    fireEvent.blur(screen.getByLabelText('Datapoint type'));
    const afterDpt = midTrackPx(template());
    expect(afterDpt[5]).toBeLessThan(dptBefore);
    expect(container.querySelector('[data-wtb-col="7"]')).toBeNull();
  } finally {
    spy.mockRestore();
  }
});

test('sends immediately from a row when no delay or interval is set', async () => {
  const fetchMock = mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send': { status: 'sent' },
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<WriteToBusPanel targets={[]} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));

  await waitFor(() => expect(screen.getByLabelText(/written '50' to 1\/2\/3/)).toBeInTheDocument());
});

test('ctrl-click Read switches to Response mode so Write sends a response', async () => {
  const fetchMock = mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send': { status: 'sent' },
    '/api/knx/read': { status: 'sent' },
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<WriteToBusPanel targets={[]} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });

  fireEvent.click(screen.getByRole('button', { name: /^Read$/ }), { ctrlKey: true });
  const responseBtn = screen.getByRole('button', { name: /^Response$/ });
  const sentToBus = (url: string) =>
    (url.includes('/api/knx/send') && !url.includes('scheduled')) || url.includes('/api/knx/read');
  expect(fetchMock.mock.calls.some(([u]) => sentToBus(String(u)))).toBe(false);

  fireEvent.click(responseBtn);
  expect(fetchMock.mock.calls.some(([u]) => sentToBus(String(u)))).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/knx/send') && !String(u).includes('scheduled'));
    expect(JSON.parse((call![1] as RequestInit).body as string)).toMatchObject({
      address: '1/2/3',
      payload: 50,
      response: true,
    });
  });
  expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/knx/read'))).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: /^Response$/ }), { metaKey: true });
  expect(screen.getByRole('button', { name: /^Read$/ })).toBeInTheDocument();
});

test('Response dims like the write button for the value being sent', async () => {
  const job = {
    ...RUNNING_JOB,
    id: 'resp-on',
    payload: true,
    response: true,
  };
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': statusOf(job),
  }));
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    {
      address: '1/2/3', dpt: '1.001', value: '', delay: '', every: '5',
      respond: true, scheduledJobId: job.id,
    },
  ]));

  render(<WriteToBusPanel targets={[]} />);
  await waitFor(() => expect(screen.getByRole('button', { name: /^on$/i })).toBeDisabled());

  const on = screen.getByRole('button', { name: /^on$/i }) as HTMLButtonElement;
  const off = screen.getByRole('button', { name: /^off$/i }) as HTMLButtonElement;
  const response = screen.getByRole('button', { name: /^Response$/ }) as HTMLButtonElement;
  // "on" is the value this job sends: normal disabled tone. "off" fades further.
  expect(on.style.background).toContain(`${BTN_DISABLED_MIX}%`);
  expect(off.style.background).toContain(`${BTN_MUTED_MIX}%`);
  expect(response.style.color).toContain(`${BTN_DISABLED_MIX}%`);
  expect(response.style.border).toContain(`${BTN_DISABLED_MIX}%`);
  expect(response.style.color).not.toContain(`${BTN_MUTED_MIX}%`);
});

test('Read stays extra-dimmed during a write job', async () => {
  const job = { ...RUNNING_JOB, id: 'write-on', payload: true };
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': statusOf(job),
  }));
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    {
      address: '1/2/3', dpt: '1.001', value: '', delay: '', every: '5',
      respond: false, scheduledJobId: job.id,
    },
  ]));

  render(<WriteToBusPanel targets={[]} />);
  const read = await waitFor(() => {
    const btn = screen.getByRole('button', { name: /^Read$/ }) as HTMLButtonElement;
    expect(btn).toBeDisabled();
    return btn;
  });
  const on = screen.getByRole('button', { name: /^on$/i }) as HTMLButtonElement;
  expect(on.style.background).toContain(`${BTN_DISABLED_MIX}%`);
  expect(read.style.color).toContain(`${BTN_MUTED_MIX}%`);
});

test('adds and removes rows, sending to multiple GAs independently (#215)', async () => {
  const fetchMock = mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send': { status: 'sent' },
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<WriteToBusPanel targets={[]} />);

  // One row initially; plain delete is blocked (aria-disabled), ctrl-reset stays available.
  expect(screen.getAllByPlaceholderText('GA')).toHaveLength(1);
  const minus = screen.getByRole('button', { name: /At least one row is required/ });
  const plus = screen.getByRole('button', { name: /Add a row below/ });
  expect(minus).toHaveAttribute('aria-disabled', 'true');
  // Dim via color, not opacity — so a focus ring would stay full strength.
  expect(minus.style.opacity).toBe('');
  expect(minus.style.color).toMatch(/color-mix/);
  // Minus/Plus share the same icon box and stroke so they read as equal size.
  expect(minus.style.width).toBe(plus.style.width);
  expect(minus.style.height).toBe(plus.style.height);
  const minusSvg = minus.querySelector('svg');
  const plusSvg = plus.querySelector('svg');
  expect(minusSvg?.getAttribute('width')).toBe(plusSvg?.getAttribute('width'));
  expect(minusSvg?.getAttribute('height')).toBe(plusSvg?.getAttribute('height'));
  expect(minusSvg?.getAttribute('stroke-width')).toBe(plusSvg?.getAttribute('stroke-width'));
  fireEvent.click(minus);
  expect(screen.getAllByPlaceholderText('GA')).toHaveLength(1);

  fireEvent.click(screen.getByRole('button', { name: /Add a row below/ }));
  const gaInputs = screen.getAllByPlaceholderText('GA');
  expect(gaInputs).toHaveLength(2);

  fireEvent.change(gaInputs[0], { target: { value: '1/2/3' } });
  fireEvent.change(gaInputs[1], { target: { value: '4/5/6' } });
  const valueInputs = screen.getAllByPlaceholderText(/Value/);
  fireEvent.change(valueInputs[1], { target: { value: '1' } });
  fireEvent.click(screen.getAllByRole('button', { name: /Write/ })[1]);

  await waitFor(() => expect(screen.getByLabelText(/written '1' to 4\/5\/6/)).toBeInTheDocument());
  const sendBody = JSON.parse(
    (fetchMock.mock.calls.find(([u]) => String(u).includes('/api/knx/send') && !String(u).includes('scheduled'))![1] as RequestInit).body as string
  );
  expect(sendBody.address).toBe('4/5/6');
});

test('plus inserts a row below the clicked one and minus removes that row', async () => {
  render(<WriteToBusPanel targets={[]} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.click(screen.getByRole('button', { name: /Add a row below/ }));

  let addresses = screen.getAllByPlaceholderText('GA');
  fireEvent.change(addresses[1], { target: { value: '4/5/6' } });
  fireEvent.click(screen.getAllByRole('button', { name: /Add a row below/ })[0]);

  addresses = screen.getAllByPlaceholderText('GA');
  expect(addresses.map(el => (el as HTMLInputElement).value)).toEqual(['1/2/3', '', '4/5/6']);

  fireEvent.click(screen.getAllByRole('button', { name: /Delete this row/ })[1]);
  await waitFor(() => {
    addresses = screen.getAllByPlaceholderText('GA');
  expect(addresses.map(el => (el as HTMLInputElement).value)).toEqual(['1/2/3', '4/5/6']);
  });
});

test('ctrl-click minus initializes only the clicked row', () => {
  render(<WriteToBusPanel targets={[]} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });
  fireEvent.change(screen.getByPlaceholderText('every'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: /Add a row below/ }));
  fireEvent.change(screen.getAllByPlaceholderText('GA')[1], { target: { value: '4/5/6' } });
  fireEvent.change(screen.getAllByPlaceholderText(/Value/)[1], { target: { value: '1' } });
  fireEvent.change(screen.getAllByPlaceholderText('every')[1], { target: { value: '9' } });
  fireEvent.click(screen.getAllByRole('button', { name: /Add a row below/ })[1]);
  fireEvent.change(screen.getAllByPlaceholderText('GA')[2], { target: { value: '7/8/9' } });

  fireEvent.click(screen.getAllByRole('button', { name: /Delete this row/ })[1], { ctrlKey: true });

  expect(screen.getAllByPlaceholderText('GA').map(el => (el as HTMLInputElement).value))
    .toEqual(['1/2/3', '', '7/8/9']);
  const values = screen.getAllByPlaceholderText(/Value/) as HTMLInputElement[];
  expect(values.map(el => el.value)).toEqual(['50', '', '']);
  const everys = screen.getAllByPlaceholderText('every') as HTMLInputElement[];
  expect(everys.map(el => el.value)).toEqual(['5', '', '']);
});

test('minus on the only row does not clear it; ctrl-click initializes it', () => {
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '1.001', value: '1', delay: '2', every: '5' },
  ]));
  render(<WriteToBusPanel targets={[]} />);
  const minus = screen.getByRole('button', { name: /At least one row is required/ });
  expect(minus).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(minus);
  expect(screen.getByPlaceholderText('GA')).toHaveValue('1/2/3');
  expect(screen.getByPlaceholderText('delay')).toHaveValue('2');
  expect(screen.getByPlaceholderText('every')).toHaveValue('5');
  expect(screen.getAllByPlaceholderText('GA')).toHaveLength(1);

  fireEvent.click(minus, { ctrlKey: true });
  expect(screen.getByPlaceholderText('GA')).toHaveValue('');
  expect(screen.getByPlaceholderText('delay')).toHaveValue('');
  expect(screen.getByPlaceholderText('every')).toHaveValue('');
  expect(screen.getAllByPlaceholderText('GA')).toHaveLength(1);
});

test('ctrl-click plus duplicates the row without an active job', async () => {
  const fetchMock = mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send/scheduled': RUNNING_JOB,
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<WriteToBusPanel targets={[]} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });
  fireEvent.change(screen.getByPlaceholderText('delay'), { target: { value: '2' } });
  fireEvent.change(screen.getByPlaceholderText('every'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));

  await waitFor(() => expect(screen.getByLabelText(/cyclic send to 1\/2\/3 every 5s/)).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeInTheDocument();
  // One Cancel row — header Cancel stays hidden.
  expect(screen.queryByTitle('Cancel all jobs')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Add a row below/ }), { ctrlKey: true });

  const addresses = screen.getAllByPlaceholderText('GA');
  expect(addresses.map(el => (el as HTMLInputElement).value)).toEqual(['1/2/3', '1/2/3']);
  expect((screen.getAllByPlaceholderText(/Value/)[1] as HTMLInputElement).value).toBe('50');
  expect((screen.getAllByPlaceholderText('delay')[1] as HTMLInputElement).value).toBe('2');
  expect((screen.getAllByPlaceholderText('every')[1] as HTMLInputElement).value).toBe('5');
  // Copy inherits fields only — the live job stays on the source row.
  expect(screen.getAllByRole('button', { name: /^Cancel$/ })).toHaveLength(1);
});

test('starts a single scheduled job from a row and shows the cancel control', async () => {
  const fetchMock = mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send/scheduled': RUNNING_JOB,
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<WriteToBusPanel targets={[]} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });
  fireEvent.change(screen.getByPlaceholderText('every'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));

  await waitFor(() => expect(screen.getByLabelText(/cyclic send to 1\/2\/3 every 5s/)).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Clear status' })).not.toBeInTheDocument();

  const scheduledCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/knx/send/scheduled'));
  const body = JSON.parse((scheduledCall![1] as RequestInit).body as string);
  expect(body.interval_seconds).toBe(5);
});

test('minus deletes a row with an active job and cancels that job', async () => {
  const cancelBodies: unknown[] = [];
  const activeJobs: Record<string, unknown> = { [RUNNING_JOB.id]: { ...RUNNING_JOB } };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => ({ jobs: Object.values(activeJobs) }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled/cancel')) {
      cancelBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
      const body = init?.body ? JSON.parse(String(init.body)) as { id?: string } : {};
      if (body.id) delete activeJobs[body.id];
      else Object.keys(activeJobs).forEach(k => { delete activeJobs[k]; });
      return { ok: true, json: async () => ({ status: 'ok' }) } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', name: 'Light', dpt: '5.001', value: '50', delay: '', every: '5', scheduledJobId: RUNNING_JOB.id },
    { address: '4/5/6', dpt: '', value: '', delay: '', every: '' },
  ]));

  render(<WriteToBusPanel targets={[]} />);
  await waitFor(() => expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeInTheDocument());

  const gas = screen.getAllByPlaceholderText('GA') as HTMLInputElement[];
  const names = screen.getAllByPlaceholderText('Group name') as HTMLInputElement[];
  const values = screen.getAllByRole('textbox', { name: 'Value' }) as HTMLInputElement[];
  const dpts = screen.getAllByRole('textbox', { name: 'Datapoint type' }) as HTMLInputElement[];
  const deletes = screen.getAllByRole('button', { name: /Delete this row/ });
  expect(gas[0]).toBeDisabled();
  expect(names[0]).toBeDisabled();
  expect(values[0]).toBeDisabled();
  expect(dpts[0]).toBeDisabled();
  expect(deletes[0]).toBeEnabled();
  fireEvent.change(gas[0], { target: { value: '9/9/9' } });
  fireEvent.change(names[0], { target: { value: 'Other' } });
  fireEvent.change(values[0], { target: { value: '1' } });
  fireEvent.change(dpts[0], { target: { value: '1.001' } });
  expect(gas[0]).toHaveValue('1/2/3');
  expect(names[0]).toHaveValue('Light');
  expect(values[0]).toHaveValue('50');
  expect(dpts[0]).toHaveValue('5.001');
  expect(gas[1]).toBeEnabled();
  expect(deletes[1]).toBeEnabled();

  fireEvent.click(deletes[0]);
  await waitFor(() => expect(cancelBodies).toEqual([{ id: RUNNING_JOB.id }]));
  expect(screen.getAllByPlaceholderText('GA')).toHaveLength(1);
  expect(screen.getByPlaceholderText('GA')).toHaveValue('4/5/6');
  expect(screen.queryByRole('button', { name: /^Cancel$/ })).not.toBeInTheDocument();
});

test('ctrl-click minus cancels and initializes only the clicked row', async () => {
  const jobA = { ...RUNNING_JOB, id: 'job-a', address: '1/2/3' };
  const jobB = { ...RUNNING_JOB, id: 'job-b', address: '4/5/6' };
  const activeJobs: Record<string, unknown> = { 'job-a': jobA, 'job-b': jobB };
  const cancelBodies: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => ({ jobs: Object.values(activeJobs) }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled/cancel')) {
      const body = init?.body ? JSON.parse(String(init.body)) as { id?: string } : {};
      cancelBodies.push(body);
      if (body.id) delete activeJobs[body.id];
      return { ok: true, json: async () => ({ status: 'ok' }) } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', name: 'Light', dpt: '5.001', value: '50', delay: '2', every: '5', scheduledJobId: 'job-a' },
    { address: '4/5/6', name: 'Other', dpt: '5.001', value: '1', delay: '3', every: '9', scheduledJobId: 'job-b' },
  ]));

  render(<WriteToBusPanel targets={[]} />);
  await waitFor(() => expect(screen.getAllByRole('button', { name: /^Cancel$/ })).toHaveLength(2));

  fireEvent.click(screen.getAllByRole('button', { name: /Delete this row/ })[0], { ctrlKey: true });

  await waitFor(() => expect(cancelBodies).toEqual([{ id: 'job-a' }]));
  expect(screen.getAllByPlaceholderText('GA')).toHaveLength(2);
  const gas = screen.getAllByPlaceholderText('GA') as HTMLInputElement[];
  const names = screen.getAllByPlaceholderText('Group name') as HTMLInputElement[];
  const values = screen.getAllByRole('textbox', { name: 'Value' }) as HTMLInputElement[];
  const delays = screen.getAllByPlaceholderText('delay') as HTMLInputElement[];
  const everys = screen.getAllByPlaceholderText('every') as HTMLInputElement[];
  expect(gas.map(el => el.value)).toEqual(['', '4/5/6']);
  expect(names.map(el => el.value)).toEqual(['', 'Other']);
  expect(values.map(el => el.value)).toEqual(['', '1']);
  expect(delays.map(el => el.value)).toEqual(['', '3']);
  expect(everys.map(el => el.value)).toEqual(['', '9']);
  expect(screen.getAllByRole('button', { name: /^Cancel$/ })).toHaveLength(1);
  expect(screen.getByLabelText(/cyclic send to 4\/5\/6/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/cyclic send to 1\/2\/3/)).not.toBeInTheDocument();
  expect(screen.queryByTitle('Cancel all jobs')).not.toBeInTheDocument();
});

test('minus deletes a row while start is pending and cancels the job', async () => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const cancelBodies: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => IDLE } as Response;
    }
    if (url.includes('/api/knx/send/scheduled/cancel')) {
      cancelBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
      return { ok: true, json: async () => ({ status: 'ok' }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled')) {
      await gate;
      return { ok: true, json: async () => RUNNING_JOB } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));

  render(<WriteToBusPanel targets={[]} />);
  fireEvent.click(screen.getByRole('button', { name: /Add a row below/ }));
  fireEvent.change(screen.getAllByPlaceholderText('GA')[0], { target: { value: '1/2/3' } });
  fireEvent.change(screen.getAllByPlaceholderText(/Value/)[0], { target: { value: '50' } });
  fireEvent.change(screen.getAllByPlaceholderText('every')[0], { target: { value: '5' } });
  fireEvent.click(screen.getAllByRole('button', { name: /Write/ })[0]);

  await waitFor(() => expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeInTheDocument());
  const minus = screen.getAllByRole('button', { name: /Delete this row/ })[0];
  expect(minus).toBeEnabled();
  fireEvent.click(minus);
  await waitFor(() => expect(screen.getAllByPlaceholderText('GA')).toHaveLength(1));
  expect(screen.queryByRole('button', { name: /^Cancel$/ })).not.toBeInTheDocument();

  release();
  await waitFor(() => expect(cancelBodies).toEqual([{ id: RUNNING_JOB.id }]));
  expect(screen.queryByRole('button', { name: /^Cancel$/ })).not.toBeInTheDocument();
  expect(screen.getAllByPlaceholderText('GA')).toHaveLength(1);
});

test('delay and every are locked while that row job is waiting or running', async () => {
  for (const job of [RUNNING_JOB, WAITING_JOB]) {
    vi.stubGlobal('fetch', mockFetch({ '/api/knx/send/scheduled/status': statusOf(job) }));
    localStorage.setItem(ROWS_KEY, JSON.stringify([
      { address: '1/2/3', dpt: '', value: '50', delay: '2', every: '5', scheduledJobId: job.id },
      { address: '4/5/6', dpt: '', value: '', delay: '', every: '' },
    ]));
    const view = render(<WriteToBusPanel targets={[]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeInTheDocument());

    const delays = screen.getAllByPlaceholderText('delay') as HTMLInputElement[];
    const everys = screen.getAllByPlaceholderText('every') as HTMLInputElement[];
    expect(delays[0]).toBeDisabled();
    expect(everys[0]).toBeDisabled();
    expect(delays[0]).toHaveValue('2');
    expect(everys[0]).toHaveValue('5');
    fireEvent.change(delays[0], { target: { value: '99' } });
    fireEvent.change(everys[0], { target: { value: '99' } });
    expect(delays[0]).toHaveValue('2');
    expect(everys[0]).toHaveValue('5');

    expect(delays[1]).toBeEnabled();
    expect(everys[1]).toBeEnabled();
    fireEvent.change(delays[1], { target: { value: '8' } });
    expect(delays[1]).toHaveValue('8');

    view.unmount();
  }
});

test('picks up an already-running job on mount', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/knx/send/scheduled/status': statusOf(RUNNING_JOB) }));
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '', value: '', delay: '', every: '', scheduledJobId: RUNNING_JOB.id },
  ]));
  render(<WriteToBusPanel targets={[]} />);
  await waitFor(() => expect(screen.getByLabelText(/cyclic send to 1\/2\/3/)).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeInTheDocument();
  const shell = screen.getByLabelText(/cyclic send to 1\/2\/3/).closest('[data-status-field]')!;
  expect(shell.querySelector('[data-status-metric="count"]')).not.toBeNull();
  expect(shell.querySelector('[data-status-metric="countdown"]')).not.toBeNull();
  expect(shell.textContent).toMatch(/-\d+s|-\d+:\d{2}/);
  expect(screen.getByLabelText(/Sends done 3/)).toHaveTextContent('3');
});

test('a locked row ignores Write and leaves both jobs running', async () => {
  const jobA = { ...RUNNING_JOB, id: 'job-a', address: '1/2/3' };
  const jobB = { ...RUNNING_JOB, id: 'job-b', address: '4/5/6' };
  const cancelBodies: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => statusOf(jobA, jobB) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled/cancel')) {
      cancelBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
      return { ok: true, json: async () => ({ status: 'ok' }) } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '5', value: 'abc', delay: '', every: '5', scheduledJobId: 'job-a' },
    { address: '4/5/6', dpt: '5', value: '1', delay: '', every: '5', scheduledJobId: 'job-b' },
  ]));

  render(<WriteToBusPanel targets={[]} />);
  await waitFor(() => expect(screen.getAllByRole('button', { name: /^Cancel$/ })).toHaveLength(2));
  expect(screen.getAllByRole('button', { name: /Write/ })[0]).toBeDisabled();

  fireEvent.click(screen.getAllByRole('button', { name: /Write/ })[0]);

  expect(screen.queryByText('Invalid value: abc')).not.toBeInTheDocument();
  expect(cancelBodies).toEqual([]);
  expect(screen.getAllByRole('button', { name: /^Cancel$/ })).toHaveLength(2);
  expect(screen.getByLabelText(/cyclic send to 1\/2\/3/)).toBeInTheDocument();
  expect(screen.getByLabelText(/cyclic send to 4\/5\/6/)).toBeInTheDocument();
});

test('count column stays hidden until a cyclic job has sent at least once', async () => {
  const cyclicNotYetSent = {
    state: 'running',
    id: 'cyc-0',
    address: '1/2/3',
    interval_seconds: 5,
    sends_done: 0,
    sends_skipped: 0,
    next_send_at: new Date(Date.now() + 3_000).toISOString(),
  };
  vi.stubGlobal('fetch', mockFetch({ '/api/knx/send/scheduled/status': statusOf(cyclicNotYetSent) }));
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '', value: '', delay: '', every: '5', scheduledJobId: 'cyc-0' },
    { address: '', dpt: '', value: '', delay: '', every: '' },
  ]));
  render(<WriteToBusPanel targets={[]} />);
  await waitFor(() => expect(screen.getByLabelText(/cyclic send to 1\/2\/3/)).toBeInTheDocument());
  const shells = document.querySelectorAll('[data-status-field]');
  expect(shells).toHaveLength(2);
  for (const shell of shells) {
    expect(shell.querySelector('[data-status-metric="count"]')).toBeNull();
    expect(shell.querySelector('[data-status-metric="countdown"]')).not.toBeNull();
  }
  expect(screen.queryByLabelText(/Sends done/)).not.toBeInTheDocument();
});

test('delayed job opens the countdown metric column on every row', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/knx/send/scheduled/status': statusOf(WAITING_JOB) }));
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '', value: '', delay: '30', every: '', scheduledJobId: WAITING_JOB.id },
    { address: '', dpt: '', value: '', delay: '', every: '' },
  ]));
  render(<WriteToBusPanel targets={[]} />);
  await waitFor(() => expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeInTheDocument());
  const shells = document.querySelectorAll('[data-status-field]');
  expect(shells).toHaveLength(2);
  // Panel-wide: countdown slot on both rows; only the delayed row shows a value.
  expect(shells[0].querySelector('[data-status-metric="countdown"]')?.textContent).toMatch(/-/);
  expect(shells[1].querySelector('[data-status-metric="countdown"]')).not.toBeNull();
  expect(shells[1].querySelector('[data-status-metric="countdown"]')?.textContent?.trim() ?? '').toBe('');
  expect(shells[0].querySelector('[data-status-metric="count"]')).toBeNull();
  expect(shells[1].querySelector('[data-status-metric="count"]')).toBeNull();
});

test('delayed job shows a countdown before the first send', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/knx/send/scheduled/status': statusOf(WAITING_JOB) }));
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '', value: '', delay: '30', every: '', scheduledJobId: WAITING_JOB.id },
  ]));
  render(<WriteToBusPanel targets={[]} />);
  await waitFor(() => expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeInTheDocument());
  const shell = screen.getByRole('button', { name: /^Cancel$/ }).closest('[data-status-field]')!;
  expect(shell.textContent).toMatch(/-\d+s|-\d+:\d{2}/);
  expect(shell.textContent).not.toMatch(/#\d/);
  expect(shell.querySelector('.lucide-timer')).not.toBeNull();
  expect(shell.querySelector('[data-status-metric="countdown"]')).not.toBeNull();
  expect(shell.querySelector('[data-status-metric="count"]')).toBeNull();
});

test('metric columns stay hidden until a delayed or cyclic job is active', async () => {
  const fetchMock = mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send': { status: 'sent' },
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<WriteToBusPanel targets={[]} />);
  fireEvent.click(screen.getByRole('button', { name: /Add a row below/ }));
  const shells = () => Array.from(document.querySelectorAll('[data-status-field]'));
  expect(shells()).toHaveLength(2);
  for (const shell of shells()) {
    expect(shell.querySelector('[data-status-metric]')).toBeNull();
    expect(shell.querySelector('[data-status-action]')).toBeNull();
  }

  fireEvent.change(screen.getAllByPlaceholderText('GA')[0], { target: { value: '1/2/3' } });
  fireEvent.change(screen.getAllByPlaceholderText(/Value/)[0], { target: { value: '50' } });
  fireEvent.click(screen.getAllByRole('button', { name: /Write/ })[0]);
  await waitFor(() => expect(screen.getByLabelText(/written '50' to 1\/2\/3/)).toBeInTheDocument());
  // Immediate write must not open metric columns on either row.
  for (const shell of shells()) {
    expect(shell.querySelector('[data-status-metric]')).toBeNull();
  }
  // Non-empty status opens the action column on every row (Clear on the busy one).
  expect(shells()[0].querySelector('[data-status-action]')).not.toBeNull();
  expect(shells()[1].querySelector('[data-status-action]')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Clear status' })).toBeInTheDocument();
  expect(shells()[1].querySelector('[data-status-action]')!.querySelector('button')).toBeNull();
});

test('action column hides again when every row status is cleared', async () => {
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send': { status: 'sent' },
  }));
  render(<WriteToBusPanel targets={[]} />);
  fireEvent.click(screen.getByRole('button', { name: /Add a row below/ }));
  expect(document.querySelector('[data-status-action]')).toBeNull();

  fireEvent.change(screen.getAllByPlaceholderText('GA')[0], { target: { value: '1/2/3' } });
  fireEvent.change(screen.getAllByPlaceholderText(/Value/)[0], { target: { value: '50' } });
  fireEvent.click(screen.getAllByRole('button', { name: /Write/ })[0]);
  await screen.findByRole('button', { name: 'Clear status' });
  expect(document.querySelectorAll('[data-status-action]')).toHaveLength(2);

  fireEvent.click(screen.getByRole('button', { name: 'Clear status' }));
  await waitFor(() => expect(document.querySelector('[data-status-action]')).toBeNull());
  expect(screen.queryByRole('button', { name: 'Clear status' })).not.toBeInTheDocument();
});

test('action column is narrow for Clear-only and widens for Cancel', async () => {
  const activeJobs: Record<string, unknown> = {};
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => ({ jobs: Object.values(activeJobs) }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled/cancel')) {
      for (const id of Object.keys(activeJobs)) delete activeJobs[id];
      return { ok: true, json: async () => ({ status: 'ok' }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled')) {
      activeJobs[WAITING_JOB.id] = WAITING_JOB;
      return { ok: true, json: async () => WAITING_JOB } as Response;
    }
    if (url.includes('/api/knx/send') && !url.includes('scheduled')) {
      return { ok: true, json: async () => ({ status: 'sent' }) } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));

  render(<WriteToBusPanel targets={[]} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));

  const clearBtn = await screen.findByRole('button', { name: 'Clear status' });
  const clearTrack = clearBtn.closest('[data-status-action]') as HTMLElement;
  expect(clearTrack.style.width).toBe('11px');
  expect(clearTrack.style.minWidth).toBe('11px');

  fireEvent.change(screen.getByPlaceholderText('delay'), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  const cancel = await screen.findByRole('button', { name: /^Cancel$/ });
  const cancelTrack = cancel.closest('[data-status-action]') as HTMLElement;
  expect(cancelTrack.style.width).toBe('4.25rem');
  expect(cancelTrack.style.minWidth).toBe('4.25rem');
});

test('shows countdown immediately on delayed Write click', async () => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => IDLE } as Response;
    }
    if (url.includes('/api/knx/send/scheduled')) {
      await gate;
      return { ok: true, json: async () => WAITING_JOB } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));

  const { container } = render(<WriteToBusPanel targets={[]} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });
  fireEvent.change(screen.getByPlaceholderText('delay'), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));

  // Before the scheduled API resolves — optimistic countdown + Cancel.
  await screen.findByRole('button', { name: /^Cancel$/ });
  const shell = container.querySelector('[data-status-field]') as HTMLElement;
  expect(shell).not.toBeNull();
  expect(shell.textContent).toMatch(/-\d+s|-\d+:\d{2}/);
  expect(shell.querySelector('.lucide-timer')).not.toBeNull();

  release();
  await waitFor(() => expect(shell.getAttribute('aria-label') ?? '').toMatch(/delayed send to 1\/2\/3/));
});

test('delay and every show unit s beside the value inside the field shell', () => {
  const { container } = render(<WriteToBusPanel targets={[]} />);
  expect(container.querySelectorAll('[data-seconds-field]')).toHaveLength(2);
  expect(screen.queryByText('s')).not.toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  const delay = screen.getByPlaceholderText('delay');
  const every = screen.getByPlaceholderText('every');
  fireEvent.change(delay, { target: { value: '2' } });
  fireEvent.change(every, { target: { value: '5' } });

  const units = screen.getAllByText('s');
  expect(units).toHaveLength(2);
  const shells = container.querySelectorAll('[data-seconds-field]');
  expect(shells[0]).toContainElement(units[0]);
  expect(shells[1]).toContainElement(units[1]);
  expect(delay.nextElementSibling).toBe(units[0]);
  expect(every.nextElementSibling).toBe(units[1]);
  expect(delay).toHaveStyle({ textAlign: 'right' });
  expect(every).toHaveStyle({ textAlign: 'right' });
  const dpt = screen.getByLabelText('Datapoint type');
  const value = screen.getByLabelText('Value');
  expect(every.compareDocumentPosition(dpt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(dpt.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(delay.closest('[data-wtb-col]')?.getAttribute('data-wtb-col')).toBe('4');
  expect(every.closest('[data-wtb-col]')?.getAttribute('data-wtb-col')).toBe('5');
  expect(dpt.closest('[data-wtb-col]')?.getAttribute('data-wtb-col')).toBe('6');
  expect(value.closest('[data-wtb-col]')?.getAttribute('data-wtb-col')).toBe('7');
});

test('delay and every are disabled until a GA is entered', () => {
  render(<WriteToBusPanel targets={[]} />);
  const delay = screen.getByPlaceholderText('delay');
  const every = screen.getByPlaceholderText('every');
  expect(delay).toBeDisabled();
  expect(every).toBeDisabled();
  expect(delay).toHaveAttribute('title', 'Enter a group address first');
  expect(every).toHaveAttribute('title', 'Enter a group address first');

  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  expect(delay).not.toBeDisabled();
  expect(every).not.toBeDisabled();
});

test('delay and every clear invalid input only on blur', () => {
  render(<WriteToBusPanel targets={[]} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  const delay = screen.getByPlaceholderText('delay');
  const every = screen.getByPlaceholderText('every');

  // While typing, keep the raw text (so multi-digit entry isn't wiped mid-keystroke).
  fireEvent.change(delay, { target: { value: '0' } });
  expect(delay).toHaveValue('0');
  fireEvent.blur(delay);
  expect(delay).toHaveValue('');

  fireEvent.change(every, { target: { value: '1.5' } });
  expect(every).toHaveValue('1.5');
  fireEvent.blur(every);
  expect(every).toHaveValue('');

  fireEvent.change(delay, { target: { value: '2,5' } });
  fireEvent.blur(delay);
  expect(delay).toHaveValue('');

  fireEvent.change(every, { target: { value: 'abc' } });
  fireEvent.blur(every);
  expect(every).toHaveValue('');

  fireEvent.change(every, { target: { value: '12' } });
  fireEvent.blur(every);
  expect(every).toHaveValue('12');
  fireEvent.change(delay, { target: { value: '3' } });
  fireEvent.blur(delay);
  expect(delay).toHaveValue('3');
});

// ── Row persistence across panel toggling (#254) ─────────────────────────────

test('restores persisted rows on mount (#254)', () => {
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '9.001', value: '21.5', delay: '', every: '' },
    { address: '4/5/6', dpt: '', value: '1', delay: '2', every: '10' },
  ]));

  render(<WriteToBusPanel targets={[]} />);

  const gaInputs = screen.getAllByPlaceholderText('GA');
  expect(gaInputs).toHaveLength(2);
  expect(gaInputs[0]).toHaveValue('1/2/3');
  expect(gaInputs[1]).toHaveValue('4/5/6');
  expect(screen.getAllByPlaceholderText(/Value/)[0]).toHaveValue('21.5');
  expect(screen.getByDisplayValue('10')).toBeInTheDocument(); // "every" of row 2
  expect(screen.getByDisplayValue('9.001')).toBeInTheDocument(); // editable DPT field of row 1
});

test('persists row edits so toggling the panel keeps them (#254)', async () => {
  const { unmount } = render(<WriteToBusPanel targets={[]} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '7/0/1' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '42' } });
  fireEvent.change(screen.getByPlaceholderText('delay'), { target: { value: '3' } });

  await waitFor(() => {
    expect(JSON.parse(localStorage.getItem(ROWS_KEY)!)).toEqual([
      {
        address: '7/0/1', name: '', dpt: '', value: '42', delay: '3', every: '',
        feedback: null, readBaseline: null, statusWatch: null, statusTelegram: null,
        lastSentTelegram: null, scheduledJobId: null, respond: false,
      },
    ]);
  });

  // Simulate the visibility toggle: unmount and mount a fresh panel.
  unmount();
  render(<WriteToBusPanel targets={[]} />);
  expect(screen.getByPlaceholderText('GA')).toHaveValue('7/0/1');
  expect(screen.getByPlaceholderText(/Value/)).toHaveValue('42');
  expect(screen.getByPlaceholderText('delay')).toHaveValue('3');
});

test('persists status feedback and bus telegram across panel toggle', async () => {
  const fetchMock = mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send': { status: 'sent' },
  });
  vi.stubGlobal('fetch', fetchMock);

  const { unmount, rerender } = render(<WriteToBusPanel targets={[]} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  await waitFor(() => expect(screen.getByLabelText(/written '50' to 1\/2\/3/)).toBeInTheDocument());

  const writeTg = telegramOn('1/2/3', {
    timestamp: '2026-01-01T12:00:00.000000+00:00', value_formatted: '50', unit: null,
  });
  rerender(<WriteToBusPanel targets={[]} latestTelegram={writeTg} />);
  await screen.findByRole('button', { name: 'Go to status telegram' });

  await waitFor(() => {
    const stored = JSON.parse(localStorage.getItem(ROWS_KEY)!) as Array<Record<string, unknown>>;
    expect(stored[0].feedback).toEqual({ ok: true, msg: 'Sent 50 to 1/2/3' });
    expect(stored[0].statusWatch).toBe('write');
    expect(stored[0].statusTelegram).toEqual(expect.objectContaining({
      target_address: '1/2/3', timestamp: writeTg.timestamp,
    }));
    expect(stored[0].lastSentTelegram).toEqual(expect.objectContaining({
      target_address: '1/2/3', timestamp: writeTg.timestamp,
    }));
  });

  unmount();
  render(<WriteToBusPanel targets={[]} />);
  // Bound bus telegram drives the stable shell tooltip (with timestamp).
  expect(screen.getByLabelText(/written '50' to 1\/2\/3/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Go to status telegram' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Go to status telegram' }).closest('[data-status-field]')!.textContent)
    .toMatch(/\d{2}:\d{2}:\d{2}/);
});

test('falls back to a single empty row on malformed storage', () => {
  localStorage.setItem(ROWS_KEY, '{broken');
  render(<WriteToBusPanel targets={[]} />);
  const gaInputs = screen.getAllByPlaceholderText('GA');
  expect(gaInputs).toHaveLength(1);
  expect(gaInputs[0]).toHaveValue('');
});

test('DPT-1 target renders On/Off and records the GA in recents', async () => {
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send': { status: 'sent' },
  }));

  render(<WriteToBusPanel targets={[{ address: '12/0/0', name: 'Heating mode', main: 1, sub: 1 }]} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '12/0/0' } });
  fireEvent.click(screen.getByRole('button', { name: /^on$/ }));

  await waitFor(() => expect(screen.getByLabelText(/written 'on' to 12\/0\/0/)).toBeInTheDocument());
  expect(JSON.parse(localStorage.getItem('spectrumknx-recent-send-gas')!)).toEqual(['12/0/0']);
});

test('committing a GA address records it in recents without sending', () => {
  render(<WriteToBusPanel targets={[{ address: '12/0/0', name: 'Heating mode', main: 1, sub: 1 }]} />);
  const ga = screen.getByPlaceholderText('GA');
  fireEvent.change(ga, { target: { value: '12/0/0' } });
  fireEvent.blur(ga);
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

const lastValueOf = () => {
  const el = document.querySelector('.wtb-last-value');
  if (!el) throw new Error('expected a last-value cell');
  return el as HTMLElement;
};

test('shows the last value of the entered group address (#439)', async () => {
  const fetchMock = mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/telegrams/last': { telegrams: [telegramOn('1/2/3')] },
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<WriteToBusPanel targets={[]} />);
  // Nothing to show until a complete group address is entered.
  expect(document.querySelector('.wtb-last-value')).toBeNull();
  expect(screen.queryByText('Last:')).not.toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  await waitFor(() => expect(lastValueOf()).toHaveTextContent('Last value:21.5 °C'));
  expect(lastValueOf().querySelector('[data-bus-pulse="Incoming"]')).toBeTruthy();
  // Prefix + value+unit; event kind and time live in the Event column.
  expect(lastValueOf()).toHaveTextContent('Last value:');
  expect(lastValueOf()).not.toHaveTextContent('WRITE');
  expect(lastValueOf().textContent).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  expect(document.querySelector('[data-wtb-col="3"]')).toHaveTextContent('WRITE');
  expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/telegrams/last?target_address=1%2F2%2F3'))).toBe(true);
});

test('last value follows the row DPT like send buttons (0 → off for 1.001)', async () => {
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/telegrams/last': {
      telegrams: [telegramOn('1/2/3', {
        dpt: '1.001', dpt_main: 1, dpt_sub: 1, dpt_name: 'Switch',
        unit: null, value_numeric: 0, value_formatted: '0', raw_hex: '0x00',
      })],
    },
  }));
  render(
    <WriteToBusPanel
      targets={[{ address: '1/2/3', name: 'Light', main: 1, sub: 1 }]}
    />,
  );
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  await waitFor(() => expect(lastValueOf().querySelector('strong')).toHaveTextContent('off'));
});

test('last value decodes DPT 3.007 raw 0 as decrease 0 and toggles hex', async () => {
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/telegrams/last': {
      telegrams: [telegramOn('1/2/3', {
        dpt: '3.007', dpt_main: 3, dpt_sub: 7, dpt_name: 'Dimming control',
        unit: null, value_numeric: 0, value_formatted: '0', raw_hex: '0x00',
      })],
    },
  }));
  render(
    <WriteToBusPanel
      targets={[{ address: '1/2/3', name: 'Dim', main: 3, sub: 7 }]}
    />,
  );
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  const value = await waitFor(() => lastValueOf().querySelector('strong') as HTMLElement);
  expect(value).toHaveTextContent('decrease 0');
  fireEvent.click(value);
  expect(value).toHaveTextContent('0x00');
});

test('last value keeps decoded/raw when a new telegram arrives', async () => {
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/telegrams/last': { telegrams: [telegramOn('1/2/3')] },
  }));
  const { rerender } = render(<WriteToBusPanel targets={[]} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  const value = await waitFor(() => lastValueOf().querySelector('strong') as HTMLElement);
  expect(value).toHaveAttribute('aria-label', '21.5 °C');
  fireEvent.click(value);
  expect(value).toHaveAttribute('aria-label', '0x0c1a');

  rerender(
    <WriteToBusPanel
      targets={[]}
      latestTelegram={telegramOn('1/2/3', {
        timestamp: '2026-01-01T10:00:05.000000+00:00',
        direction: 'Outgoing',
        value_formatted: '22.0',
        value_numeric: 22,
        raw_hex: '0x0c4c',
      })}
    />,
  );
  await waitFor(() => expect(lastValueOf().querySelector('strong')).toHaveAttribute('aria-label', '0x0c4c'));
  expect(lastValueOf().querySelector('[data-bus-pulse="Outgoing"]')).toBeTruthy();
});

test('bare DPT main 2 sends hex and binary and refuses values outside 0-3', async () => {
  const fetchMock = mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send': { status: 'sent' },
  });
  vi.stubGlobal('fetch', fetchMock);
  const { container } = render(<WriteToBusPanel targets={[]} />);

  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  const dpt = container.querySelector('input[aria-label="Datapoint type"]') as HTMLInputElement;
  fireEvent.change(dpt, { target: { value: '2' } });
  fireEvent.blur(dpt);
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '0b11' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));

  await waitFor(() => expect(screen.getByLabelText(/written '0b11' to 1\/2\/3/)).toBeInTheDocument());
  const sent = () => fetchMock.mock.calls.filter(([u]) => {
    const url = String(u);
    return url.includes('/api/knx/send') && !url.includes('scheduled');
  });
  const body = JSON.parse((sent()[0][1] as RequestInit).body as string);
  expect(body).toMatchObject({ address: '1/2/3', payload: 3, dpt: '2' });

  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '0x3' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  await waitFor(() => expect(sent()).toHaveLength(2));
  expect(JSON.parse((sent()[1][1] as RequestInit).body as string).payload).toBe(3);

  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  expect(await screen.findByText('Value 4 is out of range for DPT 2 (0–3)')).toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '0b100' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  expect(await screen.findByText('Value 4 is out of range for DPT 2 (0–3)')).toBeInTheDocument();
  expect(sent()).toHaveLength(2);
});

test('offers a go-to button in the event cell beside time and kind', async () => {
  const onGotoTelegram = vi.fn();
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/telegrams/last': { telegrams: [telegramOn('1/2/3')] },
  }));
  const { rerender } = render(
    <WriteToBusPanel targets={[]} onGotoTelegram={onGotoTelegram} />,
  );
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  const button = await screen.findByRole('button', { name: 'Go to telegram' });
  expect(button).toHaveClass('quick-filter-bar-toggle');
  expect(lastValueOf()).toHaveTextContent('21.5 °C');
  expect(lastValueOf()).not.toHaveTextContent('WRITE');
  // Event track must measure the whole cell (time + kind + jump), not only the button —
  // otherwise the labels overflow onto DPT.
  const eventCell = document.querySelector('[data-wtb-col="3"]') as HTMLElement;
  expect(eventCell).toContainElement(button);
  expect(eventCell).toHaveTextContent('WRITE');
  // Same date-time shape as SendToGaPopover: yyyy-MM-dd HH:mm:ss
  expect(eventCell.textContent).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  // Jump sits immediately after Date/Time, before kind (no far-right pin).
  const whenNode = Array.from(eventCell.querySelectorAll('span')).find(el =>
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(el.textContent ?? ''),
  );
  expect(whenNode).toBeTruthy();
  const kindNode = within(eventCell).getByText('WRITE');
  expect(whenNode!.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(button.compareDocumentPosition(kindNode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  fireEvent.click(button);
  expect(onGotoTelegram).toHaveBeenCalledWith(expect.objectContaining({
    target_address: '1/2/3', value_formatted: '21.5',
  }));

  rerender(<WriteToBusPanel targets={[]} onGotoTelegram={onGotoTelegram} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2' } });
  expect(screen.queryByRole('button', { name: 'Go to telegram' })).not.toBeInTheDocument();
});

test('offers a go-to button in the event cell for a Read last telegram', async () => {
  const onGotoTelegram = vi.fn();
  const readTg = telegramOn('0/7/1', {
    simplified_type: 'Read',
    telegram_type: 'GroupValueRead',
    value_formatted: null,
    unit: null,
  });
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/telegrams/last': { telegrams: [readTg] },
  }));
  render(<WriteToBusPanel targets={[]} onGotoTelegram={onGotoTelegram} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '0/7/1' } });

  const button = await screen.findByRole('button', { name: 'Go to telegram' });
  const eventCell = document.querySelector('[data-wtb-col="3"]') as HTMLElement;
  expect(eventCell).toContainElement(button);
  expect(within(eventCell).getByText('READ')).toBeInTheDocument();
  expect(eventCell.textContent).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  // Read has no decoded value — Last value cell stays empty.
  expect(document.querySelector('.wtb-last-value')).toBeNull();

  fireEvent.click(button);
  expect(onGotoTelegram).toHaveBeenCalledWith(expect.objectContaining({
    target_address: '0/7/1', simplified_type: 'Read',
  }));
});

test('leaves last empty when the group address has no recorded value', async () => {
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/telegrams/last': { telegrams: [] },
  }));
  render(<WriteToBusPanel targets={[]} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  await waitFor(() => expect(
    document.querySelectorAll('[data-wtb-col="0"]').length,
  ).toBeGreaterThan(0));
  expect(document.querySelector('.wtb-last-value')).toBeNull();
  expect(screen.queryByText('Last:')).not.toBeInTheDocument();
  expect(screen.queryByText(/no value yet/)).not.toBeInTheDocument();
});

test('a read shows READ until a Response replaces it, ignoring the read request value (#439)', async () => {
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/telegrams/last': { telegrams: [telegramOn('1/2/3')] },
    '/api/knx/read': { status: 'sent' },
  }));
  const { rerender } = render(<WriteToBusPanel targets={[]} latestTelegram={null} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  await waitFor(() => expect(lastValueOf()).toHaveTextContent('21.5 °C'));

  fireEvent.click(screen.getByRole('button', { name: /Read/ }));
  await waitFor(() => expect(screen.getByLabelText(/Read request sent to 1\/2\/3/)).toBeInTheDocument());
  expect(lastValueOf()).toHaveTextContent('21.5 °C');
  expect(lastValueOf()).not.toHaveTextContent('waiting for response');
  const sentShell = screen.getByLabelText(/Read request sent to 1\/2\/3/);
  expect(sentShell).toHaveAttribute('data-status-field');
  expect(sentShell.querySelector('.lucide-radio')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Cancel$/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Clear status' })).toBeInTheDocument();

  const onGotoTelegram = vi.fn();
  const readRequest = telegramOn('1/2/3', {
    timestamp: '2026-01-01T10:05:00.000000+00:00', telegram_type: 'GroupValueRead', simplified_type: 'Read',
    value_numeric: null, value_formatted: null, raw_data: null, raw_hex: null,
  });
  rerender(<WriteToBusPanel targets={[]} latestTelegram={readRequest} onGotoTelegram={onGotoTelegram} />);
  expect(lastValueOf()).toHaveTextContent('21.5 °C');
  const statusJump = await screen.findByRole('button', { name: 'Go to status telegram' });
  const statusShell = statusJump.closest('[data-status-field]')!;
  expect(statusShell.textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
  expect(statusShell.textContent).toMatch(/READ/);
  expect(statusShell.querySelector('.lucide-radio')).toBeNull();
  expect(screen.getByText('READ')).toHaveStyle({ color: 'var(--warning-text)' });
  fireEvent.click(statusJump);
  expect(onGotoTelegram).toHaveBeenCalledWith(expect.objectContaining({
    simplified_type: 'Read', timestamp: readRequest.timestamp,
  }));

  rerender(<WriteToBusPanel targets={[]} latestTelegram={telegramOn('9/9/9', { value_formatted: '99' })} />);
  expect(lastValueOf()).toHaveTextContent('21.5 °C');

  const response = telegramOn('1/2/3', {
    timestamp: '2026-01-01T10:05:00.120000+00:00', telegram_type: 'GroupValueResponse', simplified_type: 'Response',
    value_numeric: 22.3, value_formatted: '22.3',
  });
  rerender(<WriteToBusPanel targets={[]} latestTelegram={response} />);
  await waitFor(() => expect(lastValueOf()).toHaveTextContent('22.3 °C'));
  expect(screen.getAllByText('RESPONSE').length).toBeGreaterThanOrEqual(1);
  expect(lastValueOf()).not.toHaveTextContent('RESPONSE');
  expect(screen.queryByLabelText(/Read request sent/i)).not.toBeInTheDocument();
  const statusAfter = document.querySelector('[data-status-field]') as HTMLElement;
  expect(statusAfter.textContent).toMatch(/RESPONSE/);
  expect(statusAfter.querySelector('.lucide-radio')).toBeNull();
  expect(within(statusAfter).getByText('RESPONSE')).toHaveStyle({ color: 'var(--success)' });
});
test('a Write on the same GA does not end a read wait — only Response does', async () => {
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/telegrams/last': { telegrams: [] },
    '/api/knx/read': { status: 'sent' },
  }));
  const { rerender } = render(<WriteToBusPanel targets={[]} latestTelegram={null} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.click(screen.getByRole('button', { name: /Read/ }));
  await waitFor(() => expect(screen.getByLabelText(/Read request sent to 1\/2\/3/)).toBeInTheDocument());

  const writeTg = telegramOn('1/2/3', {
    timestamp: '2026-01-01T10:06:00.000000+00:00',
    value_formatted: 'On',
    value_numeric: 1,
  });
  rerender(<WriteToBusPanel targets={[]} latestTelegram={writeTg} />);
  expect(screen.getByLabelText(/Read request sent to 1\/2\/3/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Cancel$/ })).not.toBeInTheDocument();

  const response = telegramOn('1/2/3', {
    timestamp: '2026-01-01T10:06:00.120000+00:00',
    telegram_type: 'GroupValueResponse',
    simplified_type: 'Response',
    value_numeric: 1,
    value_formatted: 'On',
  });
  rerender(<WriteToBusPanel targets={[]} latestTelegram={response} />);
  await waitFor(() => expect(screen.queryByLabelText(/read request sent/)).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /^Cancel$/ })).not.toBeInTheDocument();
  expect(document.querySelector('[data-status-field]')?.textContent).toMatch(/RESPONSE/);
});

test('Clear dismisses a read status and does not leave a Cancel divider', async () => {
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/telegrams/last': { telegrams: [telegramOn('1/2/3')] },
    '/api/knx/read': { status: 'sent' },
    '/api/knx/send': { status: 'sent' },
  }));
  render(<WriteToBusPanel targets={[]} latestTelegram={null} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  await waitFor(() => expect(lastValueOf()).toHaveTextContent('21.5 °C'));
  fireEvent.click(screen.getByRole('button', { name: /Read/ }));
  await waitFor(() => expect(screen.getByLabelText(/Read request sent to 1\/2\/3/)).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /^Cancel$/ })).not.toBeInTheDocument();
  const clear = screen.getByRole('button', { name: 'Clear status' });
  expect(clear.style.borderLeft).not.toContain('solid');
  fireEvent.click(clear);
  expect(screen.queryByLabelText(/Read request sent to 1\/2\/3/)).not.toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  const clearBtn = await screen.findByRole('button', { name: 'Clear status' });
  expect(clearBtn.style.borderLeft).not.toContain('solid');
});

test('waiting Cancel keeps unanswered Read instead of restoring the last write', async () => {
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send': { status: 'sent' },
    '/api/knx/read': { status: 'sent' },
    '/api/telegrams/last': { telegrams: [] },
  }));
  const { rerender } = render(<WriteToBusPanel targets={[]} latestTelegram={null} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  await screen.findByLabelText(/written '50' to 1\/2\/3/);

  const writeTg = telegramOn('1/2/3', {
    timestamp: '2026-01-01T11:00:00.000000+00:00', value_formatted: '50', unit: null,
  });
  rerender(<WriteToBusPanel targets={[]} latestTelegram={writeTg} />);
  await screen.findByRole('button', { name: 'Go to status telegram' });

  fireEvent.click(screen.getByRole('button', { name: /Read/ }));
  await waitFor(() => expect(screen.getByLabelText(/Read request sent to 1\/2\/3/)).toBeInTheDocument());

  expect(screen.queryByRole('button', { name: /^Cancel$/ })).not.toBeInTheDocument();
  const pending = screen.getByLabelText(/Read request sent to 1\/2\/3/);
  expect(pending.querySelector('.lucide-radio')).toBeNull();
  expect(screen.queryByLabelText(/written '50' to 1\/2\/3/)).not.toBeInTheDocument();
});

test('delayed Write hides a prior Read until the job’s own write arrives', async () => {
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send/scheduled': {
      ...WAITING_JOB,
      next_send_at: new Date(Date.now() + 15_000).toISOString(),
    },
    '/api/knx/read': { status: 'sent' },
    '/api/telegrams/last': { telegrams: [] },
  }));

  const { rerender } = render(<WriteToBusPanel targets={[]} latestTelegram={null} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.click(screen.getByRole('button', { name: /Read/ }));
  await waitFor(() => expect(screen.getByLabelText(/Read request sent to 1\/2\/3/)).toBeInTheDocument());

  const readTg = telegramOn('1/2/3', {
    timestamp: '2026-01-01T10:05:00.000000+00:00',
    telegram_type: 'GroupValueRead',
    simplified_type: 'Read',
    value_numeric: null,
    value_formatted: null,
  });
  rerender(<WriteToBusPanel targets={[]} latestTelegram={readTg} />);
  await screen.findByRole('button', { name: 'Go to status telegram' });
  expect(screen.getByRole('button', { name: 'Go to status telegram' }).closest('[data-status-field]')!.textContent)
    .toMatch(/READ/);

  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });
  fireEvent.change(screen.getByPlaceholderText('delay'), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));

  const shell = await screen.findByRole('button', { name: /^Cancel$/ }).then(
    btn => btn.closest('[data-status-field]') as HTMLElement,
  );
  await waitFor(() => expect(shell.textContent).toMatch(/-\d+s|-\d+:\d{2}/));
  expect(shell.textContent).not.toMatch(/READ/);
  expect(screen.queryByRole('button', { name: 'Go to status telegram' })).not.toBeInTheDocument();

  rerender(<WriteToBusPanel targets={[]} latestTelegram={telegramOn('1/2/3', {
    timestamp: '2026-01-01T10:05:30.000000+00:00',
    direction: 'Incoming',
    value_numeric: 50,
    value_formatted: '50',
  })} />);
  expect(screen.queryByRole('button', { name: 'Go to status telegram' })).not.toBeInTheDocument();

  rerender(<WriteToBusPanel targets={[]} latestTelegram={telegramOn('1/2/3', {
    timestamp: '2026-01-01T10:05:31.000000+00:00',
    direction: 'Outgoing',
    value_numeric: 21.5,
    value_formatted: '21.5',
  })} />);
  expect(screen.queryByRole('button', { name: 'Go to status telegram' })).not.toBeInTheDocument();

  rerender(<WriteToBusPanel targets={[]} latestTelegram={telegramOn('1/2/3', {
    timestamp: '2026-01-01T10:05:32.000000+00:00',
    direction: 'Outgoing',
    value_numeric: 50,
    value_formatted: '50',
  })} />);
  const jump = await screen.findByRole('button', { name: 'Go to status telegram' });
  expect(jump.closest('[data-status-field]')!.textContent).toMatch(/WRITE/);
});

test('countdown stays visible after delayed start when server omits next_send_at', async () => {
  const waitingWithoutNext = {
    state: 'waiting',
    id: 'delay-2',
    address: '1/2/3',
    delay_seconds: 15,
    interval_seconds: null,
    sends_done: 0,
    sends_skipped: 0,
    next_send_at: null,
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => IDLE } as Response;
    }
    if (url.includes('/api/knx/send/scheduled')) {
      return { ok: true, json: async () => waitingWithoutNext } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));

  const { container } = render(<WriteToBusPanel targets={[]} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });
  fireEvent.change(screen.getByPlaceholderText('delay'), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));

  const shell = await screen.findByRole('button', { name: /^Cancel$/ }).then(
    btn => btn.closest('[data-status-field]') as HTMLElement,
  );
  await waitFor(() => expect(shell.textContent).toMatch(/-\d+s|-\d+:\d{2}/));
  // Still counting after the server reply (no next_send_at) — not replaced by empty event.
  expect(container.querySelector('[data-status-field]')!.textContent).toMatch(/-\d+s|-\d+:\d{2}/);
  expect(shell.getAttribute('aria-label') ?? '').toMatch(/delayed send to 1\/2\/3/);
});

test('Write and Read stay disabled while a job is active', async () => {
  let scheduledCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => IDLE } as Response;
    }
    if (url.includes('/api/knx/send/scheduled/cancel')) {
      return { ok: true, json: async () => IDLE } as Response;
    }
    if (url.includes('/api/knx/send/scheduled')) {
      scheduledCalls += 1;
      return {
        ok: true,
        json: async () => ({
          state: 'waiting',
          id: `delay-${scheduledCalls}`,
          address: '1/2/3',
          delay_seconds: 10,
          interval_seconds: null,
          sends_done: 0,
          sends_skipped: 0,
          next_send_at: new Date(Date.now() + 10_000).toISOString(),
        }),
      } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));

  render(<WriteToBusPanel targets={[]} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });
  fireEvent.change(screen.getByPlaceholderText('delay'), { target: { value: '10' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  await screen.findByRole('button', { name: /^Cancel$/ });

  expect(screen.getByRole('button', { name: /Write/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: /Read/ })).toBeDisabled();
  expect(screen.getByPlaceholderText('delay')).toBeDisabled();
  expect(screen.getByPlaceholderText('every')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  fireEvent.click(screen.getByRole('button', { name: /Read/ }));
  expect(scheduledCalls).toBe(1);
  expect(screen.getByRole('button', { name: /^Cancel$/ }).closest('[data-status-field]')!.textContent)
    .toMatch(/-\d+s|-\d+:\d{2}/);
});

test('two rows can run scheduled sends concurrently', async () => {
  let scheduledCalls = 0;
  const activeJobs: Record<string, unknown> = {};
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => ({ jobs: Object.values(activeJobs) }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled/cancel')) {
      return { ok: true, json: async () => ({ status: 'ok' }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled')) {
      scheduledCalls += 1;
      const job = {
        state: 'waiting',
        id: `delay-${scheduledCalls}`,
        address: scheduledCalls === 1 ? '1/2/3' : '4/5/6',
        delay_seconds: 10,
        interval_seconds: null,
        sends_done: 0,
        sends_skipped: 0,
        next_send_at: new Date(Date.now() + 10_000).toISOString(),
      };
      activeJobs[job.id] = job;
      return { ok: true, json: async () => job } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));

  render(<WriteToBusPanel targets={[]} />);
  fireEvent.click(screen.getByRole('button', { name: /Add a row below/ }));
  const gaInputs = screen.getAllByPlaceholderText('GA');
  fireEvent.change(gaInputs[0], { target: { value: '1/2/3' } });
  fireEvent.change(gaInputs[1], { target: { value: '4/5/6' } });
  fireEvent.change(screen.getAllByPlaceholderText(/Value/)[0], { target: { value: '50' } });
  fireEvent.change(screen.getAllByPlaceholderText(/Value/)[1], { target: { value: '1' } });
  fireEvent.change(screen.getAllByPlaceholderText('delay')[0], { target: { value: '10' } });
  fireEvent.change(screen.getAllByPlaceholderText('delay')[1], { target: { value: '10' } });

  fireEvent.click(screen.getAllByRole('button', { name: /Write/ })[0]);
  await screen.findByLabelText(/delayed send to 1\/2\/3/);
  fireEvent.click(screen.getAllByRole('button', { name: /Write/ })[1]);
  await screen.findByLabelText(/delayed send to 4\/5\/6/);
  expect(scheduledCalls).toBe(2);
  const shells = document.querySelectorAll('[data-status-field]');
  expect(shells[0].querySelector('.lucide-timer')).not.toBeNull();
  expect(shells[1].querySelector('.lucide-timer')).not.toBeNull();
  expect(shells[0].textContent).toMatch(/-\d+s|-\d+:\d{2}/);
  expect(shells[1].textContent).toMatch(/-\d+s|-\d+:\d{2}/);
});

test('two rows with the same GA each keep their own scheduled job', async () => {
  let scheduledCalls = 0;
  const activeJobs: Record<string, unknown> = {};
  let statusOrderReversed = false;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      const jobs = Object.values(activeJobs);
      return {
        ok: true,
        json: async () => ({ jobs: statusOrderReversed ? [...jobs].reverse() : jobs }),
      } as Response;
    }
    if (url.includes('/api/knx/send/scheduled/cancel')) {
      return { ok: true, json: async () => ({ status: 'ok' }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled')) {
      scheduledCalls += 1;
      const job = {
        state: 'waiting',
        id: `same-ga-${scheduledCalls}`,
        address: '1/2/3',
        delay_seconds: 10,
        interval_seconds: null,
        sends_done: 0,
        sends_skipped: 0,
        next_send_at: new Date(Date.now() + 10_000).toISOString(),
      };
      activeJobs[job.id] = job;
      return { ok: true, json: async () => job } as Response;
    }
    if (url.includes('/api/telegrams/last')) {
      return { ok: true, json: async () => ({ telegrams: [] }) } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));

  render(<WriteToBusPanel targets={[]} />);
  fireEvent.click(screen.getByRole('button', { name: /Add a row below/ }));
  const gaInputs = screen.getAllByPlaceholderText('GA');
  fireEvent.change(gaInputs[0], { target: { value: '1/2/3' } });
  fireEvent.change(gaInputs[1], { target: { value: '1/2/3' } });
  fireEvent.change(screen.getAllByPlaceholderText(/Value/)[0], { target: { value: '1' } });
  fireEvent.change(screen.getAllByPlaceholderText(/Value/)[1], { target: { value: '0' } });
  fireEvent.change(screen.getAllByPlaceholderText('delay')[0], { target: { value: '10' } });
  fireEvent.change(screen.getAllByPlaceholderText('delay')[1], { target: { value: '10' } });

  fireEvent.click(screen.getAllByRole('button', { name: /Write/ })[0]);
  await waitFor(() => expect(screen.getAllByRole('button', { name: /^Cancel$/ })).toHaveLength(1));
  fireEvent.click(screen.getAllByRole('button', { name: /Write/ })[1]);
  await waitFor(() => expect(screen.getAllByRole('button', { name: /^Cancel$/ })).toHaveLength(2));
  expect(scheduledCalls).toBe(2);

  await waitFor(() => {
    const stored = JSON.parse(localStorage.getItem(ROWS_KEY)!) as Array<Record<string, unknown>>;
    expect(stored.map(r => r.scheduledJobId)).toEqual(['same-ga-1', 'same-ga-2']);
  });

  // Poll reverse order must not swap row↔job ownership.
  statusOrderReversed = true;
  await waitFor(() => {
    const shells = document.querySelectorAll('[data-status-field]');
    expect(shells[0].querySelector('.lucide-timer')).not.toBeNull();
    expect(shells[1].querySelector('.lucide-timer')).not.toBeNull();
  });
  const storedAfterPoll = JSON.parse(localStorage.getItem(ROWS_KEY)!) as Array<Record<string, unknown>>;
  expect(storedAfterPoll.map(r => r.scheduledJobId)).toEqual(['same-ga-1', 'same-ga-2']);
});

test('remount reattaches scheduled jobs by persisted job id, not GA', async () => {
  const activeJobs: Record<string, unknown> = {
    'job-a': {
      state: 'waiting',
      id: 'job-a',
      address: '1/2/3',
      delay_seconds: 30,
      interval_seconds: null,
      sends_done: 0,
      sends_skipped: 0,
      next_send_at: new Date(Date.now() + 30_000).toISOString(),
    },
    'job-b': {
      state: 'waiting',
      id: 'job-b',
      address: '1/2/3',
      delay_seconds: 20,
      interval_seconds: null,
      sends_done: 0,
      sends_skipped: 0,
      next_send_at: new Date(Date.now() + 20_000).toISOString(),
    },
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      // Deliberately reverse server order vs row order.
      return { ok: true, json: async () => ({ jobs: [activeJobs['job-b'], activeJobs['job-a']] }) } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));

  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '', value: '1', delay: '30', every: '', scheduledJobId: 'job-a' },
    { address: '1/2/3', dpt: '', value: '0', delay: '20', every: '', scheduledJobId: 'job-b' },
  ]));

  render(<WriteToBusPanel targets={[]} />);
  await waitFor(() => expect(screen.getAllByRole('button', { name: /^Cancel$/ })).toHaveLength(2));
  const shells = document.querySelectorAll('[data-status-field]');
  expect(shells[0].querySelector('.lucide-timer')).not.toBeNull();
  expect(shells[1].querySelector('.lucide-timer')).not.toBeNull();
  // Row 0 owned job-a (30s delay), row 1 owned job-b — bindings survive reverse status order.
  await waitFor(() => {
    const stored = JSON.parse(localStorage.getItem(ROWS_KEY)!) as Array<Record<string, unknown>>;
    expect(stored.map(r => r.scheduledJobId)).toEqual(['job-a', 'job-b']);
  });
});

test('Write on one row does not clear Read-wait on another row with the same GA', async () => {
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send': { status: 'sent' },
    '/api/knx/read': { status: 'sent' },
    '/api/telegrams/last': { telegrams: [] },
  }));

  const { rerender } = render(<WriteToBusPanel targets={[]} latestTelegram={null} />);
  fireEvent.click(screen.getByRole('button', { name: /Add a row below/ }));
  const gaInputs = screen.getAllByPlaceholderText('GA');
  fireEvent.change(gaInputs[0], { target: { value: '1/2/3' } });
  fireEvent.change(gaInputs[1], { target: { value: '1/2/3' } });

  fireEvent.click(screen.getAllByRole('button', { name: /Read/ })[0]);
  await waitFor(() => expect(screen.getByLabelText(/Read request sent to 1\/2\/3/)).toBeInTheDocument());

  fireEvent.change(screen.getAllByPlaceholderText(/Value/)[1], { target: { value: '50' } });
  fireEvent.click(screen.getAllByRole('button', { name: /Write/ })[1]);
  await screen.findByLabelText(/written '50' to 1\/2\/3/);

  const writeTg = telegramOn('1/2/3', {
    timestamp: '2026-01-01T13:00:00.000000+00:00', value_formatted: '50', unit: null,
  });
  rerender(<WriteToBusPanel targets={[]} latestTelegram={writeTg} />);

  expect(screen.getByLabelText(/Read request sent to 1\/2\/3/)).toBeInTheDocument();
  const shells = document.querySelectorAll('[data-status-field]');
  expect(shells[0].querySelector('.lucide-radio')).toBeNull();
  expect(shells[1].getAttribute('aria-label') ?? '').toMatch(/written '50'/);
});

test('shows write errors in the status shell without widening the status column', async () => {
  const shortDetail = 'bus offline';
  const longDetail = `bus offline: ${'x'.repeat(120)}`;

  const failSend = (detail: string) => vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => IDLE } as Response;
    }
    if (url.includes('/api/knx/send') && !url.includes('scheduled')) {
      return { ok: false, status: 500, json: async () => ({ detail }) } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const { container } = render(<WriteToBusPanel targets={[]} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });

  vi.stubGlobal('fetch', failSend(shortDetail));
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  const shortShell = await screen.findByLabelText(shortDetail);
  expect(shortShell.querySelector('svg')).toHaveStyle({ color: 'var(--error)' });
  const shortWidth = shortShell.getBoundingClientRect().width;
  const shortTrack = (container.querySelector('[data-wtb-col="10"]') as HTMLElement)
    .getBoundingClientRect().width;

  fireEvent.click(screen.getByRole('button', { name: 'Clear status' }));

  vi.stubGlobal('fetch', failSend(longDetail));
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  const longShell = await screen.findByLabelText(new RegExp(longDetail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  expect(longShell).toHaveAttribute('data-status-field');
  expect(longShell.getAttribute('title')).toBe(longDetail);
  expect(longShell.querySelector('[data-status-error]')).toHaveTextContent(longDetail);
  // Longer error copy must not widen shell or status track vs a short error.
  expect(longShell.getBoundingClientRect().width).toBeLessThanOrEqual(shortWidth + 1);
  expect((container.querySelector('[data-wtb-col="10"]') as HTMLElement).getBoundingClientRect().width)
    .toBeLessThanOrEqual(shortTrack + 1);
});

test('failed rewrite does not flash last send time or widen status from telegram', async () => {
  const { container, rerender } = render(<WriteToBusPanel targets={[]} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });

  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send': { status: 'sent' },
  }));
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  await screen.findByLabelText(/written '50' to 1\/2\/3/);

  const writeTg = telegramOn('1/2/3', {
    timestamp: '2026-01-01T11:00:00.000000+00:00', value_formatted: '50', unit: null,
  });
  rerender(<WriteToBusPanel targets={[]} latestTelegram={writeTg} />);
  await screen.findByRole('button', { name: 'Go to status telegram' });
  const beforeTrack = (container.querySelector('[data-wtb-col="10"]') as HTMLElement)
    .getBoundingClientRect().width;

  let resolveSend!: (value: Response) => void;
  const pendingSend = new Promise<Response>(resolve => { resolveSend = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => IDLE } as Response;
    }
    if (url.includes('/api/knx/send') && !url.includes('scheduled')) {
      return pendingSend;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));

  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  // While the request is in flight, last-Write time/jump must not reappear.
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Go to status telegram' })).not.toBeInTheDocument();
  });
  expect(screen.queryByLabelText(/written '50'/)).not.toBeInTheDocument();

  resolveSend({
    ok: false,
    status: 500,
    json: async () => ({ detail: 'bus offline' }),
  } as Response);

  const errShell = await screen.findByLabelText('bus offline');
  expect(errShell.querySelector('[data-status-error]')).toHaveTextContent('bus offline');
  expect(screen.queryByRole('button', { name: 'Go to status telegram' })).not.toBeInTheDocument();
  // Telegram flash must not have permanently grown the status track.
  expect((container.querySelector('[data-wtb-col="10"]') as HTMLElement).getBoundingClientRect().width)
    .toBeLessThanOrEqual(beforeTrack + 1);
});

test('status shell shows write event like Event column and clears', async () => {
  const onGotoTelegram = vi.fn();
  const fetchMock = mockFetch({
    '/api/knx/send/scheduled/status': IDLE,
    '/api/knx/send': { status: 'sent' },
  });
  vi.stubGlobal('fetch', fetchMock);

  const { container, rerender } = render(
    <WriteToBusPanel targets={[]} onGotoTelegram={onGotoTelegram} />,
  );
  const emptyShell = container.querySelector('[data-status-field]') as HTMLElement;
  expect(emptyShell).not.toBeNull();
  expect(emptyShell).not.toHaveClass('glass-input');
  expect(emptyShell.style.background).toBe('transparent');
  expect(emptyShell.style.border).toBe('1px solid var(--border-color)');

  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));

  const shell = await screen.findByLabelText(/written '50' to 1\/2\/3/);
  expect(shell).toHaveAttribute('data-status-field');
  expect(shell.querySelector('.lucide-send')).toBeNull();
  const clearBtn = screen.getByRole('button', { name: 'Clear status' });
  // Clear must never keep Cancel's divider (React inline-style leak).
  expect(clearBtn.style.borderLeft).not.toContain('solid');

  const writeTg = telegramOn('1/2/3', {
    timestamp: '2026-01-01T11:00:00.000000+00:00', value_formatted: '50', unit: null,
  });
  rerender(
    <WriteToBusPanel targets={[]} latestTelegram={writeTg} onGotoTelegram={onGotoTelegram} />,
  );
  const jump = await screen.findByRole('button', { name: 'Go to status telegram' });
  const statusShell = jump.closest('[data-status-field]')!;
  expect(statusShell.textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
  expect(statusShell.textContent).toMatch(/WRITE/);
  expect(statusShell.getAttribute('aria-label') ?? '').toMatch(/written '50' to 1\/2\/3/);
  fireEvent.click(jump);
  expect(onGotoTelegram).toHaveBeenCalledWith(expect.objectContaining({
    target_address: '1/2/3', timestamp: writeTg.timestamp,
  }));

  fireEvent.click(screen.getByRole('button', { name: 'Clear status' }));
  expect(screen.queryByLabelText(/written '50' to/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Go to status telegram' })).not.toBeInTheDocument();
  expect(document.querySelector('[data-status-action]')).toBeNull();
});

test('cyclic send shows countdown and count and locks the row', async () => {
  const cyclicRunning = {
    state: 'running',
    id: 'cyc-1',
    address: '1/2/3',
    interval_seconds: 5,
    sends_done: 2,
    sends_skipped: 0,
    next_send_at: new Date(Date.now() + 4_000).toISOString(),
  };
  const activeJobs: Record<string, unknown> = { [cyclicRunning.id]: cyclicRunning };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => ({ jobs: Object.values(activeJobs) }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled/cancel')) {
      delete activeJobs[cyclicRunning.id];
      return { ok: true, json: async () => ({ status: 'ok' }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled')) {
      activeJobs[cyclicRunning.id] = cyclicRunning;
      return { ok: true, json: async () => cyclicRunning } as Response;
    }
    if (url.includes('/api/knx/read')) {
      return { ok: true, json: async () => ({ status: 'sent' }) } as Response;
    }
    if (url.includes('/api/telegrams/last')) {
      return { ok: true, json: async () => ({ telegrams: [] }) } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));

  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '', value: '50', delay: '', every: '5', scheduledJobId: 'cyc-1' },
  ]));
  render(<WriteToBusPanel targets={[]} latestTelegram={null} />);
  await waitFor(() => expect(screen.getByLabelText(/cyclic send to 1\/2\/3/)).toBeInTheDocument());
  const shell = screen.getByLabelText(/cyclic send to 1\/2\/3/).closest('[data-status-field]')!;
  // Cyclic running: interval countdown + send count.
  expect(shell.textContent).toMatch(/-\d+s|-\d+:\d{2}/);
  expect(shell.querySelector('[data-status-metric="countdown"]')).not.toBeNull();
  expect(screen.getByLabelText(/Sends done 2/)).toHaveTextContent('2');

  expect(screen.getByRole('button', { name: /Write/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: /Read/ })).toBeDisabled();
  expect(screen.getByPlaceholderText('delay')).toBeDisabled();
  expect(screen.getByPlaceholderText('every')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Read/ }));
  expect(screen.queryByLabelText(/read request sent/i)).not.toBeInTheDocument();
  const afterRead = screen.getByLabelText(/cyclic send to 1\/2\/3/);
  expect(afterRead.textContent).toMatch(/-\d+s|-\d+:\d{2}/);
  expect(screen.getByLabelText(/Sends done 2/)).toHaveTextContent('2');
  expect(afterRead.querySelector('.lucide-timer')).not.toBeNull();
});

test('each row keeps its own send job and read-wait status', async () => {
  const cyclicRunning = {
    state: 'running',
    id: 'cyc-row',
    address: '1/2/3',
    interval_seconds: 5,
    sends_done: 1,
    sends_skipped: 0,
    next_send_at: new Date(Date.now() + 3_000).toISOString(),
  };
  const activeJobs: Record<string, unknown> = {};
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => ({ jobs: Object.values(activeJobs) }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled/cancel')) {
      return { ok: true, json: async () => ({ status: 'ok' }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled')) {
      activeJobs[cyclicRunning.id] = cyclicRunning;
      return { ok: true, json: async () => cyclicRunning } as Response;
    }
    if (url.includes('/api/knx/read')) {
      return { ok: true, json: async () => ({ status: 'sent' }) } as Response;
    }
    if (url.includes('/api/telegrams/last')) {
      return { ok: true, json: async () => ({ telegrams: [] }) } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));

  render(<WriteToBusPanel targets={[]} />);
  fireEvent.click(screen.getByRole('button', { name: /Add a row below/ }));
  const gaInputs = screen.getAllByPlaceholderText('GA');
  fireEvent.change(gaInputs[0], { target: { value: '1/2/3' } });
  fireEvent.change(gaInputs[1], { target: { value: '1/2/3' } }); // same GA — still separate rows
  fireEvent.change(screen.getAllByPlaceholderText(/Value/)[0], { target: { value: '50' } });
  fireEvent.change(screen.getAllByPlaceholderText('every')[0], { target: { value: '5' } });
  fireEvent.click(screen.getAllByRole('button', { name: /Write/ })[0]);

  await waitFor(() => expect(screen.getByLabelText(/cyclic send to 1\/2\/3/)).toBeInTheDocument());
  const shells = document.querySelectorAll('[data-status-field]');
  expect(shells).toHaveLength(2);
  // Cyclic running shows interval countdown + send count.
  expect(shells[0].textContent).toMatch(/-\d+s|-\d+:\d{2}/);
  expect(screen.getByLabelText(/Sends done 1/)).toHaveTextContent('1');
  expect(shells[0].querySelector('.lucide-timer')).not.toBeNull();
  // Second row must not inherit the first row's job chrome.
  expect(shells[1].querySelector('.lucide-timer')).toBeNull();
  expect(shells[1].textContent ?? '').not.toMatch(/cyclic send/);

  fireEvent.click(screen.getAllByRole('button', { name: /Read/ })[1]);
  await waitFor(() => expect(screen.getByLabelText(/Read request sent to 1\/2\/3/)).toBeInTheDocument());
  // Wait lives only on row 2; row 1 keeps its job.
  expect(shells[0].querySelector('.lucide-timer')).not.toBeNull();
  expect(shells[1].querySelector('.lucide-radio')).toBeNull();
  expect(shells[1].querySelector('[data-status-action] button')?.getAttribute('aria-label')).toBe('Clear status');
  expect(shells[1].querySelector('.lucide-timer')).toBeNull();

  expect(screen.getByLabelText(/cyclic send to 1\/2\/3/)).toBeInTheDocument();
  expect(shells[0].querySelector('.lucide-timer')).not.toBeNull();
  expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeInTheDocument();
});

test('Cancel ends the job and unlocks Write and Read', async () => {
  const cyclicRunning = {
    state: 'running',
    id: 'cyc-2',
    address: '1/2/3',
    interval_seconds: 5,
    sends_done: 2,
    sends_skipped: 0,
    next_send_at: new Date(Date.now() + 4_000).toISOString(),
  };
  const activeJobs: Record<string, unknown> = { [cyclicRunning.id]: cyclicRunning };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => ({ jobs: Object.values(activeJobs) }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled/cancel')) {
      delete activeJobs[cyclicRunning.id];
      return { ok: true, json: async () => ({ status: 'ok' }) } as Response;
    }
    if (url.includes('/api/knx/read')) {
      return { ok: true, json: async () => ({ status: 'sent' }) } as Response;
    }
    if (url.includes('/api/telegrams/last')) {
      return { ok: true, json: async () => ({ telegrams: [] }) } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));

  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '', value: '50', delay: '', every: '5', scheduledJobId: 'cyc-2' },
  ]));
  render(<WriteToBusPanel targets={[]} />);
  await waitFor(() => expect(screen.getByLabelText(/cyclic send to 1\/2\/3/)).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /Read/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: /Write/ })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
  await waitFor(() => expect(screen.queryByLabelText(/cyclic send/)).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /^Cancel$/ })).not.toBeInTheDocument();
  // Ending the job zeroes the cyclic count and drops the count column.
  expect(screen.queryByLabelText(/Sends done/)).not.toBeInTheDocument();
  expect(document.querySelector('[data-status-metric="count"]')).toBeNull();
  expect(screen.getByRole('button', { name: /Read/ })).toBeEnabled();
  expect(screen.getByRole('button', { name: /Write/ })).toBeEnabled();
  expect(screen.getByPlaceholderText('every')).toBeEnabled();
});

test('Cancel after a cyclic Write keeps the Write telegram', async () => {
  const cyclicRunning = {
    state: 'running',
    id: 'cyc-read-keep',
    address: '1/2/3',
    interval_seconds: 5,
    sends_done: 1,
    sends_skipped: 0,
    next_send_at: new Date(Date.now() + 4_000).toISOString(),
  };
  const activeJobs: Record<string, unknown> = { [cyclicRunning.id]: cyclicRunning };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => ({ jobs: Object.values(activeJobs) }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled/cancel')) {
      delete activeJobs[cyclicRunning.id];
      return { ok: true, json: async () => ({ status: 'ok' }) } as Response;
    }
    if (url.includes('/api/knx/read')) {
      return { ok: true, json: async () => ({ status: 'sent' }) } as Response;
    }
    if (url.includes('/api/telegrams/last')) {
      return { ok: true, json: async () => ({ telegrams: [] }) } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));

  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '', value: '50', delay: '', every: '5', scheduledJobId: 'cyc-read-keep' },
  ]));
  const { rerender } = render(<WriteToBusPanel targets={[]} latestTelegram={null} />);
  await waitFor(() => expect(screen.getByLabelText(/cyclic send to 1\/2\/3/)).toBeInTheDocument());

  const writeTg = telegramOn('1/2/3', {
    timestamp: '2026-01-01T12:00:00.000000+00:00',
    direction: 'Outgoing',
    value_formatted: '50',
    unit: null,
  });
  rerender(<WriteToBusPanel targets={[]} latestTelegram={writeTg} />);
  await screen.findByRole('button', { name: 'Go to status telegram' });
  expect(screen.getByRole('button', { name: /Read/ })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
  await waitFor(() => expect(screen.queryByLabelText(/cyclic send/)).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /^Cancel$/ })).not.toBeInTheDocument();

  const pending = screen.getByLabelText(/written '50' to 1\/2\/3/);
  expect(pending.textContent).toMatch(/WRITE/);
  expect(screen.getByRole('button', { name: 'Go to status telegram' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Read/ })).toBeEnabled();
});

test('Cancel on a cyclic job zeroes sends_done and hides the count column', async () => {
  const cyclicRunning = {
    state: 'running',
    id: 'cyc-zero',
    address: '1/2/3',
    interval_seconds: 5,
    sends_done: 4,
    sends_skipped: 0,
    next_send_at: new Date(Date.now() + 4_000).toISOString(),
  };
  const activeJobs: Record<string, unknown> = { [cyclicRunning.id]: cyclicRunning };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => ({ jobs: Object.values(activeJobs) }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled/cancel')) {
      delete activeJobs[cyclicRunning.id];
      return { ok: true, json: async () => ({ status: 'ok' }) } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));

  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '', value: '', delay: '', every: '5', scheduledJobId: 'cyc-zero' },
    { address: '', dpt: '', value: '', delay: '', every: '' },
  ]));
  render(<WriteToBusPanel targets={[]} />);
  await waitFor(() => expect(screen.getByLabelText(/Sends done 4/)).toBeInTheDocument());
  expect(document.querySelectorAll('[data-status-metric="count"]')).toHaveLength(2);

  fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
  await waitFor(() => expect(screen.queryByLabelText(/cyclic send/)).not.toBeInTheDocument());
  expect(screen.queryByLabelText(/Sends done/)).not.toBeInTheDocument();
  expect(document.querySelector('[data-status-metric="count"]')).toBeNull();
});

test('keeps scheduled job cancel in the status shell without clear', async () => {
  // Match scheduled routes before the generic /api/knx/send path.
  const activeJobs: Record<string, unknown> = {};
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => ({ jobs: Object.values(activeJobs) }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled')) {
      activeJobs[RUNNING_JOB.id] = RUNNING_JOB;
      return { ok: true, json: async () => RUNNING_JOB } as Response;
    }
    if (url.includes('/api/knx/send')) return { ok: true, json: async () => ({ status: 'sent' }) } as Response;
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<WriteToBusPanel targets={[]} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });
  fireEvent.change(screen.getByPlaceholderText('every'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));

  const jobShell = await screen.findByLabelText(/cyclic send to 1\/2\/3 every 5s/);
  expect(jobShell).toHaveAttribute('data-status-field');
  expect(jobShell.querySelector('.lucide-timer')).not.toBeNull();
  expect(screen.getByLabelText(/Sends done 3/)).toHaveTextContent('3');
  expect(jobShell.textContent).not.toMatch(/#3/);
  const cancel = screen.getByRole('button', { name: /^Cancel$/ });
  expect(jobShell).toContainElement(cancel);
  expect(cancel.style.color).toBe('var(--accent-primary)');
  expect(cancel.style.background).toBe('transparent');
  expect(cancel.style.borderLeft).toBe('1px solid var(--border-color)');
  expect(screen.queryByRole('button', { name: 'Clear status' })).not.toBeInTheDocument();
});

// ── Panel header: Close / Reset / Cancel ─────────────────────────────────────

test('title lives in the top grid row with Reset/Add (no separate header band)', () => {
  const { container } = render(<WriteToBusPanel targets={[]} />);
  const title = container.querySelector('.wtb-header-grid .wtb-panel-title');
  expect(title).toBeTruthy();
  expect(title).toHaveTextContent('Write to bus');
  expect(container.querySelector('.wtb-panel-header')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reset panel' })).toBeInTheDocument();
});

test('header Reset/Add row stay visible with a single send row', () => {
  render(<WriteToBusPanel targets={[]} />);
  expect(screen.getByRole('button', { name: 'Reset panel' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add row at top' })).toBeInTheDocument();
  // Cancel stays mounted but aria-hidden until cancellable jobs exist.
  expect(document.querySelector('button[aria-label="Cancel all"]')).toBeTruthy();
});

test('only the mid pane has a horizontal scrollbar host (GA and status stay pinned)', () => {
  const { container } = render(<WriteToBusPanel targets={[]} />);
  const outer = container.querySelector('.wtb-h-scroll') as HTMLElement;
  expect(outer).toBeTruthy();
  expect(outer.style.overflowX).toBe('hidden');
  expect(outer.style.padding).toBe('0.45rem 0px 0px 0.85rem');
  expect(container.querySelector('.wtb-mid-h-scroll')).toBeTruthy();
  expect(container.querySelector('.wtb-mid-clip')).toBeTruthy();
  expect(container.querySelector('.wtb-rows-grid')).toBeTruthy();
});

test('header Reset cancels all jobs and clears the panel to one empty row', async () => {
  const cancelBodies: unknown[] = [];
  const activeJobs: Record<string, unknown> = {
    [RUNNING_JOB.id]: RUNNING_JOB,
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => ({ jobs: Object.values(activeJobs) }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled/cancel')) {
      cancelBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
      Object.keys(activeJobs).forEach(k => { delete activeJobs[k]; });
      return { ok: true, json: async () => ({ status: 'ok' }) } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '', value: '50', delay: '', every: '5', scheduledJobId: RUNNING_JOB.id },
    { address: '4/5/6', dpt: '', value: '1', delay: '', every: '' },
  ]));

  render(<WriteToBusPanel targets={[]} />);
  // One live job → row Cancel, but not header Cancel.
  await waitFor(() => expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeInTheDocument());
  expect(screen.queryByTitle('Cancel all jobs')).not.toBeInTheDocument();
  expect(screen.getAllByPlaceholderText('GA')).toHaveLength(2);

  fireEvent.click(screen.getByRole('button', { name: 'Reset panel' }));
  await waitFor(() => expect(screen.getAllByPlaceholderText('GA')).toHaveLength(1));
  expect(screen.getByPlaceholderText('GA')).toHaveValue('');
  expect(screen.queryByTitle('Cancel all jobs')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Cancel$/ })).not.toBeInTheDocument();
  expect(cancelBodies.some(b => b && typeof b === 'object' && !('id' in (b as object) && (b as { id?: string }).id))).toBe(true);
});

test('header Cancel is reserved in layout and only visible with two or more row Cancels', async () => {
  const jobA = { ...RUNNING_JOB, id: 'job-a', address: '1/2/3' };
  const jobB = { ...RUNNING_JOB, id: 'job-b', address: '4/5/6' };
  vi.stubGlobal('fetch', mockFetch({
    '/api/knx/send/scheduled/status': statusOf(jobA, jobB),
  }));
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '', value: '50', delay: '', every: '5', scheduledJobId: jobA.id },
    { address: '4/5/6', dpt: '', value: '1', delay: '', every: '5', scheduledJobId: jobB.id },
  ]));

  render(<WriteToBusPanel targets={[]} />);
  await waitFor(() => expect(screen.getAllByRole('button', { name: /^Cancel$/ })).toHaveLength(2));
  const cancelAll = screen.getByRole('button', { name: 'Cancel all' });
  expect(cancelAll).toHaveAttribute('title', 'Cancel all jobs');
  expect(cancelAll.textContent).toBe('Cancel');
  expect(cancelAll.style.color).toBe('var(--accent-primary)');
  expect(cancelAll.style.background).toBe('transparent');
  expect(cancelAll.style.border).toBe('1px solid var(--accent-primary)');
  expect(cancelAll.className).not.toMatch(/icon-button/);
});

test('header Cancel ends jobs and read waits but keeps row addresses', async () => {
  const activeJobs: Record<string, unknown> = { [RUNNING_JOB.id]: { ...RUNNING_JOB } };
  const cancelBodies: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => ({ jobs: Object.values(activeJobs) }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled/cancel')) {
      cancelBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
      Object.keys(activeJobs).forEach(k => { delete activeJobs[k]; });
      return { ok: true, json: async () => ({ status: 'ok' }) } as Response;
    }
    if (url.includes('/api/knx/read')) {
      return { ok: true, json: async () => ({ status: 'sent' }) } as Response;
    }
    if (url.includes('/api/telegrams/last')) {
      return { ok: true, json: async () => ({ telegrams: [] }) } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '', value: '50', delay: '', every: '5', scheduledJobId: RUNNING_JOB.id },
    { address: '4/5/6', dpt: '', value: '1', delay: '', every: '' },
  ]));

  render(<WriteToBusPanel targets={[]} />);
  await waitFor(() => expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeInTheDocument());
  expect(screen.queryByTitle('Cancel all jobs')).not.toBeInTheDocument();

  // A read on another row is not a Cancel, so header Cancel stays hidden.
  fireEvent.click(screen.getAllByRole('button', { name: /Read/ })[1]);
  await waitFor(() => expect(screen.getByLabelText(/Read request sent to 4\/5\/6/)).toBeInTheDocument());
  expect(screen.queryByTitle('Cancel all jobs')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeInTheDocument();
  const addresses = screen.getAllByPlaceholderText('GA');
  expect(addresses).toHaveLength(2);
  expect(addresses[0]).toHaveValue('1/2/3');
  expect(addresses[1]).toHaveValue('4/5/6');
});

// ── Address and name fields stay paired ──────────────────────────────────────

const NAMED = [
  { address: '1/1/97', name: 'EGD_BWM55TG2A_Helligkeit', main: 9, sub: 4 },
  { address: '1/2/3', name: 'Living room light', main: 1, sub: 1 },
];

test('leaving the address field fills the matching name', () => {
  render(<WriteToBusPanel targets={NAMED} />);
  const address = screen.getByPlaceholderText('GA');
  const name = screen.getByPlaceholderText('Group name');
  fireEvent.change(address, { target: { value: '1/1/97' } });
  expect(name).toHaveValue('');
  fireEvent.blur(address);
  expect(name).toHaveValue('EGD_BWM55TG2A_Helligkeit');
  expect(address).toHaveValue('1/1/97');
});

test('leaving the name field fills the matching address', () => {
  render(<WriteToBusPanel targets={NAMED} />);
  const address = screen.getByPlaceholderText('GA');
  const name = screen.getByPlaceholderText('Group name');
  fireEvent.change(name, { target: { value: 'Living room light' } });
  expect(address).toHaveValue('');
  fireEvent.blur(name);
  expect(address).toHaveValue('1/2/3');
  expect(name).toHaveValue('Living room light');
});

test('Enter in the name field selects the highlighted suggestion', async () => {
  render(<WriteToBusPanel targets={NAMED} />);
  const name = screen.getByPlaceholderText('Group name');
  fireEvent.change(name, { target: { value: 'Helligkeit' } });
  // Typing clears the highlight; ArrowDown selects the top match for Enter.
  fireEvent.keyDown(name, { key: 'ArrowDown' });
  await waitFor(() => expect(screen.getByRole('option', { name: /Helligkeit/ })).toBeInTheDocument());
  fireEvent.keyDown(name, { key: 'Enter' });
  expect(screen.getByPlaceholderText('GA')).toHaveValue('1/1/97');
  expect(name).toHaveValue('EGD_BWM55TG2A_Helligkeit');
});

test('an incomplete value resolves both fields of that row only', async () => {
  render(<WriteToBusPanel targets={NAMED} />);
  fireEvent.click(screen.getByRole('button', { name: /Add a row below/ }));
  const addresses = screen.getAllByPlaceholderText('GA');
  const names = screen.getAllByPlaceholderText('Group name');

  fireEvent.change(addresses[0], { target: { value: '1/1' } });
  fireEvent.keyDown(addresses[0], { key: 'ArrowDown' });
  await waitFor(() => expect(screen.getByRole('option', { name: /1\/1\/97/ })).toBeInTheDocument());
  fireEvent.blur(addresses[0]);
  expect(addresses[0]).toHaveValue('1/1/97');
  expect(names[0]).toHaveValue('EGD_BWM55TG2A_Helligkeit');
  expect(addresses[1]).toHaveValue('');
  expect(names[1]).toHaveValue('');

  fireEvent.change(names[1], { target: { value: 'Living' } });
  fireEvent.keyDown(names[1], { key: 'ArrowDown' });
  await waitFor(() => expect(screen.getByRole('option', { name: /Living room light/ })).toBeInTheDocument());
  fireEvent.blur(names[1]);
  expect(addresses[1]).toHaveValue('1/2/3');
  expect(names[1]).toHaveValue('Living room light');
  expect(addresses[0]).toHaveValue('1/1/97');
  expect(names[0]).toHaveValue('EGD_BWM55TG2A_Helligkeit');
});

test('choosing a name suggestion updates both fields', () => {
  render(<WriteToBusPanel targets={NAMED} />);
  const name = screen.getByPlaceholderText('Group name');
  fireEvent.change(name, { target: { value: 'Living' } });
  fireEvent.mouseDown(screen.getByRole('option', { name: /Living room light/ }));
  expect(screen.getByPlaceholderText('GA')).toHaveValue('1/2/3');
  expect(name).toHaveValue('Living room light');
});

// ── GA blur: empty initializes; invalid / incomplete / unknown reverts ───────

test('clearing the GA field on blur initializes the whole row', () => {
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', name: 'Living room light', dpt: '1.001', value: '1', delay: '2', every: '5' },
  ]));
  render(<WriteToBusPanel targets={NAMED} />);
  const ga = screen.getByPlaceholderText('GA');
  expect(ga).toHaveValue('1/2/3');
  fireEvent.focus(ga);
  fireEvent.change(ga, { target: { value: '' } });
  fireEvent.blur(ga);
  expect(ga).toHaveValue('');
  expect(screen.getByPlaceholderText('Group name')).toHaveValue('');
  expect(screen.getByLabelText('Datapoint type')).toHaveValue('');
  expect(screen.getByPlaceholderText('Value')).toHaveValue('');
  expect(screen.getByPlaceholderText('delay')).toHaveValue('');
  expect(screen.getByPlaceholderText('every')).toHaveValue('');
});

test('incomplete GA with a project loaded reverts on blur', () => {
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', name: 'Living room light', dpt: '1.001', value: '', delay: '', every: '' },
  ]));
  render(<WriteToBusPanel targets={NAMED} />);
  const ga = screen.getByPlaceholderText('GA');
  fireEvent.focus(ga);
  // Typing clears the highlight so blur commits free text instead of picking a suggestion.
  fireEvent.change(ga, { target: { value: '1/' } });
  fireEvent.blur(ga);
  expect(ga).toHaveValue('1/2/3');
  expect(screen.getByPlaceholderText('Group name')).toHaveValue('Living room light');
});

test('invalid GA with a project loaded reverts on blur', () => {
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', name: 'Living room light', dpt: '1.001', value: '', delay: '', every: '' },
  ]));
  render(<WriteToBusPanel targets={NAMED} />);
  const ga = screen.getByPlaceholderText('GA');
  fireEvent.focus(ga);
  fireEvent.change(ga, { target: { value: 'not-a-ga' } });
  fireEvent.blur(ga);
  expect(ga).toHaveValue('1/2/3');
  expect(screen.getByPlaceholderText('Group name')).toHaveValue('Living room light');
});

test('unknown complete GA with a project loaded reverts on blur', () => {
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', name: 'Living room light', dpt: '1.001', value: '', delay: '', every: '' },
  ]));
  render(<WriteToBusPanel targets={NAMED} />);
  const ga = screen.getByPlaceholderText('GA');
  fireEvent.focus(ga);
  fireEvent.change(ga, { target: { value: '9/9/9' } });
  fireEvent.blur(ga);
  expect(ga).toHaveValue('1/2/3');
  expect(screen.getByPlaceholderText('Group name')).toHaveValue('Living room light');
});

test('valid project GA still commits name on blur', () => {
  render(<WriteToBusPanel targets={NAMED} />);
  const ga = screen.getByPlaceholderText('GA');
  fireEvent.focus(ga);
  fireEvent.change(ga, { target: { value: '1/1/97' } });
  fireEvent.blur(ga);
  expect(ga).toHaveValue('1/1/97');
  expect(screen.getByPlaceholderText('Group name')).toHaveValue('EGD_BWM55TG2A_Helligkeit');
});

test('unknown GA name reverts on blur', () => {
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', name: 'Living room light', dpt: '1.001', value: '', delay: '', every: '' },
  ]));
  render(<WriteToBusPanel targets={NAMED} />);
  const name = screen.getByPlaceholderText('Group name');
  fireEvent.focus(name);
  fireEvent.change(name, { target: { value: 'Custom free name' } });
  fireEvent.blur(name);
  expect(name).toHaveValue('Living room light');
  expect(screen.getByPlaceholderText('GA')).toHaveValue('1/2/3');
});

test('clearing the GA name on blur leaves it empty', () => {
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', name: 'Living room light', dpt: '1.001', value: '', delay: '', every: '' },
  ]));
  render(<WriteToBusPanel targets={NAMED} />);
  const name = screen.getByPlaceholderText('Group name');
  fireEvent.focus(name);
  fireEvent.change(name, { target: { value: '' } });
  fireEvent.blur(name);
  expect(name).toHaveValue('');
  expect(screen.getByPlaceholderText('GA')).toHaveValue('1/2/3');
});

test('without a project, complete free-entry GA is kept and invalid reverts', () => {
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '1.001', value: '', delay: '', every: '' },
  ]));
  render(<WriteToBusPanel targets={[]} />);
  const ga = screen.getByPlaceholderText('GA');

  fireEvent.focus(ga);
  fireEvent.change(ga, { target: { value: '5/5/5' } });
  fireEvent.blur(ga);
  expect(ga).toHaveValue('5/5/5');

  fireEvent.focus(ga);
  fireEvent.change(ga, { target: { value: 'nope' } });
  fireEvent.blur(ga);
  expect(ga).toHaveValue('5/5/5');
});

test('panelAddressesFromRows collects every unique GA', () => {
  expect(expectedPanelDpt(9, 1)).toBe('9.001');
  expect(panelAddressesFromRows([
    { address: '1/2/3' },
    { address: '4/5/6' },
    { address: '1/2/3' },
    { address: '  ' },
    { address: '7/8/9' },
  ])).toEqual(['1/2/3', '4/5/6', '7/8/9']);
});

test('onPanelAddressesChange reports all row GAs and clears on unmount', () => {
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '9.001', value: '21', delay: '2', every: '' },
    { address: '4/5/6', dpt: '5.001', value: '1', delay: '', every: '5' },
  ]));
  const onPanelAddressesChange = vi.fn();
  const { unmount } = render(
    <WriteToBusPanel targets={[]} onPanelAddressesChange={onPanelAddressesChange} />,
  );
  expect(onPanelAddressesChange).toHaveBeenCalledWith(['1/2/3', '4/5/6']);
  unmount();
  expect(onPanelAddressesChange).toHaveBeenLastCalledWith([]);
});

test('header Add row at top inserts a blank row at index 0', () => {
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '9.001', value: '21', delay: '', every: '' },
    { address: '4/5/6', dpt: '5.001', value: '1', delay: '', every: '' },
  ]));
  render(<WriteToBusPanel targets={[]} />);
  expect(screen.getAllByPlaceholderText('GA')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: /^Add row at top$/i }));
  const gas = screen.getAllByPlaceholderText('GA');
  expect(gas).toHaveLength(3);
  expect(gas[0]).toHaveValue('');
  expect(gas[1]).toHaveValue('1/2/3');
  expect(gas[2]).toHaveValue('4/5/6');
});

// ── Ctrl-send request: clear matching top row or insert above ────────────────

test('ctrlSendRequest clears a matching top row (same GA, DPT, empty delay/every)', async () => {
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', name: 'Light', dpt: '1.001', value: '1', delay: '', every: '' },
  ]));
  const onCtrlSendHandled = vi.fn();
  const { rerender } = render(
    <WriteToBusPanel
      targets={[{ address: '1/2/3', name: 'Light', main: 1, sub: 1 }]}
      ctrlSendRequest={null}
      onCtrlSendHandled={onCtrlSendHandled}
    />,
  );
  expect(screen.getByPlaceholderText('GA')).toHaveValue('1/2/3');

  rerender(
    <WriteToBusPanel
      targets={[{ address: '1/2/3', name: 'Light', main: 1, sub: 1 }]}
      ctrlSendRequest={{ nonce: 1, address: '1/2/3', dptMain: 1, dptSub: 1 }}
      onCtrlSendHandled={onCtrlSendHandled}
    />,
  );
  await waitFor(() => expect(screen.getByPlaceholderText('GA')).toHaveValue(''));
  expect(screen.getByPlaceholderText('Group name')).toHaveValue('');
  expect(onCtrlSendHandled).toHaveBeenCalled();
});

test('ctrlSendRequest fills an empty top row instead of inserting', async () => {
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '', dpt: '', value: '', delay: '', every: '' },
  ]));
  const onCtrlSendHandled = vi.fn();
  const { rerender } = render(
    <WriteToBusPanel
      targets={[{ address: '1/2/3', name: 'Light', main: 1, sub: 1 }]}
      ctrlSendRequest={null}
      onCtrlSendHandled={onCtrlSendHandled}
    />,
  );
  expect(screen.getAllByPlaceholderText('GA')).toHaveLength(1);

  rerender(
    <WriteToBusPanel
      targets={[{ address: '1/2/3', name: 'Light', main: 1, sub: 1 }]}
      ctrlSendRequest={{ nonce: 4, address: '1/2/3', dptMain: 1, dptSub: 1 }}
      onCtrlSendHandled={onCtrlSendHandled}
    />,
  );
  await waitFor(() => expect(screen.getByPlaceholderText('GA')).toHaveValue('1/2/3'));
  expect(screen.getAllByPlaceholderText('GA')).toHaveLength(1);
  expect(screen.getByPlaceholderText('Group name')).toHaveValue('Light');
  expect(onCtrlSendHandled).toHaveBeenCalled();
});

test('ctrlSendRequest inserts at top when DPT differs or delay/every set', async () => {
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '5.001', value: '', delay: '', every: '' },
  ]));
  const onCtrlSendHandled = vi.fn();
  const { rerender, container } = render(
    <WriteToBusPanel
      targets={[{ address: '1/2/3', name: 'Light', main: 1, sub: 1 }]}
      ctrlSendRequest={null}
      onCtrlSendHandled={onCtrlSendHandled}
    />,
  );

  rerender(
    <WriteToBusPanel
      targets={[{ address: '1/2/3', name: 'Light', main: 1, sub: 1 }]}
      ctrlSendRequest={{ nonce: 2, address: '1/2/3', name: 'Light', dptMain: 1, dptSub: 1 }}
      onCtrlSendHandled={onCtrlSendHandled}
    />,
  );
  await waitFor(() => expect(screen.getAllByPlaceholderText('GA')).toHaveLength(2));
  const gas = screen.getAllByPlaceholderText('GA');
  expect(gas[0]).toHaveValue('1/2/3');
  expect(gas[1]).toHaveValue('1/2/3');
  expect(screen.getAllByPlaceholderText('Group name')[0]).toHaveValue('Light');
  expect(container.querySelector('.row-outline-flash')).toBeTruthy();
  expect(onCtrlSendHandled).toHaveBeenCalled();
});

test('ctrlSendRequest inserts a new GA at the top', async () => {
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '4/5/6', dpt: '5.001', value: '', delay: '', every: '' },
  ]));
  const { rerender } = render(
    <WriteToBusPanel
      targets={[
        { address: '1/2/3', name: 'Light', main: 1, sub: 1 },
        { address: '4/5/6', name: 'Other', main: 5, sub: 1 },
      ]}
      ctrlSendRequest={null}
    />,
  );
  rerender(
    <WriteToBusPanel
      targets={[
        { address: '1/2/3', name: 'Light', main: 1, sub: 1 },
        { address: '4/5/6', name: 'Other', main: 5, sub: 1 },
      ]}
      ctrlSendRequest={{ nonce: 3, address: '1/2/3', dptMain: 1, dptSub: 1 }}
    />,
  );
  await waitFor(() => expect(screen.getAllByPlaceholderText('GA')[0]).toHaveValue('1/2/3'));
  expect(screen.getAllByPlaceholderText('GA')[1]).toHaveValue('4/5/6');
});

test('ctrlSendRequest is a no-op when the panel already has more than one row', async () => {
  localStorage.setItem(ROWS_KEY, JSON.stringify([
    { address: '1/2/3', dpt: '1.001', value: '', delay: '', every: '' },
    { address: '4/5/6', dpt: '5.001', value: '', delay: '', every: '' },
  ]));
  const onCtrlSendHandled = vi.fn();
  const { rerender } = render(
    <WriteToBusPanel
      targets={[]}
      ctrlSendRequest={null}
      onCtrlSendHandled={onCtrlSendHandled}
    />,
  );
  expect(screen.getAllByPlaceholderText('GA')).toHaveLength(2);

  rerender(
    <WriteToBusPanel
      targets={[]}
      ctrlSendRequest={{ nonce: 9, address: '7/8/9', dptMain: 1, dptSub: 1 }}
      onCtrlSendHandled={onCtrlSendHandled}
    />,
  );
  await waitFor(() => expect(onCtrlSendHandled).toHaveBeenCalled());
  const gas = screen.getAllByPlaceholderText('GA');
  expect(gas).toHaveLength(2);
  expect(gas[0]).toHaveValue('1/2/3');
  expect(gas[1]).toHaveValue('4/5/6');
});

test('Read with every starts a cyclic read and a Response does not end it', async () => {
  const job = {
    state: 'running',
    id: 'read-cyc',
    address: '1/2/3',
    read: true,
    interval_seconds: 5,
    sends_done: 1,
    sends_skipped: 0,
    next_send_at: new Date(Date.now() + 4_000).toISOString(),
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => ({ jobs: [job] }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled')) {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ address: '1/2/3', read: true, interval_seconds: 5 });
      expect(body.payload).toBeUndefined();
      return { ok: true, json: async () => job } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));

  const history: ReturnType<typeof telegramOn>[] = [];
  const view = (latest: ReturnType<typeof telegramOn> | null) => (
    <GaReadPhaseProvider rows={[...history]}>
      <WriteToBusPanel targets={[]} latestTelegram={latest} />
    </GaReadPhaseProvider>
  );
  const { rerender } = render(view(null));
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText('every'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: /Read/ }));
  await screen.findByLabelText(/cyclic read of 1\/2\/3 every 5s/);

  const readTg = telegramOn('1/2/3', {
    timestamp: '2026-01-01T12:00:01.000000+00:00',
    direction: 'Incoming',
    telegram_type: 'GroupValueRead',
    simplified_type: 'Read',
    value_numeric: null,
    value_formatted: null,
  });
  const olderResponse = telegramOn('1/2/3', {
    timestamp: '2026-01-01T12:00:00.000000+00:00',
    direction: 'Incoming',
    telegram_type: 'GroupValueResponse',
    simplified_type: 'Response',
    value_numeric: 1,
    value_formatted: '1',
  });
  history.push(olderResponse, readTg);
  rerender(view(readTg));
  await waitFor(() => expect(screen.getByText('READ')).toHaveStyle({ color: 'var(--warning-text)' }));

  const responseTg = telegramOn('1/2/3', {
    timestamp: '2026-01-01T12:00:02.000000+00:00',
    direction: 'Incoming',
    telegram_type: 'GroupValueResponse',
    simplified_type: 'Response',
    value_numeric: 22.3,
    value_formatted: '22.3',
  });
  history.push(responseTg);
  rerender(view(responseTg));
  await waitFor(() => expect(screen.getByText('READ')).toHaveStyle({ color: 'var(--success)' }));
  expect(document.querySelector('[data-status-field]')?.textContent).not.toMatch(/RESPONSE/);
  expect(screen.getByLabelText(/cyclic read of 1\/2\/3 every 5s/)).toBeInTheDocument();

  job.sends_done = 2;
  const nextRead = telegramOn('1/2/3', {
    ...readTg,
    timestamp: '2026-01-01T12:00:03.000000+00:00',
    direction: 'Outgoing',
  });
  history.push(nextRead);
  rerender(view(nextRead));
  await waitFor(() => expect(screen.getByText('READ')).toHaveStyle({ color: 'var(--warning-text)' }), { timeout: 2500 });
  expect(screen.getByLabelText(/cyclic read of 1\/2\/3 every 5s/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Write/ })).toBeDisabled();
});

test('a second row of the same GA can run the other job kind', async () => {
  const jobs: Record<string, unknown> = {};
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/knx/send/scheduled/status')) {
      return { ok: true, json: async () => ({ jobs: Object.values(jobs) }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled/cancel')) {
      return { ok: true, json: async () => ({ status: 'ok' }) } as Response;
    }
    if (url.includes('/api/knx/send/scheduled')) {
      const body = JSON.parse(String(init?.body)) as { read?: boolean };
      const id = body.read ? 'read-job' : 'write-job';
      const job = {
        state: 'running',
        id,
        address: '1/2/3',
        read: Boolean(body.read),
        interval_seconds: 5,
        sends_done: 1,
        next_send_at: new Date(Date.now() + 3_000).toISOString(),
      };
      jobs[id] = job;
      return { ok: true, json: async () => job } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));

  render(<WriteToBusPanel targets={[]} />);
  fireEvent.click(screen.getByRole('button', { name: /Add a row below/ }));
  const gas = screen.getAllByPlaceholderText('GA');
  fireEvent.change(gas[0], { target: { value: '1/2/3' } });
  fireEvent.change(gas[1], { target: { value: '1/2/3' } });
  fireEvent.change(screen.getAllByPlaceholderText(/Value/)[0], { target: { value: '50' } });
  fireEvent.change(screen.getAllByPlaceholderText('every')[0], { target: { value: '5' } });
  fireEvent.click(screen.getAllByRole('button', { name: /Write/ })[0]);
  await screen.findByLabelText(/cyclic send to 1\/2\/3/);

  expect(screen.getAllByRole('button', { name: /Read/ })[0]).toBeDisabled();
  expect(screen.getAllByRole('button', { name: /Read/ })[1]).toBeEnabled();

  fireEvent.change(screen.getAllByPlaceholderText('every')[1], { target: { value: '5' } });
  fireEvent.click(screen.getAllByRole('button', { name: /Read/ })[1]);
  await screen.findByLabelText(/cyclic read of 1\/2\/3 every 5s/);
  expect(screen.getByLabelText(/cyclic send to 1\/2\/3/)).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /^Cancel$/ })).toHaveLength(2);
});
