import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { GaValuesTable, type GaTableEntry } from './GaValuesTable';
import { GaNameWidthContext } from '../utils/gaNameWidth';
import type { Telegram } from '../hooks/useWebSocket';

const ENTRIES: GaTableEntry[] = [
  { address: '1/2/3', name: 'Kitchen Light', sending: true },
  { address: '1/2/10', name: 'Kitchen Status' },
];

function telegram(target: string, value: string): Telegram {
  return {
    timestamp: new Date().toISOString(),
    source_address: '1.1.9',
    source_name: 'Push Button',
    target_address: target,
    telegram_type: 'GroupValueWrite',
    dpt: '1.001',
    dpt_main: 1,
    dpt_sub: 1,
    dpt_name: '1.001 - Switch',
    value_numeric: 1,
    value_json: null,
    value_formatted: value,
    raw_data: '01',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('fetches last values for its addresses and leaves never-seen GAs blank', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    expect(url).toContain('/api/telegrams/last');
    expect(decodeURIComponent(url)).toContain('1/2/3,1/2/10');
    return { ok: true, json: async () => ({ telegrams: [telegram('1/2/3', 'On')] }) } as Response;
  }));

  render(<GaValuesTable entries={ENTRIES} depth={0} latestTelegram={null} onFilterGAs={() => {}} onLastSeen={() => {}} onVisualizeGAs={() => {}} />);

  await waitFor(() => expect(screen.getByText('On')).toBeInTheDocument());
  const neverSeenRow = screen.getByText('Kitchen Status').closest('tr')!;
  const cells = within(neverSeenRow).getAllByRole('cell');
  expect(cells[3]).toHaveTextContent(''); // TIME
  expect(cells[3]).toHaveAttribute('title', 'Never updated');
  expect(cells[4]).toHaveTextContent(''); // VALUE
});

test('updates a value live from the websocket feed and ignores unrelated GAs', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => (
    { ok: true, json: async () => ({ telegrams: [telegram('1/2/3', 'On')] }) } as Response
  )));

  const { rerender } = render(
    <GaValuesTable entries={ENTRIES} depth={0} latestTelegram={null} onFilterGAs={() => {}} onLastSeen={() => {}} onVisualizeGAs={() => {}} />
  );
  await waitFor(() => expect(screen.getByText('On')).toBeInTheDocument());
  expect(within(screen.getByText('Kitchen Status').closest('tr')!).getAllByRole('cell')[4]).toHaveTextContent('');

  rerender(
    <GaValuesTable entries={ENTRIES} depth={0} latestTelegram={telegram('1/2/10', 'Off')} onFilterGAs={() => {}} onLastSeen={() => {}} onVisualizeGAs={() => {}} />
  );
  await waitFor(() => expect(screen.getByText('Off')).toBeInTheDocument());

  rerender(
    <GaValuesTable entries={ENTRIES} depth={0} latestTelegram={telegram('9/9/9', 'Ignored')} onFilterGAs={() => {}} onLastSeen={() => {}} onVisualizeGAs={() => {}} />
  );
  expect(screen.queryByText('Ignored')).not.toBeInTheDocument();
});

test('sorts by group address ascending, descending, then back to ETS order', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ telegrams: [] }) } as Response)));

  render(<GaValuesTable entries={ENTRIES} depth={0} latestTelegram={null} onFilterGAs={() => {}} onLastSeen={() => {}} onVisualizeGAs={() => {}} />);
  await waitFor(() => expect(screen.getByText('1/2/3')).toBeInTheDocument());

  const gaCell = (row: HTMLElement) => within(row).getAllByRole('cell')[0].textContent;
  const dataRows = () => screen.getAllByRole('row').slice(1); // drop header

  // ETS order: 1/2/3 (sending) first as provided
  expect(gaCell(dataRows()[0])).toContain('1/2/3');

  const gaHeader = screen.getByText('GA');
  // asc: numeric GA order → 1/2/3 before 1/2/10
  fireEvent.click(gaHeader);
  expect(gaCell(dataRows()[0])).toContain('1/2/3');
  // desc: 1/2/10 before 1/2/3
  fireEvent.click(gaHeader);
  expect(gaCell(dataRows()[0])).toContain('1/2/10');
  // third click restores original ETS order
  fireEvent.click(gaHeader);
  expect(gaCell(dataRows()[0])).toContain('1/2/3');
});

test('highlights the sending group address', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ telegrams: [] }) } as Response)));

  render(<GaValuesTable entries={ENTRIES} depth={0} latestTelegram={null} onFilterGAs={() => {}} onLastSeen={() => {}} onVisualizeGAs={() => {}} />);
  await waitFor(() => expect(screen.getByText('1/2/3')).toBeInTheDocument());

  expect(screen.getByLabelText('sending')).toBeInTheDocument();
  const sendingRow = screen.getByTitle('Sending group address');
  expect(within(sendingRow).getByText('1/2/3')).toBeInTheDocument();
});

test('highlights the hovered row and restores the sending tint on leave', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ telegrams: [] }) } as Response)));

  render(<GaValuesTable entries={ENTRIES} depth={0} latestTelegram={null} onFilterGAs={() => {}} onLastSeen={() => {}} onVisualizeGAs={() => {}} />);
  await waitFor(() => expect(screen.getByText('1/2/3')).toBeInTheDocument());

  const sendingRow = screen.getByTitle('Sending group address');
  fireEvent.mouseEnter(sendingRow);
  expect(sendingRow.style.background).toBe('var(--bg-hover)');
  fireEvent.mouseLeave(sendingRow);
  expect(sendingRow.style.background).toBe('rgba(99, 102, 241, 0.08)');

  const otherRow = screen.getByText('Kitchen Status').closest('tr')!;
  fireEvent.mouseEnter(otherRow);
  expect(otherRow.style.background).toBe('var(--bg-hover)');
  fireEvent.mouseLeave(otherRow);
  expect(otherRow.style.background).toBe('transparent');
});

test('visualizes a single GA row (#307)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ telegrams: [] }) } as Response)));
  const onVisualizeGAs = vi.fn();

  render(
    <GaValuesTable
      entries={ENTRIES} depth={0} latestTelegram={null}
      onFilterGAs={() => {}} onLastSeen={() => {}} onVisualizeGAs={onVisualizeGAs}
    />
  );
  await waitFor(() => expect(screen.getByText('1/2/3')).toBeInTheDocument());

  const row = screen.getByText('Kitchen Status').closest('tr')!;
  fireEvent.click(within(row).getByTitle('Visualize this group address'));
  expect(onVisualizeGAs).toHaveBeenCalledWith(['1/2/10']);
});

test('sizes the NAME column from GaNameWidthContext when provided', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ telegrams: [] }) } as Response)));

  render(
    <GaNameWidthContext.Provider value={24}>
      <GaValuesTable entries={ENTRIES} depth={0} latestTelegram={null} onFilterGAs={() => {}} onLastSeen={() => {}} onVisualizeGAs={() => {}} />
    </GaNameWidthContext.Provider>
  );
  await waitFor(() => expect(screen.getByText('Kitchen Light')).toBeInTheDocument());

  const nameCell = screen.getByText('Kitchen Light').closest('td')!;
  expect(nameCell.style.width).toBe('24ch');
});
