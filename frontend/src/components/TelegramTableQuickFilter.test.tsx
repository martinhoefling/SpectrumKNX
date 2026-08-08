import { render, fireEvent, screen } from '@testing-library/react';
import { expect, test, vi, beforeAll } from 'vitest';
import { format } from 'date-fns';
import { TelegramTable, type SortConfig } from './TelegramTable';
import { makeTelegram } from '../test/telegramFactory';
import type { Telegram } from '../hooks/useWebSocket';
import { DEFAULT_FILTERS } from '../types/filters';

// The <input type="datetime-local"> quick-filter rows are interpreted as
// local time (matching the datetime-local semantics used elsewhere in the
// app, e.g. GotoTimeControl) — derive the input value from a telegram's own
// UTC timestamp so the test doesn't depend on the runner's timezone.
const localInputValue = (isoUtc: string) => format(new Date(isoUtc), "yyyy-MM-dd'T'HH:mm:ss");

// jsdom has no layout: give the virtualizer a viewport so it renders rows.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(el: Element) {
      const size = { inlineSize: 1000, blockSize: el.classList.contains('log-row') ? 85 : 800 };
      this.cb(
        [{ target: el, contentRect: el.getBoundingClientRect(), borderBoxSize: [size], contentBoxSize: [size] } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 1000, height: 800, top: 0, bottom: 800, left: 0, right: 1000, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
});

const visibleColumns = {
  time: true, delta: true, source: true, sourceName: true,
  target: true, targetName: true, type: true, dpt: true, data: true, value: true,
};

const sortConfig: SortConfig = [{ key: 'timestamp', direction: 'desc' }];

const TELEGRAMS: Telegram[] = [
  makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', target_address: '1/2/3', target_name: 'Licht Küche', raw_hex: '0x03' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', target_address: '1/2/4', target_name: 'Licht Flur', raw_hex: '0x02' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', target_address: '2/0/1', target_name: 'Jalousie Bad', raw_hex: '0x01' }),
];

const renderTable = () =>
  render(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );

const rowCount = (container: HTMLElement) => container.querySelectorAll('.log-row').length;

test('expanding the quick filter bar and typing in the name row filters the rows (#271, #309)', () => {
  const { container } = renderTable();
  expect(rowCount(container)).toBe(3);
  expect(screen.queryByLabelText('Quick filter TARGET name')).not.toBeInTheDocument();

  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const nameInput = screen.getByLabelText('Quick filter TARGET name');

  fireEvent.change(nameInput, { target: { value: 'küche' } });
  expect(rowCount(container)).toBe(1);

  // Regex alternation on the name row.
  fireEvent.change(nameInput, { target: { value: 'Küche|Flur' } });
  expect(rowCount(container)).toBe(2);
});

test('the address pattern row (#309) matches by wildcard, independent of the name row', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));

  fireEvent.change(screen.getByLabelText('Quick filter TARGET pattern'), { target: { value: '1/2/*' } });
  expect(rowCount(container)).toBe(2);

  fireEvent.change(screen.getByLabelText('Quick filter TARGET pattern'), { target: { value: '2/0/0-2/0/9' } });
  expect(rowCount(container)).toBe(1);
});

test('an invalid regex in the name row falls back to a literal substring match', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const nameInput = screen.getByLabelText('Quick filter TARGET name');

  // "(" alone is an invalid regex — must not crash, matches nothing literally…
  fireEvent.change(nameInput, { target: { value: '(' } });
  expect(rowCount(container)).toBe(0);

  // …and a literal fragment of a name still matches.
  fireEvent.change(nameInput, { target: { value: 'jalousie' } });
  expect(rowCount(container)).toBe(1);
});

test('the toggle disables filtering without losing patterns; collapsing restores all rows', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const nameInput = screen.getByLabelText('Quick filter TARGET name');
  fireEvent.change(nameInput, { target: { value: 'küche' } });
  expect(rowCount(container)).toBe(1);

  // Disable via the bar's toggle — patterns stay, rows come back.
  fireEvent.click(screen.getByTitle('Disable quick filter (keeps patterns)'));
  expect(rowCount(container)).toBe(3);
  expect(screen.getByLabelText('Quick filter TARGET name')).toHaveValue('küche');

  // Re-enable — filtering resumes with the kept pattern.
  fireEvent.click(screen.getByTitle('Enable quick filter'));
  expect(rowCount(container)).toBe(1);

  // Collapse — bar gone, all rows visible again.
  fireEvent.click(screen.getByTitle('Hide quick filter bar'));
  expect(screen.queryByLabelText('Quick filter TARGET name')).not.toBeInTheDocument();
  expect(rowCount(container)).toBe(3);
});

test('filters combine across columns (AND)', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  fireEvent.change(screen.getByLabelText('Quick filter TARGET name'), { target: { value: 'licht' } });
  fireEvent.change(screen.getByLabelText('Quick filter VALUE from'), { target: { value: '0x02' } });
  expect(rowCount(container)).toBe(1);
});

test('the TYPE row matches a comma-separated list against type or direction', () => {
  const telegrams: Telegram[] = [
    makeTelegram({ simplified_type: 'Write', direction: 'Incoming' }),
    makeTelegram({ simplified_type: 'Read', direction: 'Incoming' }),
    makeTelegram({ simplified_type: 'Response', direction: 'Outgoing' }),
  ];
  const { container } = render(
    <TelegramTable
      telegrams={telegrams}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  fireEvent.change(screen.getByLabelText('Quick filter TYPE'), { target: { value: 'Write, Outgoing' } });
  expect(rowCount(container)).toBe(2); // the Write/Incoming row and the Response/Outgoing row
});

test('the TIME row restricts to a from/to range', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const boundary = localInputValue('2024-01-01T10:00:02.000Z'); // the middle telegram's own timestamp
  fireEvent.change(screen.getByLabelText('Quick filter TIME from'), { target: { value: boundary } });
  expect(rowCount(container)).toBe(2);
  fireEvent.change(screen.getByLabelText('Quick filter TIME to'), { target: { value: boundary } });
  expect(rowCount(container)).toBe(1);
});

test('ctrl/cmd-click on the DELTA TIME toggle disables/enables the window without losing the entered values (#318)', () => {
  const onDeltaContextChange = vi.fn();
  const onDeltaContextEnabledChange = vi.fn();
  render(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 500, deltaAfterMs: 250, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      onDeltaContextChange={onDeltaContextChange}
      onDeltaContextEnabledChange={onDeltaContextEnabledChange}
    />,
  );
  fireEvent.click(screen.getByTitle('Show quick filter bar'));

  // Values are shown regardless of enabled state.
  expect(screen.getByLabelText('Time-Delta-Context before (ms)')).toHaveValue(500);
  expect(screen.getByLabelText('Time-Delta-Context after (ms)')).toHaveValue(250);

  const toggleBtn = screen.getByTitle(/Time-Delta-Context:/);
  fireEvent.click(toggleBtn, { ctrlKey: true });
  expect(onDeltaContextEnabledChange).toHaveBeenCalledWith(false);

  // Editing a value while enabled still goes through onDeltaContextChange, preserving the other field.
  fireEvent.change(screen.getByLabelText('Time-Delta-Context before (ms)'), { target: { value: '750' } });
  expect(onDeltaContextChange).toHaveBeenCalledWith(750, 250);
});

test('plain click on the DELTA TIME toggle cycles the per-message flag tristate (#319)', () => {
  renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));

  // none -> all: flags every currently visible row.
  fireEvent.click(screen.getByTitle(/none messages flagged/));
  expect(screen.getByTitle(/all messages flagged/)).toBeInTheDocument();

  // all -> none: clears every flag.
  fireEvent.click(screen.getByTitle(/all messages flagged/));
  expect(screen.getByTitle(/none messages flagged/)).toBeInTheDocument();
});

test('flagging a single row reports the tristate as "some" (#319)', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  expect(screen.getByTitle(/none messages flagged/)).toBeInTheDocument();

  const row = [...container.querySelectorAll('.log-row')].find(r => r.textContent?.includes('Licht Flur'))!;
  fireEvent.click(row.querySelector('button[title*="Always show context"]')!);

  expect(screen.getByTitle(/some messages flagged/)).toBeInTheDocument();
});

test("ctrl/cmd-click on a row's flag applies its new state to every marked row (#319)", () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const rows = [...container.querySelectorAll('.log-row')];

  // Mark two rows (row-marks, #310) then ctrl-click a third row's flag.
  fireEvent.click(rows[0]);
  fireEvent.click(rows[1], { ctrlKey: true });
  const flagBtn = rows[2].querySelector('button[title*="Always show context"]')!;
  fireEvent.click(flagBtn, { ctrlKey: true });

  // All three (the two marked + the clicked one) are now flagged -> tristate is "all".
  expect(screen.getByTitle(/all messages flagged/)).toBeInTheDocument();
});
