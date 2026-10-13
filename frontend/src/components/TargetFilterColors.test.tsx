import { act, render, screen, fireEvent } from '@testing-library/react';
import { beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { FilterPanel } from './FilterPanel';
import { TelegramTable, type SortConfig } from './TelegramTable';
import { DEFAULT_FILTERS, type FilterOptions } from '../types/filters';
import { TARGET_COLORS, resetTargetColors, setTargetColor } from '../utils/targetColors';
import type { Telegram } from '../hooks/useWebSocket';
import { makeTelegram } from '../test/telegramFactory';

// A colour for a group address in the target filter, and its telegrams marked
// with it in the list (#509).

const OPTIONS: FilterOptions = {
  sources: [{ address: '1.1.5', name: 'Taster' }],
  targets: [
    { address: '1/2/3', name: 'Licht Küche', main: 1, sub: 1 },
    { address: '1/2/4', name: 'Licht Flur', main: 1, sub: 1 },
  ],
  types: [],
  dpts: [],
  ga_group_names: {},
  pa_line_names: {},
};
const FILTERS = { ...DEFAULT_FILTERS, sources: ['1.1.5'], targets: ['1/2/3', '1/2/4'] };

const telegram = (second: number, target: string): Telegram =>
  makeTelegram({ timestamp: `2024-01-01T10:00:0${second}.000Z`, target_address: target, raw_hex: `0x0${second}` });

const TELEGRAMS = [telegram(3, '1/2/3'), telegram(2, '1/2/4'), telegram(1, '2/0/1')];
const SORT: SortConfig = [{ key: 'timestamp', direction: 'desc' }];
const COLUMNS = {
  time: true, delta: true, source: true, sourceName: true,
  target: true, targetName: true, type: true, dpt: true, data: true, value: true,
};

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

const renderPanel = () => {
  render(<FilterPanel options={OPTIONS} activeFilters={FILTERS} onFiltersChange={vi.fn()} projectLoaded />);
  fireEvent.click(screen.getByRole('button', { name: 'Active filters' }));
};

const renderTable = (filters = FILTERS) =>
  render(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={COLUMNS}
      sortConfig={SORT}
      onSort={vi.fn()}
      activeFilters={filters}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );

const rowOf = (container: HTMLElement, target: string) =>
  [...container.querySelectorAll<HTMLElement>('.log-row')].find(r => r.textContent?.includes(target))!;

beforeEach(() => resetTargetColors());

test('each target filter has a colour swatch; clicks walk the palette', () => {
  renderPanel();
  const kitchen = screen.getByRole('button', { name: 'Colour of 1/2/3' });
  const hall = screen.getByRole('button', { name: 'Colour of 1/2/4' });
  // Source filters have none.
  expect(screen.queryByRole('button', { name: 'Colour of 1.1.5' })).not.toBeInTheDocument();
  expect(kitchen).toHaveAttribute('title', 'Mark telegrams to this address with a colour');

  fireEvent.click(kitchen);
  expect(kitchen).toHaveStyle({ background: TARGET_COLORS[0] });
  // The next address starts with a colour that is still free.
  fireEvent.click(hall);
  expect(hall).toHaveStyle({ background: TARGET_COLORS[1] });

  fireEvent.click(kitchen);
  expect(kitchen).toHaveStyle({ background: TARGET_COLORS[1] });
});

test('a click on the swatch does not switch the filter off', () => {
  const onFiltersChange = vi.fn();
  render(<FilterPanel options={OPTIONS} activeFilters={FILTERS} onFiltersChange={onFiltersChange} projectLoaded />);
  fireEvent.click(screen.getByRole('button', { name: 'Active filters' }));
  fireEvent.click(screen.getByRole('button', { name: 'Colour of 1/2/3' }));
  expect(onFiltersChange).not.toHaveBeenCalled();
});

test('telegrams to a coloured target are marked in the list', () => {
  setTargetColor('1/2/3', TARGET_COLORS[3]);
  const { container } = renderTable();

  expect(rowOf(container, '1/2/3').style.boxShadow).toContain('inset 4px 0 0 0');
  expect(rowOf(container, '1/2/3').style.boxShadow).toContain(TARGET_COLORS[3]);
  expect(rowOf(container, '1/2/4').style.boxShadow).toBe('');
  expect(rowOf(container, '2/0/1').style.boxShadow).toBe('');
});

test('the list follows a colour set while it is shown', () => {
  const { container } = renderTable();
  expect(rowOf(container, '1/2/4').style.boxShadow).toBe('');
  act(() => setTargetColor('1/2/4', TARGET_COLORS[0]));
  expect(rowOf(container, '1/2/4').style.boxShadow).toContain('inset 4px 0 0 0');
});

test('a colour only marks rows while its address is in the target filter', () => {
  setTargetColor('1/2/3', TARGET_COLORS[0]);
  const { container } = renderTable({ ...DEFAULT_FILTERS, targets: ['1/2/4'] });
  expect(rowOf(container, '1/2/3').style.boxShadow).toBe('');
});

test('a switched-off filter keeps marking its rows', () => {
  setTargetColor('1/2/3', TARGET_COLORS[0]);
  const { container } = renderTable({ ...FILTERS, disabled: ['targets:1/2/3'] });
  expect(rowOf(container, '1/2/3').style.boxShadow).toContain('inset 4px 0 0 0');
});
