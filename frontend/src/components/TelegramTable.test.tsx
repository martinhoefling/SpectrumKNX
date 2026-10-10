import { render, fireEvent, createEvent, screen } from '@testing-library/react';
import { expect, test, vi, beforeAll } from 'vitest';
import { TelegramTable, type SortConfig } from './TelegramTable';
import { makeTelegram } from '../test/telegramFactory';
import type { Telegram } from '../hooks/useWebSocket';
import { DEFAULT_FILTERS } from '../types/filters';
import { anchorKey } from '../utils/anchorKey';

// jsdom has no layout: give the virtualizer a viewport and rows a rect so it
// renders items and the anchor logic finds rows.
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

/** `count` telegrams sorted newest-first, 1 s apart, ending at `newestOffsetS`. */
const makeList = (count: number, newestOffsetS: number): Telegram[] => {
  const base = new Date('2024-01-01T10:00:00.000Z').getTime();
  return Array.from({ length: count }, (_, i) => {
    const t = base + (newestOffsetS - i) * 1000;
    return makeTelegram({ timestamp: new Date(t).toISOString(), raw_hex: `0x${newestOffsetS - i}` });
  });
};

const renderTable = (telegrams: Telegram[]) =>
  render(
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

const stripesByKey = (container: HTMLElement): Map<string, string> => {
  const map = new Map<string, string>();
  for (const row of container.querySelectorAll<HTMLElement>('.log-row')) {
    map.set(row.getAttribute('data-akey')!, row.style.background);
  }
  return map;
};

test('zebra stripes stay with their telegram when new ones are prepended (#266)', () => {
  const { container, rerender } = renderTable(makeList(6, 5));
  const before = stripesByKey(container);
  expect(before.size).toBeGreaterThan(2);

  // One new telegram arrives at the live edge (top, newest-first).
  rerender(
    <TelegramTable
      telegrams={makeList(7, 6)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );

  const after = stripesByKey(container);
  for (const [key, background] of before) {
    expect(after.get(key), `stripe of row ${key} must not change`).toBe(background);
  }

  // Adjacent rows still alternate.
  const rows = [...container.querySelectorAll<HTMLElement>('.log-row')];
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i].style.background).not.toBe(rows[i - 1].style.background);
  }
});

test('clicking a row pauses live-following (#266)', () => {
  const { container, rerender } = renderTable(makeList(6, 5));
  fireEvent.click(container.querySelectorAll('.log-row')[2]);

  rerender(
    <TelegramTable
      telegrams={makeList(7, 6)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );

  // Anchored away from the live edge: the jump-to-live pill appears.
  expect(screen.getByText(/1 new telegram/)).toBeInTheDocument();
});

test('newest-on-bottom: clicking a row stays anchored while the full buffer evicts (#297)', () => {
  const asc: SortConfig = [{ key: 'timestamp', direction: 'asc' }];
  // In asc view the parent hands rows oldest-first, newest at the bottom edge.
  const oldestFirst = (count: number, newestOffsetS: number) => makeList(count, newestOffsetS).slice().reverse();
  const renderAsc = (telegrams: Telegram[]) =>
    render(
      <TelegramTable
        telegrams={telegrams}
        visibleColumns={visibleColumns}
        sortConfig={asc}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
      />,
    );

  const { container, rerender } = renderAsc(oldestFirst(6, 5));
  // Click a row that is neither the oldest nor the newest, then simulate a
  // capacity eviction: one new telegram at the bottom, one dropped from the top.
  fireEvent.click(container.querySelectorAll('.log-row')[2]);
  rerender(
    <TelegramTable
      telegrams={oldestFirst(6, 6)}
      visibleColumns={visibleColumns}
      sortConfig={asc}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );

  // The list stayed anchored rather than snapping to the (bottom) live edge.
  expect(screen.getByText(/1 new telegram/)).toBeInTheDocument();
});

test('without a click the table keeps following the live edge', () => {
  renderTable(makeList(6, 5));
  const { rerender } = renderTable(makeList(6, 5));
  rerender(
    <TelegramTable
      telegrams={makeList(7, 6)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );
  expect(screen.queryByText(/new telegram/)).not.toBeInTheDocument();
});

test('multi-level sort (#311): plain click replaces, ctrl-click adds a level', () => {
  const onSort = vi.fn();
  render(
    <TelegramTable
      telegrams={makeList(3, 2)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={onSort}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );

  const sourceHeader = screen.getByText('SOURCE').closest('button')!;
  fireEvent.click(sourceHeader);
  expect(onSort).toHaveBeenLastCalledWith('source_address', { additive: false });

  fireEvent.click(sourceHeader, { ctrlKey: true });
  expect(onSort).toHaveBeenLastCalledWith('source_address', { additive: true });

  fireEvent.click(sourceHeader, { metaKey: true });
  expect(onSort).toHaveBeenLastCalledWith('source_address', { additive: true });
});

test('multi-level sort (#311): a numbered badge marks each explicit level beyond the first', () => {
  const multiSort: SortConfig = [{ key: 'source_address', direction: 'asc' }, { key: 'target_address', direction: 'desc' }];
  render(
    <TelegramTable
      telegrams={makeList(3, 2)}
      visibleColumns={visibleColumns}
      sortConfig={multiSort}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );

  const sourceHeader = screen.getByText('SOURCE').closest('button')!;
  const targetHeader = screen.getByText('TARGET').closest('button')!;
  expect(sourceHeader).toHaveTextContent('1');
  expect(targetHeader).toHaveTextContent('2');
});

test('delta column (#311): stays visible when sorted by a non-time column', () => {
  const bySource: SortConfig = [{ key: 'source_address', direction: 'asc' }];
  render(
    <TelegramTable
      telegrams={makeList(3, 2)}
      visibleColumns={visibleColumns}
      sortConfig={bySource}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );
  expect(screen.getByText('Δt')).toBeInTheDocument();
});

test('delta-sort exclusive mode (#311): activates on click, pauses live-follow, and exits on another header click', () => {
  const onListFollowChange = vi.fn();
  const { rerender } = render(
    <TelegramTable
      telegrams={makeList(6, 5)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={true}
      onListFollowChange={onListFollowChange}
    />,
  );

  fireEvent.click(screen.getByText('Δt').closest('button')!);
  expect(onListFollowChange).toHaveBeenCalledWith(false);

  // New telegrams while delta-sort is active don't reach the frozen view.
  onListFollowChange.mockClear();
  rerender(
    <TelegramTable
      telegrams={makeList(7, 6)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={false}
      onListFollowChange={onListFollowChange}
    />,
  );
  expect(screen.queryByText(/new telegram/)).not.toBeInTheDocument();

  // Clicking a real column header exits delta-sort and restores live-follow.
  fireEvent.click(screen.getByText('SOURCE').closest('button')!);
  expect(onListFollowChange).toHaveBeenLastCalledWith(true);
});

test('quick info bar (#311): toggled via the header button and summarizes the visible rows', () => {
  render(
    <TelegramTable
      telegrams={makeList(4, 3)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );

  expect(screen.queryByText(/4 telegrams/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByTitle('Show info bar'));
  expect(screen.getByText(/4 telegrams/)).toBeInTheDocument();
  expect(screen.getByText(/Oldest:/)).toBeInTheDocument();
  expect(screen.getByText(/Newest:/)).toBeInTheDocument();
});

test('quick info bar shows the busiest second as a max rate (#441)', () => {
  const at = (ts: string) => makeTelegram({ timestamp: ts, raw_hex: ts });
  render(
    <TelegramTable
      telegrams={[
        at('2024-01-01T10:00:09.000Z'),
        at('2024-01-01T10:00:05.900Z'),
        at('2024-01-01T10:00:05.300Z'),
        at('2024-01-01T10:00:05.000Z'),
        at('2024-01-01T10:00:01.000Z'),
      ]}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByTitle('Show info bar'));
  expect(screen.getByText('Max rate: 3/s')).toBeInTheDocument();
});

test('context rows (#343): marked with a distinct class/tooltip and counted in the info bar', () => {
  const rows = makeList(3, 2);
  const contextKeys = new Set([anchorKey(rows[1])]); // the middle row is context-only

  const { container } = render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      contextKeys={contextKeys}
    />,
  );

  const logRows = [...container.querySelectorAll('.log-row')];
  expect(logRows.filter(r => r.classList.contains('context'))).toHaveLength(1);
  expect(logRows.find(r => r.classList.contains('context'))).toHaveAttribute(
    'title', 'Unfiltered Time-Delta-Context — this telegram did not match the active filters'
  );

  fireEvent.click(screen.getByTitle('Show info bar'));
  expect(screen.getByText(/1 context/)).toBeInTheDocument();
});

test('context rows (#343): marking a context row hides the context styling in favor of the mark', () => {
  const rows = makeList(3, 2);
  const contextKeys = new Set([anchorKey(rows[1])]);

  const { container } = render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      contextKeys={contextKeys}
    />,
  );

  const logRows = [...container.querySelectorAll('.log-row')];
  fireEvent.click(logRows[1]); // mark the context row
  expect(logRows[1].classList.contains('marked')).toBe(true);
  expect(logRows[1].classList.contains('context')).toBe(false);
});

test('dragging a column header onto another reorders header and rows, and is remembered', () => {
  localStorage.removeItem('spectrum-knx.columnOrder');
  const props = {
    telegrams: [makeTelegram({ source_address: '1.1.7', target_address: '4/5/6' })],
    visibleColumns, sortConfig, onSort: vi.fn(), activeFilters: DEFAULT_FILTERS, onQuickFilter: vi.fn(), onQuickVisualize: vi.fn(),
  };
  const { container, unmount } = render(<TelegramTable {...props} />);
  const headers = () => Array.from(container.querySelectorAll('.header-col')).map(h => h.textContent?.trim().split(/\s/)[0]);
  const header = (label: string) => Array.from(container.querySelectorAll<HTMLElement>('.header-col')).find(h => h.textContent?.includes(label))!;
  const rowText = () => container.querySelector('.log-row')!.textContent ?? '';
  const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
  // jsdom's drag events carry no pointer position, so set it by hand.
  const drag = (type: 'dragOver' | 'drop', el: HTMLElement, clientX: number) => {
    const event = createEvent[type](el, { dataTransfer });
    Object.defineProperty(event, 'clientX', { value: clientX });
    fireEvent(el, event);
  };

  expect(headers()).toEqual(['TIME', 'Δt', 'SOURCE', 'TARGET', 'TYPE', 'DPT', 'VALUE']);
  expect(rowText().indexOf('1.1.7')).toBeLessThan(rowText().indexOf('4/5/6'));

  // jsdom rects are 1000px wide starting at 0: clientX 10 is the left half → "before".
  fireEvent.dragStart(header('TARGET'), { dataTransfer });
  drag('dragOver', header('SOURCE'), 10);
  expect(header('SOURCE').className).toContain('drop-before');
  drag('drop', header('SOURCE'), 10);

  expect(headers()).toEqual(['TIME', 'Δt', 'TARGET', 'SOURCE', 'TYPE', 'DPT', 'VALUE']);
  expect(rowText().indexOf('4/5/6')).toBeLessThan(rowText().indexOf('1.1.7'));
  expect(header('SOURCE').className).not.toContain('drop-');

  // Right half of the last column → lands after it.
  fireEvent.dragStart(header('TIME'), { dataTransfer });
  drag('dragOver', header('VALUE'), 900);
  drag('drop', header('VALUE'), 900);
  expect(headers()).toEqual(['Δt', 'TARGET', 'SOURCE', 'TYPE', 'DPT', 'VALUE', 'TIME']);

  // A fresh table (reload, or the History view) picks the order up again.
  unmount();
  const again = render(<TelegramTable {...props} />);
  expect(Array.from(again.container.querySelectorAll('.header-col')).map(h => h.textContent?.trim().split(/\s/)[0]))
    .toEqual(['Δt', 'TARGET', 'SOURCE', 'TYPE', 'DPT', 'VALUE', 'TIME']);
  localStorage.removeItem('spectrum-knx.columnOrder');
});
