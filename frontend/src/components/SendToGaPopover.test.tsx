import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { format } from 'date-fns';
import { SendToGaHost, SendToGaPopover } from './SendToGaPopover';

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

  // Last value loads. DPT 1.011 (state) maps Off → inactive.
  await waitFor(() => expect(screen.getByText('inactive')).toBeInTheDocument());

  // Verify that the timestamp is also formatted and displayed.
  const expectedTime = format(new Date('2026-07-17T09:00:00Z'), 'yyyy-MM-dd HH:mm:ss');
  expect(screen.getByText(expectedTime)).toBeInTheDocument();
  // Without onGotoTelegram there is no jump button.
  expect(screen.queryByRole('button', { name: 'Go to telegram' })).not.toBeInTheDocument();

  expect(screen.queryByPlaceholderText(/Value/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Datapoint type')).toHaveValue('1.011');
  expect(screen.queryByText(/^DPT\s/)).not.toBeInTheDocument();

  const inactive = screen.getByRole('button', { name: /^inactive$/i });
  const active = screen.getByRole('button', { name: /^active$/i });
  const read = screen.getByRole('button', { name: /^Read$/i });
  expect(inactive.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // No value field: send buttons sit between DPT and delay; Read is right of every.
  const send = inactive.parentElement as HTMLElement;
  expect(send.style.gridArea).toBe('write');
  expect(send.style.display).toBe('flex');
  expect(send.style.flexWrap).toBe('wrap');
  expect(send.style.width).toBe('max-content');
  expect(inactive.style.width).not.toBe('100%');
  expect((read.parentElement as HTMLElement).style.gridArea).toBe('read');
  const dpt = screen.getByLabelText('Datapoint type');
  const scheduleInputs = screen.getAllByPlaceholderText('s');
  expect(scheduleInputs).toHaveLength(2);
  expect(dpt.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(send.compareDocumentPosition(scheduleInputs[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(
    scheduleInputs[1].compareDocumentPosition(read) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  fireEvent.click(active);

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/knx/send'));
    expect(call).toBeTruthy();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body).toMatchObject({ address: '16/0/1', payload: true, dpt: '1.011' });
  });
  await waitFor(() => expect(screen.getByText(/Sent .+ to 16\/0\/1/)).toBeInTheDocument());
  expect(document.querySelector('[data-status-field] .lucide-send')).not.toBeNull();
});

test('jump button calls onGotoTelegram with the last telegram', async () => {
  const onGotoTelegram = vi.fn();
  const fetchMock = mockFetch({
    '/api/telegrams': {
      telegrams: [{
        value_formatted: 'Off',
        unit: null,
        timestamp: '2026-07-17T09:00:00Z',
        simplified_type: 'Write',
        telegram_type: 'GroupValueWrite',
        source_address: '1.1.1',
        target_address: '16/0/1',
      }],
    },
  });
  vi.stubGlobal('fetch', fetchMock);

  render(
    <SendToGaPopover
      address="16/0/1"
      name="SRV_Alive"
      dptMain={1}
      dptSub={11}
      onGotoTelegram={onGotoTelegram}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Send to this GA/ }));
  await waitFor(() => expect(screen.getByText('WRITE')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Go to telegram' }));
  expect(onGotoTelegram).toHaveBeenCalledWith(expect.objectContaining({
    timestamp: '2026-07-17T09:00:00Z',
    simplified_type: 'Write',
    target_address: '16/0/1',
  }));
  // Jump must not close the popover.
  expect(screen.getByText('16/0/1')).toBeInTheDocument();
  expect(screen.getByText(/Last value/)).toBeInTheDocument();
});

test('open trigger stays accent-colored while the popover is open', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/telegrams': { telegrams: [] } }));

  render(<SendToGaPopover address="1/1/1" dptMain={1} dptSub={1} />);
  const trigger = screen.getByRole('button', { name: /Send to this GA/ });
  expect(trigger).not.toHaveAttribute('data-send-popover-open');

  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByText('1/1/1')).toBeInTheDocument());
  expect(trigger).toHaveAttribute('data-send-popover-open');
  expect(trigger.style.color).toBe('var(--accent-primary)');
});

test('restore-list jump returns scrollTop from when the popover opened', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/telegrams': { telegrams: [] } }));

  const { container } = render(
    <div data-telegram-table>
      <div data-telegram-scroll style={{ height: 80, overflow: 'auto' }}>
        <div style={{ height: 400 }} />
        <SendToGaPopover address="1/1/1" dptMain={1} dptSub={1} />
      </div>
    </div>,
  );
  const scrollEl = container.querySelector('[data-telegram-scroll]') as HTMLElement;
  scrollEl.scrollTop = 120;

  fireEvent.click(screen.getByRole('button', { name: /Send to this GA/ }));
  await waitFor(() => expect(screen.getByText('1/1/1')).toBeInTheDocument());
  // Hidden while still at the open snapshot.
  expect(screen.queryByRole('button', { name: 'Restore list position' })).not.toBeInTheDocument();

  scrollEl.scrollTop = 40;
  fireEvent.scroll(scrollEl);
  const restoreBtn = screen.getByRole('button', { name: 'Restore list position' });
  expect(restoreBtn.querySelector('.lucide-locate-fixed')).not.toBeNull();

  fireEvent.click(restoreBtn);
  expect(scrollEl.scrollTop).toBe(120);
  expect(screen.queryByRole('button', { name: 'Restore list position' })).not.toBeInTheDocument();
  expect(screen.getByText('1/1/1')).toBeInTheDocument();
});

test('hosted restore-list jump uses capture/restore callbacks', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/telegrams': { telegrams: [] } }));
  const snap = { scrollTop: 90, key: 'k1', offset: 12 };
  const captureListScroll = vi.fn(() => snap);
  const restoreListScroll = vi.fn();

  const { container } = render(
    <div data-telegram-table style={{ position: 'fixed', top: 0, left: 0, width: 600, height: 400 }}>
      <div data-telegram-scroll style={{ height: 80, overflow: 'auto' }}>
        <div style={{ height: 400 }} />
      </div>
      <SendToGaHost captureListScroll={captureListScroll} restoreListScroll={restoreListScroll}>
        <SendToGaPopover address="1/1/1" dptMain={1} dptSub={1} />
      </SendToGaHost>
    </div>,
  );
  const scrollEl = container.querySelector('[data-telegram-scroll]') as HTMLElement;
  scrollEl.scrollTop = snap.scrollTop;
  const trigger = screen.getByRole('button', { name: /Send to this GA/ });
  trigger.getBoundingClientRect = () => ({
    x: 120, y: 140, top: 140, left: 120, right: 144, bottom: 164, width: 24, height: 24,
    toJSON() { return this; },
  });

  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByText('1/1/1')).toBeInTheDocument());
  expect(captureListScroll).toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Restore list position' })).not.toBeInTheDocument();

  scrollEl.scrollTop = 40;
  fireEvent.scroll(scrollEl);
  const restoreBtn = screen.getByRole('button', { name: 'Restore list position' });
  expect(restoreBtn.querySelector('.lucide-locate-fixed')).not.toBeNull();
  fireEvent.click(restoreBtn);
  expect(restoreListScroll).toHaveBeenCalledWith(snap);
  expect(screen.queryByRole('button', { name: 'Restore list position' })).not.toBeInTheDocument();
  expect(screen.getByText('1/1/1')).toBeInTheDocument();
});

test('restore-list button stays hidden while list scroll matches the open snapshot', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/telegrams': { telegrams: [] } }));

  const { container } = render(
    <div data-telegram-table>
      <div data-telegram-scroll style={{ height: 80, overflow: 'auto' }}>
        <div style={{ height: 400 }} />
        <SendToGaPopover address="1/1/1" dptMain={1} dptSub={1} />
      </div>
    </div>,
  );
  const scrollEl = container.querySelector('[data-telegram-scroll]') as HTMLElement;
  scrollEl.scrollTop = 80;

  fireEvent.click(screen.getByRole('button', { name: /Send to this GA/ }));
  await waitFor(() => expect(screen.getByText('1/1/1')).toBeInTheDocument());
  fireEvent.scroll(scrollEl);
  expect(screen.queryByRole('button', { name: 'Restore list position' })).not.toBeInTheDocument();

  scrollEl.scrollTop = 81;
  fireEvent.scroll(scrollEl);
  expect(screen.getByRole('button', { name: 'Restore list position' })).toBeInTheDocument();

  scrollEl.scrollTop = 80;
  fireEvent.scroll(scrollEl);
  expect(screen.queryByRole('button', { name: 'Restore list position' })).not.toBeInTheDocument();
});

test('hosted popover stays open after the row trigger unmounts', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/telegrams': { telegrams: [] } }));

  function Harness({ showTrigger }: { showTrigger: boolean }) {
    return (
      <div data-telegram-table style={{ position: 'fixed', top: 0, left: 0, width: 600, height: 400 }}>
        <SendToGaHost>
          {showTrigger ? <SendToGaPopover address="1/1/1" dptMain={1} dptSub={1} /> : null}
        </SendToGaHost>
      </div>
    );
  }

  const { rerender } = render(<Harness showTrigger />);
  const trigger = screen.getByRole('button', { name: /Send to this GA/ });
  trigger.getBoundingClientRect = () => ({
    x: 120, y: 140, top: 140, left: 120, right: 144, bottom: 164, width: 24, height: 24,
    toJSON() { return this; },
  });
  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByText('1/1/1')).toBeInTheDocument());

  rerender(<Harness showTrigger={false} />);
  expect(screen.queryByRole('button', { name: /Send to this GA/ })).not.toBeInTheDocument();
  expect(screen.getByText('1/1/1')).toBeInTheDocument();
});

test('restore-list jump is absent outside the telegram table', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/telegrams': { telegrams: [] } }));

  render(<SendToGaPopover address="1/1/1" name="Kitchen" dptMain={1} dptSub={1} />);
  fireEvent.click(screen.getByRole('button', { name: /Send to this GA/ }));
  await waitFor(() => expect(screen.getByText('1/1/1')).toBeInTheDocument());
  expect(screen.getByText('Kitchen')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Restore list position' })).not.toBeInTheDocument();
});

test('triggers a GroupValueRead from the Read button', async () => {
  const fetchMock = mockFetch({
    '/api/telegrams': { telegrams: [] },
    '/api/knx/read': { status: 'ok' },
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<SendToGaPopover address="1/1/97" name="Helligkeit" dptMain={9} dptSub={4} />);
  fireEvent.click(screen.getByRole('button', { name: /Send to this GA/ }));

  // Non-DPT-1 shows the free value field; no last-value row without a telegram.
  await waitFor(() => expect(screen.getByPlaceholderText(/Value/)).toBeInTheDocument());
  expect(screen.queryByText(/Last value/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Datapoint type')).toHaveValue('9.004');
  const write = screen.getByRole('button', { name: /Write/ });
  const read = screen.getByRole('button', { name: /Read/ });
  expect(write.compareDocumentPosition(read) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect((write.parentElement as HTMLElement).style.gridArea).toBe('write');
  // Value under DPT + Write; Read sits in its own cell right of every (same column as Write).
  expect((read.parentElement as HTMLElement).style.gridArea).toBe('read');
  const value = screen.getByPlaceholderText(/Value/);
  expect(value.compareDocumentPosition(write) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const scheduleInputs = screen.getAllByPlaceholderText('s');
  expect(scheduleInputs[1].compareDocumentPosition(read) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(read);

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/knx/read'));
    expect(call).toBeTruthy();
    expect(JSON.parse((call![1] as RequestInit).body as string)).toMatchObject({ address: '1/1/97' });
  });
  // Wait chrome: orange "read request sent"; popover stays open; no Cancel.
  await waitFor(() => expect(screen.getByLabelText(/^read request sent$/i)).toBeInTheDocument());
  expect(screen.getByText(/^read request sent$/i)).toBeInTheDocument();
  expect(document.querySelector('[data-status-field] .lucide-radio')).not.toBeNull();
  expect(screen.queryByRole('button', { name: /^Cancel$/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Datapoint type')).toBeInTheDocument();
  expect(read).toHaveClass('wtb-read-btn');
  await waitFor(() => expect(screen.getByRole('button', { name: /^Read$/ })).toHaveFocus());
});

test('read wait ends only on Response; Write is ignored; close clears wait', async () => {
  const fetchMock = mockFetch({
    '/api/telegrams': {
      telegrams: [{
        value_formatted: '21.5', unit: '°C', timestamp: '2026-07-17T09:00:00Z',
        simplified_type: 'Write', target_address: '1/1/97',
      }],
    },
    '/api/knx/read': { status: 'ok' },
  });
  vi.stubGlobal('fetch', fetchMock);

  const { rerender } = render(
    <SendToGaPopover address="1/1/97" name="Helligkeit" dptMain={9} dptSub={4} latestTelegram={null} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Send to this GA/ }));
  await waitFor(() => expect(screen.getByText(/Last value/)).toBeInTheDocument());
  expect(screen.getByText('21.5')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /^Read$/ }));
  await waitFor(() => expect(screen.getByLabelText(/^read request sent$/i)).toBeInTheDocument());
  expect(screen.getByText('21.5')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Cancel$/ })).not.toBeInTheDocument();
  // Wait must not lock write controls (Write itself still needs a value).
  expect(screen.getByLabelText('Datapoint type')).not.toBeDisabled();
  expect(screen.getByLabelText('Value')).not.toBeDisabled();
  expect(screen.getByRole('button', { name: /^Read$/ })).not.toBeDisabled();
  fireEvent.change(screen.getByLabelText('Value'), { target: { value: '10' } });
  expect(screen.getByRole('button', { name: /Write/ })).not.toBeDisabled();

  const writeTg = {
    timestamp: '2026-07-17T09:05:01Z',
    telegram_type: 'GroupValueWrite',
    simplified_type: 'Write',
    target_address: '1/1/97',
    value_formatted: '99',
  };
  rerender(
    <SendToGaPopover address="1/1/97" name="Helligkeit" dptMain={9} dptSub={4} latestTelegram={writeTg as never} />,
  );
  // Write updates last value/timestamp but must not end the wait.
  expect(screen.getByLabelText(/^read request sent$/i)).toBeInTheDocument();
  expect(screen.getByText('99')).toBeInTheDocument();
  expect(screen.queryByText('21.5')).not.toBeInTheDocument();
  expect(screen.getByText(format(new Date('2026-07-17T09:05:01Z'), 'yyyy-MM-dd HH:mm:ss'))).toBeInTheDocument();

  const response = {
    timestamp: '2026-07-17T09:05:02Z',
    telegram_type: 'GroupValueResponse',
    simplified_type: 'Response',
    target_address: '1/1/97',
    value_formatted: '22.3',
    unit: '°C',
  };
  rerender(
    <SendToGaPopover address="1/1/97" name="Helligkeit" dptMain={9} dptSub={4} latestTelegram={response as never} />,
  );
  await waitFor(() => expect(screen.getByLabelText(/^read response detected$/i)).toBeInTheDocument());
  expect(screen.getByText('22.3')).toBeInTheDocument();
  expect(screen.getByText('RESPONSE')).toBeInTheDocument();
  expect(screen.getByText(/^read response detected$/i)).toBeInTheDocument();
  expect(document.querySelector('[data-status-field] .lucide-radio')).not.toBeNull();
  expect(screen.queryByLabelText(/^read request sent$/i)).not.toBeInTheDocument();

  // Close clears wait: reopen must not show leftover status.
  fireEvent.click(screen.getByRole('button', { name: /Send to this GA/ }));
  expect(screen.queryByText(/Last value/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Send to this GA/ }));
  await waitFor(() => expect(screen.getByText(/Last value/)).toBeInTheDocument());
  expect(screen.queryByLabelText(/^read request sent$/i)).not.toBeInTheDocument();

  // Escape during wait also clears.
  fireEvent.click(screen.getByRole('button', { name: /^Read$/ }));
  await waitFor(() => expect(screen.getByLabelText(/^read request sent$/i)).toBeInTheDocument());
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByText(/Last value/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Send to this GA/ }));
  await waitFor(() => expect(screen.getByText(/Last value/)).toBeInTheDocument());
  expect(screen.queryByLabelText(/^read request sent$/i)).not.toBeInTheDocument();
});

test('DPT suggestions include project catalog subtypes for the GA main', async () => {
  render(
    <SendToGaPopover
      address="14/5/1"
      name="Temp"
      dptMain={9}
      dptSub={1}
      dptCatalog={[
        { main: 9, sub: 1, label: '9.001 - Temperature' },
        { main: 9, sub: 5, label: '9.005 - Wind speed' },
        { main: 9, sub: 20, label: '9.020 - Humidity' },
        { main: 5, sub: 1, label: '5.001 - Percent' },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Send to this GA/ }));
  await waitFor(() => expect(screen.getByLabelText('Datapoint type')).toHaveValue('9.001'));

  fireEvent.click(screen.getByRole('button', { name: 'Toggle datapoint type list' }));
  const list = await screen.findByRole('listbox', { name: 'Datapoint types' });
  const options = [...list.querySelectorAll('[role="option"]')].map(o => o.textContent ?? '');
  expect(options.some(t => t.includes('9.001'))).toBe(true);
  expect(options.some(t => t.includes('9.004'))).toBe(true); // COMMON
  expect(options.some(t => t.includes('9.005'))).toBe(true);
  expect(options.some(t => t.includes('9.020'))).toBe(true);
  expect(options.some(t => t.includes('5.001'))).toBe(false); // other main filtered out
});

test('still opens when send overlap cannot be fully cleared inside the boundary', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/telegrams': { telegrams: [] } }));

  const { container } = render(
    <div
      data-telegram-table
      style={{ position: 'fixed', top: 100, left: 100, width: 320, height: 240 }}
    >
      <SendToGaPopover address="1/1/1" dptMain={1} dptSub={1} />
    </div>,
  );

  const table = container.querySelector('[data-telegram-table]') as HTMLElement;
  const trigger = screen.getByRole('button', { name: /Send to this GA/ });
  table.getBoundingClientRect = () => ({
    x: 100, y: 100, top: 100, left: 100, right: 420, bottom: 340, width: 320, height: 240,
    toJSON() { return this; },
  });
  trigger.getBoundingClientRect = () => ({
    // Near the bottom-right corner — clearing this trigger fully would leave
    // the narrow table, but the popover must still open (no auto-dismiss).
    x: 360, y: 300, top: 300, left: 360, right: 384, bottom: 324, width: 24, height: 24,
    toJSON() { return this; },
  });

  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByText('1/1/1')).toBeInTheDocument());
});

test('nudges the card away from the jump-to-live pill', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/telegrams': { telegrams: [] } }));

  const { container } = render(
    <div data-telegram-table style={{ position: 'fixed', top: 100, left: 100, width: 520, height: 300 }}>
      <button
        data-jump-to-live-pill=""
        type="button"
        style={{ position: 'fixed', top: 160, left: 200, width: 160, height: 32 }}
      >
        newer telegrams
      </button>
      <SendToGaPopover address="1/1/1" dptMain={1} dptSub={1} />
    </div>,
  );
  const table = container.querySelector('[data-telegram-table]') as HTMLElement;
  const pill = container.querySelector('[data-jump-to-live-pill]') as HTMLElement;
  const trigger = screen.getByRole('button', { name: /Send to this GA/ });
  table.getBoundingClientRect = () => ({
    x: 100, y: 100, top: 100, left: 100, right: 620, bottom: 400, width: 520, height: 300,
    toJSON() { return this; },
  });
  pill.getBoundingClientRect = () => ({
    x: 200, y: 160, top: 160, left: 200, right: 360, bottom: 192, width: 160, height: 32,
    toJSON() { return this; },
  });
  // Trigger top-aligned with the pill — naive placement would cover it.
  trigger.getBoundingClientRect = () => ({
    x: 120, y: 160, top: 160, left: 120, right: 144, bottom: 184, width: 24, height: 24,
    toJSON() { return this; },
  });

  fireEvent.click(trigger);
  const card = await waitFor(() => {
    const el = screen.getByText('1/1/1').parentElement?.parentElement as HTMLElement | null;
    expect(el?.style.position).toBe('fixed');
    return el!;
  });
  Object.defineProperty(card, 'offsetWidth', { configurable: true, get: () => 280 });
  Object.defineProperty(card, 'offsetHeight', { configurable: true, get: () => 160 });
  fireEvent.resize(window);

  await waitFor(() => {
    const top = Number.parseFloat(card.style.top);
    const left = Number.parseFloat(card.style.left);
    const overlaps =
      !(left + 280 <= 200 || left >= 360 || top + 160 <= 160 || top >= 192);
    expect(overlaps).toBe(false);
  });
});

test('opens to the right of the send button when space allows', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/telegrams': { telegrams: [] } }));

  const { container } = render(
    <div data-telegram-table style={{ position: 'fixed', top: 100, left: 100, width: 520, height: 300 }}>
      <SendToGaPopover address="1/1/1" dptMain={1} dptSub={1} />
    </div>,
  );
  const table = container.querySelector('[data-telegram-table]') as HTMLElement;
  const trigger = screen.getByRole('button', { name: /Send to this GA/ });
  table.getBoundingClientRect = () => ({
    x: 100, y: 100, top: 100, left: 100, right: 620, bottom: 400, width: 520, height: 300,
    toJSON() { return this; },
  });
  trigger.getBoundingClientRect = () => ({
    x: 140, y: 180, top: 180, left: 140, right: 164, bottom: 204, width: 24, height: 24,
    toJSON() { return this; },
  });

  fireEvent.click(trigger);
  const card = await waitFor(() => {
    const el = screen.getByText('1/1/1').parentElement?.parentElement as HTMLElement | null;
    expect(el?.style.position).toBe('fixed');
    return el!;
  });
  Object.defineProperty(card, 'offsetWidth', { configurable: true, get: () => 280 });
  Object.defineProperty(card, 'offsetHeight', { configurable: true, get: () => 160 });
  fireEvent.resize(window);

  await waitFor(() => {
    const left = Number.parseFloat(card.style.left);
    const top = Number.parseFloat(card.style.top);
    expect(left).toBe(170); // trigger.right + gap
    expect(top).toBe(180); // top-aligned with trigger
  });
});

test('list scroll does not move the open popover when nothing overlaps', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/telegrams': { telegrams: [] } }));

  const { container } = render(
    <div data-telegram-table style={{ position: 'fixed', top: 100, left: 100, width: 520, height: 300 }}>
      <SendToGaPopover address="1/1/1" dptMain={1} dptSub={1} />
    </div>,
  );
  const table = container.querySelector('[data-telegram-table]') as HTMLElement;
  const trigger = screen.getByRole('button', { name: /Send to this GA/ });
  table.getBoundingClientRect = () => ({
    x: 100, y: 100, top: 100, left: 100, right: 620, bottom: 400, width: 520, height: 300,
    toJSON() { return this; },
  });
  trigger.getBoundingClientRect = () => ({
    x: 120, y: 140, top: 140, left: 120, right: 144, bottom: 164, width: 24, height: 24,
    toJSON() { return this; },
  });

  fireEvent.click(trigger);
  const card = await waitFor(() => {
    const el = screen.getByText('1/1/1').parentElement?.parentElement as HTMLElement | null;
    expect(el?.style.position).toBe('fixed');
    return el!;
  });
  Object.defineProperty(card, 'offsetWidth', { configurable: true, get: () => 280 });
  Object.defineProperty(card, 'offsetHeight', { configurable: true, get: () => 160 });
  fireEvent.resize(window);
  await waitFor(() => expect(Number.parseFloat(card.style.left)).toBe(150));
  const top = card.style.top;
  const left = card.style.left;

  // Trigger moved with the list but stays clear of the card — freeze.
  trigger.getBoundingClientRect = () => ({
    x: 120, y: 40, top: 40, left: 120, right: 144, bottom: 64, width: 24, height: 24,
    toJSON() { return this; },
  });
  fireEvent.scroll(window);
  fireEvent.scroll(table);

  expect(card.style.top).toBe(top);
  expect(card.style.left).toBe(left);
});

test('list scroll nudges the card right past a partially overlapping send button', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/telegrams': { telegrams: [] } }));

  const { container } = render(
    <div data-telegram-table style={{ position: 'fixed', top: 100, left: 100, width: 520, height: 300 }}>
      <SendToGaPopover address="1/1/1" dptMain={1} dptSub={1} />
      <button data-send-to-ga-trigger="" title="other send" type="button" />
    </div>,
  );
  const table = container.querySelector('[data-telegram-table]') as HTMLElement;
  const trigger = screen.getByRole('button', { name: /Send to this GA/ });
  const other = screen.getByRole('button', { name: /other send/ });
  table.getBoundingClientRect = () => ({
    x: 100, y: 100, top: 100, left: 100, right: 620, bottom: 400, width: 520, height: 300,
    toJSON() { return this; },
  });
  trigger.getBoundingClientRect = () => ({
    x: 120, y: 160, top: 160, left: 120, right: 144, bottom: 184, width: 24, height: 24,
    toJSON() { return this; },
  });
  // Starts clear of the card (above it).
  other.getBoundingClientRect = () => ({
    x: 200, y: 40, top: 40, left: 200, right: 224, bottom: 64, width: 24, height: 24,
    toJSON() { return this; },
  });

  fireEvent.click(trigger);
  const card = await waitFor(() => {
    const el = screen.getByText('1/1/1').parentElement?.parentElement as HTMLElement | null;
    expect(el?.style.position).toBe('fixed');
    return el!;
  });
  Object.defineProperty(card, 'offsetWidth', { configurable: true, get: () => 280 });
  Object.defineProperty(card, 'offsetHeight', { configurable: true, get: () => 160 });
  fireEvent.resize(window);
  await waitFor(() => expect(Number.parseFloat(card.style.left)).toBe(150));
  const topBefore = card.style.top;

  // Scroll brings the other send button into a partial overlap with the card.
  other.getBoundingClientRect = () => ({
    x: 200, y: 170, top: 170, left: 200, right: 224, bottom: 194, width: 24, height: 24,
    toJSON() { return this; },
  });
  fireEvent.scroll(table);

  await waitFor(() => {
    expect(Number.parseFloat(card.style.left)).toBe(230); // other.right + gap
    expect(card.style.top).toBe(topBefore);
    expect(screen.getByText('1/1/1')).toBeInTheDocument();
  });
});

test('list scroll keeps the popover open when a send overlap cannot be fully cleared', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/telegrams': { telegrams: [] } }));

  const { container } = render(
    <div data-telegram-table style={{ position: 'fixed', top: 100, left: 100, width: 520, height: 300 }}>
      <SendToGaPopover address="1/1/1" dptMain={1} dptSub={1} />
      <button data-send-to-ga-trigger="" title="blocking send" type="button" />
    </div>,
  );
  const table = container.querySelector('[data-telegram-table]') as HTMLElement;
  const trigger = screen.getByRole('button', { name: /Send to this GA/ });
  const other = screen.getByRole('button', { name: /blocking send/ });
  table.getBoundingClientRect = () => ({
    x: 100, y: 100, top: 100, left: 100, right: 620, bottom: 400, width: 520, height: 300,
    toJSON() { return this; },
  });
  trigger.getBoundingClientRect = () => ({
    x: 120, y: 160, top: 160, left: 120, right: 144, bottom: 184, width: 24, height: 24,
    toJSON() { return this; },
  });
  other.getBoundingClientRect = () => ({
    x: 120, y: 40, top: 40, left: 120, right: 144, bottom: 64, width: 24, height: 24,
    toJSON() { return this; },
  });

  fireEvent.click(trigger);
  const card = await waitFor(() => {
    const el = screen.getByText('1/1/1').parentElement?.parentElement as HTMLElement | null;
    expect(el?.style.position).toBe('fixed');
    return el!;
  });
  Object.defineProperty(card, 'offsetWidth', { configurable: true, get: () => 280 });
  Object.defineProperty(card, 'offsetHeight', { configurable: true, get: () => 160 });
  fireEvent.resize(window);
  await waitFor(() => expect(Number.parseFloat(card.style.left)).toBe(150));

  // Wide blocker: clearing to its right would leave the table — clamp, stay open.
  other.getBoundingClientRect = () => ({
    x: 200, y: 170, top: 170, left: 200, right: 400, bottom: 194, width: 200, height: 24,
    toJSON() { return this; },
  });
  fireEvent.scroll(table);

  await waitFor(() => {
    expect(screen.getByText('1/1/1')).toBeInTheDocument();
    // maxLeft = bounds.right - width - pad = 620 - 280 - 8 = 332
    expect(Number.parseFloat(card.style.left)).toBe(332);
  });
});

test('status-line growth nudges the card up inside the table boundary', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/telegrams': { telegrams: [] } }));

  let roCallback: ResizeObserverCallback | null = null;
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: ResizeObserverCallback) { roCallback = cb; }
    observe() {}
    unobserve() {}
    disconnect() {}
  });

  const { container } = render(
    <div data-telegram-table style={{ position: 'fixed', top: 100, left: 100, width: 520, height: 240 }}>
      <SendToGaPopover address="1/1/1" dptMain={1} dptSub={1} />
    </div>,
  );
  const table = container.querySelector('[data-telegram-table]') as HTMLElement;
  const trigger = screen.getByRole('button', { name: /Send to this GA/ });
  table.getBoundingClientRect = () => ({
    x: 100, y: 100, top: 100, left: 100, right: 620, bottom: 340, width: 520, height: 240,
    toJSON() { return this; },
  });
  // Open near the bottom with room on the right; a taller card overflows bottom.
  trigger.getBoundingClientRect = () => ({
    x: 120, y: 250, top: 250, left: 120, right: 144, bottom: 274, width: 24, height: 24,
    toJSON() { return this; },
  });

  fireEvent.click(trigger);
  const card = await waitFor(() => {
    const el = screen.getByText('1/1/1').parentElement?.parentElement as HTMLElement | null;
    expect(el?.style.position).toBe('fixed');
    return el!;
  });
  Object.defineProperty(card, 'offsetWidth', { configurable: true, get: () => 280 });
  Object.defineProperty(card, 'offsetHeight', { configurable: true, get: () => 120 });
  fireEvent.resize(window);
  await waitFor(() => {
    expect(Number.parseFloat(card.style.left)).toBe(150); // right of trigger
  });
  const leftBefore = card.style.left;
  const topBefore = Number.parseFloat(card.style.top);

  // Status line grew the card past the table bottom; ResizeObserver → place('bounds').
  const grownHeight = 220;
  Object.defineProperty(card, 'offsetHeight', { configurable: true, get: () => grownHeight });
  expect(roCallback).toBeTruthy();
  roCallback!([], {} as ResizeObserver);

  await waitFor(() => {
    const top = Number.parseFloat(card.style.top);
    expect(top).toBeLessThan(topBefore);
    expect(top).toBeGreaterThanOrEqual(108); // bounds.top + pad
    expect(top + grownHeight).toBeLessThanOrEqual(332); // bounds.bottom - pad
    expect(card.style.left).toBe(leftBefore);
  });
});

test('value unit follows the selected DPT over the last telegram unit', async () => {
  const fetchMock = mockFetch({
    '/api/telegrams': {
      telegrams: [{ value_formatted: '21.5', unit: '°C', timestamp: '2026-07-17T09:00:00Z' }],
    },
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<SendToGaPopover address="1/1/97" name="Helligkeit" dptMain={9} dptSub={4} />);
  fireEvent.click(screen.getByRole('button', { name: /Send to this GA/ }));
  await waitFor(() => expect(screen.getByLabelText('Datapoint type')).toHaveValue('9.004'));

  fireEvent.change(screen.getByLabelText('Value'), { target: { value: '100' } });
  const valueField = () => screen.getByLabelText('Value').closest('[data-value-field]') as HTMLElement;
  expect(valueField()).toHaveTextContent('lx');
  expect(valueField()).not.toHaveTextContent('°C');

  const dpt = screen.getByLabelText('Datapoint type');
  fireEvent.change(dpt, { target: { value: '9.001' } });
  fireEvent.blur(dpt);
  expect(dpt).toHaveValue('9.001');
  expect(valueField()).toHaveTextContent('°C');
  expect(valueField()).not.toHaveTextContent('lx');
});

test('hosted same-GA click on another row moves the popover instead of closing', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/telegrams': { telegrams: [] } }));
  const captureListScroll = vi.fn(() => ({ scrollTop: 10, key: 'a', offset: 2 }));

  const rect = (top: number) => () => ({
    x: 120, y: top, top, left: 120, right: 144, bottom: top + 24, width: 24, height: 24,
    toJSON() { return this; },
  });

  render(
    <div data-telegram-table style={{ position: 'fixed', top: 0, left: 0, width: 600, height: 400 }}>
      <SendToGaHost captureListScroll={captureListScroll}>
        <SendToGaPopover address="1/1/1" dptMain={9} dptSub={1} triggerId="row-a" />
        <SendToGaPopover address="1/1/1" dptMain={9} dptSub={1} triggerId="row-b" />
      </SendToGaHost>
    </div>,
  );
  const triggers = screen.getAllByRole('button', { name: /Send to this GA/ });
  triggers[0].getBoundingClientRect = rect(100);
  triggers[1].getBoundingClientRect = rect(200);

  fireEvent.click(triggers[0]);
  await waitFor(() => expect(screen.getByText('1/1/1')).toBeInTheDocument());
  expect(triggers[0]).toHaveAttribute('data-send-popover-open');
  expect(triggers[1]).toHaveAttribute('data-send-popover-open');
  expect(captureListScroll).toHaveBeenCalledTimes(1);

  fireEvent.click(triggers[1]);
  await waitFor(() => expect(screen.getByText('1/1/1')).toBeInTheDocument());
  expect(screen.getByText('1/1/1')).toBeInTheDocument();
  expect(captureListScroll).toHaveBeenCalledTimes(2);
  expect(triggers[0]).toHaveAttribute('data-send-popover-open');
  expect(triggers[1]).toHaveAttribute('data-send-popover-open');

  fireEvent.click(triggers[1]);
  await waitFor(() => expect(screen.queryByText('1/1/1')).not.toBeInTheDocument());
});

test('opens the free value field focused when possible', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/telegrams': { telegrams: [] } }));
  render(<SendToGaPopover address="1/1/97" dptMain={9} dptSub={1} />);
  fireEvent.click(screen.getByRole('button', { name: /Send to this GA/ }));
  await waitFor(() => expect(screen.getByLabelText('Value')).toBeInTheDocument());
  expect(screen.getByLabelText('Value')).toHaveFocus();
});

test('alt-click on hosted trigger calls onAltSend and does not open the popover', () => {
  const onAltSend = vi.fn();
  render(
    <SendToGaHost>
      <SendToGaPopover
        address="2/3/4"
        name="Lamp"
        dptMain={1}
        dptSub={1}
        triggerId="t1"
        onAltSend={onAltSend}
      />
    </SendToGaHost>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Send to this GA/ }), { altKey: true });
  expect(onAltSend).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('2/3/4')).not.toBeInTheDocument();
});

test('ctrl-click on hosted trigger calls onCtrlSend and does not open the popover', () => {
  const onCtrlSend = vi.fn();
  render(
    <SendToGaHost>
      <SendToGaPopover
        address="2/3/4"
        name="Lamp"
        dptMain={1}
        dptSub={1}
        triggerId="t1"
        onCtrlSend={onCtrlSend}
      />
    </SendToGaHost>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Send to this GA/ }), { ctrlKey: true });
  expect(onCtrlSend).toHaveBeenCalledWith({
    address: '2/3/4',
    name: 'Lamp',
    dptMain: 1,
    dptSub: 1,
  });
  expect(screen.queryByText('2/3/4')).not.toBeInTheDocument();
});

test('opening a DPT-1 popover focuses the leftmost write button, not on or Read', async () => {
  render(<SendToGaPopover address="1/1/1" dptMain={1} dptSub={1} />);
  fireEvent.click(screen.getByRole('button', { name: /Send to this GA/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: /^off$/i })).toHaveFocus());
  expect(screen.getByRole('button', { name: /^on$/i })).not.toHaveFocus();
  expect(screen.getByRole('button', { name: /^Read$/i })).not.toHaveFocus();
});

test('panelMatched keeps the send icon blue via data-send-panel-match', () => {
  render(
    <SendToGaHost>
      <SendToGaPopover address="2/3/4" triggerId="t1" panelMatched />
    </SendToGaHost>,
  );
  const btn = screen.getByRole('button', { name: /Send to this GA/ });
  expect(btn).toHaveAttribute('data-send-panel-match');
  expect(btn.style.color).toBe('var(--accent-primary)');
});

test('live Write updates last value and timestamp while open', async () => {
  vi.stubGlobal('fetch', mockFetch({
    '/api/telegrams': {
      telegrams: [{
        value_formatted: '21.5', unit: '°C', timestamp: '2026-07-17T09:00:00Z',
        simplified_type: 'Write', target_address: '1/1/97',
      }],
    },
  }));
  const { rerender } = render(
    <SendToGaPopover address="1/1/97" dptMain={9} dptSub={1} latestTelegram={null} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Send to this GA/ }));
  await waitFor(() => expect(screen.getByText('21.5')).toBeInTheDocument());

  const writeTg = {
    timestamp: '2026-07-17T09:10:00Z',
    telegram_type: 'GroupValueWrite',
    simplified_type: 'Write',
    target_address: '1/1/97',
    value_formatted: '18.0',
    unit: '°C',
  };
  rerender(
    <SendToGaPopover address="1/1/97" dptMain={9} dptSub={1} latestTelegram={writeTg as never} />,
  );
  expect(screen.getByText('18.0')).toBeInTheDocument();
  expect(screen.getByText(format(new Date('2026-07-17T09:10:00Z'), 'yyyy-MM-dd HH:mm:ss'))).toBeInTheDocument();
});

test('late loadLast does not overwrite a newer live last value', async () => {
  let resolveFetch: ((body: unknown) => void) | null = null;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/telegrams')) {
      const body = await new Promise<unknown>(resolve => { resolveFetch = resolve; });
      return { ok: true, json: async () => body } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  const { rerender } = render(
    <SendToGaPopover address="1/1/97" dptMain={9} dptSub={1} latestTelegram={null} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Send to this GA/ }));
  await waitFor(() => expect(resolveFetch).toBeTruthy());

  const writeTg = {
    timestamp: '2026-07-17T09:10:00Z',
    telegram_type: 'GroupValueWrite',
    simplified_type: 'Write',
    target_address: '1/1/97',
    value_formatted: '18.0',
    unit: '°C',
  };
  rerender(
    <SendToGaPopover address="1/1/97" dptMain={9} dptSub={1} latestTelegram={writeTg as never} />,
  );
  expect(screen.getByText('18.0')).toBeInTheDocument();

  resolveFetch?.({
    telegrams: [{
      value_formatted: '21.5', unit: '°C', timestamp: '2026-07-17T09:00:00Z',
      simplified_type: 'Write', target_address: '1/1/97',
    }],
  });
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(screen.getByText('18.0')).toBeInTheDocument();
  expect(screen.queryByText('21.5')).not.toBeInTheDocument();
});
