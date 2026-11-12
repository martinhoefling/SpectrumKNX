import { render, fireEvent, createEvent, screen, act } from '@testing-library/react';
import { expect, test, vi, beforeAll } from 'vitest';
import { TelegramTable, type SortConfig } from './TelegramTable';
import { makeTelegram } from '../test/telegramFactory';
import type { Telegram } from '../hooks/useWebSocket';
import { DEFAULT_FILTERS } from '../types/filters';
import { anchorKey } from '../utils/anchorKey';

// jsdom has no layout: give the virtualizer a viewport and rows a rect so it
// renders items and the anchor logic finds rows. `scrollBlockSize` is the
// scrollport height; a test can shrink it before rendering.
let scrollBlockSize = 800;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(el: Element) {
      const size = { inlineSize: 1000, blockSize: el.classList.contains('log-row') ? 85 : scrollBlockSize };
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
  // @tanstack/virtual reads clientHeight, which jsdom leaves at 0.
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      if (this.classList?.contains('custom-scrollbar')) return scrollBlockSize;
      if (this.classList?.contains('log-row')) return 85;
      return 800;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return 1000; },
  });
  // Item measurement falls back to offsetHeight when no ResizeObserver entry
  // is passed. jsdom reports 0, which collapses the list and makes the
  // virtualizer's visible range land on an arbitrary index.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      if (this.classList?.contains('custom-scrollbar')) return scrollBlockSize;
      if (this.classList?.contains('log-row')) return 85;
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      if (!this.classList?.contains('custom-scrollbar')) return 0;
      // Sum virtualizer block + optional short-list spacer opposite the live edge.
      let total = 0;
      for (const child of Array.from(this.children) as HTMLElement[]) {
        const height = Number.parseFloat(child.style.height);
        if (Number.isFinite(height) && height > 0) total += height;
      }
      return total > 0 ? total : scrollBlockSize;
    },
  });
});

const visibleColumns = {
  time: true, delta: true, source: true, sourceName: true,
  target: true, targetName: true, type: true, dpt: true, data: true, value: true,
};

const sortConfig: SortConfig = [{ key: 'timestamp', direction: 'desc' }];
/** Settled live-edge scrollTop with newest-on-top (after 1/2-row fill rubber). */
const LIVE_EDGE_TOP = Math.round(85 / 2);

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
  const onListFollowChange = vi.fn();
  const { container, rerender } = render(
    <TelegramTable
      telegrams={makeList(6, 5)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow
      onListFollowChange={onListFollowChange}
    />,
  );
  fireEvent.click(container.querySelectorAll('.log-row')[2]);
  expect(onListFollowChange).toHaveBeenCalledWith(false);

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

  // The newest telegram is still on screen, so there is nothing newer to report.
  expect(screen.queryByText(/new telegram/)).not.toBeInTheDocument();
});

test('after unfollow, scroll while still at the live edge does not re-enable follow', () => {
  const onListFollowChange = vi.fn();
  const { container, rerender } = render(
    <TelegramTable
      telegrams={makeList(4, 3)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow
      onListFollowChange={onListFollowChange}
    />,
  );
  fireEvent.click(container.querySelectorAll('.log-row')[0]);
  expect(onListFollowChange).toHaveBeenCalledWith(false);
  onListFollowChange.mockClear();

  rerender(
    <TelegramTable
      telegrams={makeList(4, 3)}
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

  // Short list: still geometrically at the live edge. Scroll must not re-follow.
  const port = container.querySelector('.custom-scrollbar') as HTMLElement;
  fireEvent.scroll(port);
  expect(onListFollowChange).not.toHaveBeenCalledWith(true);
});

test('follow re-enables only after leaving the live edge and returning to it', async () => {
  const ROW = 85;
  scrollBlockSize = ROW * 2;
  const onListFollowChange = vi.fn();
  const rows = makeList(12, 11);
  const table = (follow: boolean) => (
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={follow}
      onListFollowChange={onListFollowChange}
    />
  );
  const flushFrames = () => act(() => new Promise<void>(r => {
    requestAnimationFrame(() => requestAnimationFrame(() => r()));
  }));

  try {
    const { container, rerender } = render(table(true));
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;

    // Detach via row click while still geometrically at the edge.
    fireEvent.click(container.querySelectorAll('.log-row')[1]);
    expect(onListFollowChange).toHaveBeenCalledWith(false);
    onListFollowChange.mockClear();
    rerender(table(false));

    // Scroll into history: leaves the edge zone (clears latch) but must not follow.
    port.scrollTop = ROW * 4;
    fireEvent.scroll(port);
    await flushFrames();
    expect(onListFollowChange).not.toHaveBeenCalledWith(true);

    // Further opposite of live — still no follow.
    port.scrollTop = ROW * 8;
    fireEvent.scroll(port);
    await flushFrames();
    expect(onListFollowChange).not.toHaveBeenCalledWith(true);

    // Return to the settled live edge while not paused → follow on.
    port.scrollTop = LIVE_EDGE_TOP;
    fireEvent.scroll(port);
    expect(onListFollowChange).toHaveBeenCalledWith(true);
  } finally {
    scrollBlockSize = 800;
  }
});

test('while paused at the live edge, wheel toward newer flushes and scrolls into the merged buffer', () => {
  const ROW = 85;
  scrollBlockSize = ROW * 2;
  const onListFollowChange = vi.fn();
  const onPauseFlush = vi.fn();
  const frozen = makeList(8, 7);
  const flushed = makeList(13, 12); // five newer telegrams prepended
  const props = (telegrams: Telegram[], follow: boolean, paused: boolean, pausedN: number) => (
    <TelegramTable
      telegrams={telegrams}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={follow}
      onListFollowChange={onListFollowChange}
      isPaused={paused}
      pausedCount={pausedN}
      onPauseFlush={onPauseFlush}
    />
  );

  try {
    const { container, rerender } = render(props(frozen, false, true, 5));
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    port.scrollTop = 0;
    fireEvent.scroll(port);
    onPauseFlush.mockClear();
    onListFollowChange.mockClear();

    // Newest-on-top: negative deltaY flushes; follow waits until the delta lands
    // on the live edge of the merged list.
    const deltaY = -40;
    fireEvent.wheel(port, { deltaY });
    expect(onPauseFlush).toHaveBeenCalledTimes(1);
    expect(onListFollowChange).not.toHaveBeenCalledWith(true);

    // Intermediate unpause (cache often flips isPaused before publish). Keep
    // pending delta. Simulate pin compensation, then publish the backlog —
    // scroll must continue toward newer by deltaY, not snap to the live edge.
    rerender(props(frozen, false, false, 0));
    const pinned = ROW * 5;
    port.scrollTop = pinned;
    rerender(props(flushed, false, false, 0));
    expect(port.scrollTop).toBe(pinned + deltaY);
    expect(port.scrollTop).toBeGreaterThan(0);
    expect(onListFollowChange).not.toHaveBeenCalledWith(true);

    // Wheel toward history must not flush again.
    onPauseFlush.mockClear();
    onListFollowChange.mockClear();
    fireEvent.wheel(port, { deltaY: 40 });
    expect(onPauseFlush).not.toHaveBeenCalled();
    expect(onListFollowChange).not.toHaveBeenCalledWith(true);
  } finally {
    scrollBlockSize = 800;
  }
});

test('wheel past newest at the live edge re-enables follow after unfollow', () => {
  const onListFollowChange = vi.fn();
  const { container, rerender } = render(
    <TelegramTable
      telegrams={makeList(4, 3)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow
      onListFollowChange={onListFollowChange}
    />,
  );
  fireEvent.click(container.querySelectorAll('.log-row')[0]);
  expect(onListFollowChange).toHaveBeenCalledWith(false);
  onListFollowChange.mockClear();

  rerender(
    <TelegramTable
      telegrams={makeList(4, 3)}
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

  const port = container.querySelector('.custom-scrollbar') as HTMLElement;
  port.scrollTop = 0;
  fireEvent.scroll(port);
  expect(onListFollowChange).not.toHaveBeenCalledWith(true);

  // Still latched at newest: passive scroll stays unfollowed, wheel past enables.
  fireEvent.wheel(port, { deltaY: -40 });
  expect(onListFollowChange).toHaveBeenCalledWith(true);
});

test('wheel toward newer does not enable follow while No data available is showing', () => {
  const onListFollowChange = vi.fn();
  const onPauseFlush = vi.fn();
  const { container } = render(
    <TelegramTable
      telegrams={[]}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={false}
      onListFollowChange={onListFollowChange}
      isPaused
      pausedCount={3}
      onPauseFlush={onPauseFlush}
    />,
  );
  expect(screen.getByText('No data available.')).toBeInTheDocument();

  const port = container.querySelector('.custom-scrollbar') as HTMLElement;
  fireEvent.wheel(port, { deltaY: -40 });
  expect(onListFollowChange).not.toHaveBeenCalledWith(true);
  expect(onPauseFlush).not.toHaveBeenCalled();
});

test('while paused, scroll against fill axis never flushes; along-fill wheel flushes without jump', async () => {
  const ROW = 85;
  scrollBlockSize = ROW * 2;
  const onListFollowChange = vi.fn();
  const onPauseFlush = vi.fn();
  const frozen = makeList(12, 11);
  const flushed = makeList(16, 15); // four newer prepended
  const table = (
    telegrams: Telegram[],
    follow: boolean,
    paused: boolean,
    pausedN: number,
  ) => (
    <TelegramTable
      telegrams={telegrams}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={follow}
      onListFollowChange={onListFollowChange}
      isPaused={paused}
      pausedCount={pausedN}
      onPauseFlush={onPauseFlush}
    />
  );
  const flushFrames = () => act(() => new Promise<void>(r => {
    requestAnimationFrame(() => requestAnimationFrame(() => r()));
  }));

  try {
    const { container, rerender } = render(table(frozen, true, false, 0));
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;

    fireEvent.click(container.querySelectorAll('.log-row')[1]);
    expect(onListFollowChange).toHaveBeenCalledWith(false);
    onListFollowChange.mockClear();
    rerender(table(frozen, false, true, 4));

    // Against fill (toward older): scroll events must never flush.
    port.scrollTop = ROW * 4;
    fireEvent.scroll(port);
    await flushFrames();
    port.scrollTop = ROW * 8;
    fireEvent.scroll(port);
    await flushFrames();
    expect(onPauseFlush).not.toHaveBeenCalled();
    expect(onListFollowChange).not.toHaveBeenCalledWith(true);

    // Passive return to the frozen edge still must not flush (no fill-axis gesture).
    // Auto-follow may arm from newest visibility (not manual pause) — that is
    // separate from flush, which stays fill-axis-only.
    port.scrollTop = 0;
    fireEvent.scroll(port);
    expect(onPauseFlush).not.toHaveBeenCalled();
    onListFollowChange.mockClear();

    // Along fill (toward live edge / newer): wheel flushes; flush path must not
    // itself claim follow (seamless pin + delta instead of edge snap).
    const deltaY = -40;
    fireEvent.wheel(port, { deltaY });
    expect(onPauseFlush).toHaveBeenCalledTimes(1);
    expect(onListFollowChange).not.toHaveBeenCalledWith(true);

    // Intermediate unpause, simulate pin compensation, then publish — must not
    // scrollToEdge; gesture delta continues into the merged backlog.
    rerender(table(frozen, false, false, 0));
    const pinned = ROW * 4;
    port.scrollTop = pinned;
    rerender(table(flushed, false, false, 0));
    expect(port.scrollTop).toBe(pinned + deltaY);
    expect(port.scrollTop).toBeGreaterThan(0);
  } finally {
    scrollBlockSize = 800;
  }
});

test('newer-pill shows paused backlog even while live-follow is on', () => {
  const rows = makeList(6, 5);
  render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={true}
      onListFollowChange={vi.fn()}
      isPaused
      pausedCount={7}
    />,
  );
  expect(screen.getByRole('button', { name: '7 newer telegrams' })).toBeInTheDocument();
});

test('jump-to-live pill re-enables follow without leaving the edge first', () => {
  const onListFollowChange = vi.fn();
  const onJumpToLive = vi.fn();
  const ROW = 85;
  scrollBlockSize = ROW * 2;
  const rows = makeList(10, 9);

  try {
    const { container, rerender } = render(
      <TelegramTable
        telegrams={rows}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
        listFollow={false}
        onListFollowChange={onListFollowChange}
        onJumpToLive={onJumpToLive}
      />,
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    port.scrollTop = ROW * 3;
    fireEvent.scroll(port);
    onListFollowChange.mockClear();

    rerender(
      <TelegramTable
        telegrams={rows}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
        listFollow={false}
        onListFollowChange={onListFollowChange}
        onJumpToLive={onJumpToLive}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /newer telegram/ }));
    expect(onListFollowChange).toHaveBeenCalledWith(true);
    expect(onJumpToLive).toHaveBeenCalledTimes(1);
  } finally {
    scrollBlockSize = 800;
  }
});

test('jump-to-live pill flushes pause buffer and lands on the merged newest', () => {
  const ROW = 85;
  scrollBlockSize = ROW * 2;
  const onListFollowChange = vi.fn();
  const onJumpToLive = vi.fn();
  const frozen = makeList(10, 9);
  const flushed = makeList(14, 13);
  const props = (
    telegrams: Telegram[],
    follow: boolean,
    paused: boolean,
    pausedN: number,
  ) => (
    <TelegramTable
      telegrams={telegrams}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={follow}
      onListFollowChange={onListFollowChange}
      isPaused={paused}
      isManualPause={paused}
      pausedCount={pausedN}
      onJumpToLive={onJumpToLive}
    />
  );

  try {
    const { container, rerender } = render(props(frozen, false, true, 4));
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    port.scrollTop = ROW * 3;
    fireEvent.scroll(port);

    fireEvent.click(screen.getByRole('button', { name: /newer telegram/ }));
    expect(onJumpToLive).toHaveBeenCalledTimes(1);
    expect(onListFollowChange).toHaveBeenCalledWith(true);

    // Simulate App resume: playing + follow, then publish the merged backlog.
    rerender(props(frozen, true, false, 0));
    rerender(props(flushed, true, false, 0));
    expect(port.scrollTop).toBe(LIVE_EDGE_TOP);
  } finally {
    scrollBlockSize = 800;
  }
});

test('Play-style unpause keeps the scroll viewport pinned after flush publish', () => {
  const ROW = 85;
  scrollBlockSize = ROW * 2;
  const frozen = makeList(10, 9);
  const flushed = makeList(14, 13);
  const props = (telegrams: Telegram[], paused: boolean) => (
    <TelegramTable
      telegrams={telegrams}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={false}
      onListFollowChange={vi.fn()}
      listAnchorKey={anchorKey(frozen[3])}
      isPaused={paused}
      pausedCount={paused ? 4 : 0}
    />
  );

  try {
    const { container, rerender } = render(props(frozen, true));
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    port.scrollTop = ROW * 3;
    fireEvent.scroll(port);
    const before = port.scrollTop;

    // Manual Play: unpause + publish without pill jump.
    rerender(props(frozen, false));
    rerender(props(flushed, false));
    expect(port.scrollTop).toBe(before);
    expect(port.scrollTop).toBeGreaterThan(0);
  } finally {
    scrollBlockSize = 800;
  }
});

test('manual pause does not auto-enable follow when newest is fully visible', () => {
  const onListFollowChange = vi.fn();
  const { container } = render(
    <TelegramTable
      telegrams={makeList(6, 5)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={false}
      onListFollowChange={onListFollowChange}
      isPaused
      isManualPause
      pausedCount={3}
    />,
  );
  const port = container.querySelector('.custom-scrollbar') as HTMLElement;
  port.scrollTop = 0;
  fireEvent.scroll(port);
  expect(onListFollowChange).not.toHaveBeenCalledWith(true);
  expect(screen.getByRole('button', { name: '3 newer telegrams' })).toBeInTheDocument();
});

test('fill-spacer pause labels only when manually paused and fill rubber fully visible', () => {
  const { container, rerender } = render(
    <TelegramTable
      telegrams={makeList(4, 3)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      isPaused
      isManualPause
    />,
  );
  const port = container.querySelector('.custom-scrollbar') as HTMLElement;

  // Fully into fill rubber → labels on.
  act(() => {
    port.scrollTop = 0;
    fireEvent.scroll(port);
  });
  const left = screen.getByTestId('fill-rubber-pause-label-left');
  const right = screen.getByTestId('fill-rubber-pause-label-right');
  expect(left).toHaveTextContent('...paused manually...');
  expect(right).toHaveTextContent('...paused manually...');
  expect(left).toHaveClass('fill-rubber-pause-label');
  expect(right).toHaveClass('fill-rubber-pause-label');

  // Another toward-newer wheel at the hard stop remounts labels (restart fade).
  act(() => {
    fireEvent.wheel(port, { deltaY: -40 });
  });
  const leftAfterWheel = screen.getByTestId('fill-rubber-pause-label-left');
  expect(leftAfterWheel).toBeInTheDocument();
  expect(leftAfterWheel).not.toBe(left);

  // Overlay scrollbar thumb drag further into fill at the hard stop remounts too.
  const thumb = screen.getByTestId('list-scrollbar-thumb');
  act(() => {
    fireEvent.pointerDown(thumb, { pointerId: 1, clientY: 80 });
    fireEvent.pointerMove(thumb, { pointerId: 1, clientY: 40 });
  });
  const leftAfterSb = screen.getByTestId('fill-rubber-pause-label-left');
  expect(leftAfterSb).toBeInTheDocument();
  expect(leftAfterSb).not.toBe(leftAfterWheel);
  act(() => {
    fireEvent.pointerUp(thumb, { pointerId: 1, clientY: 40 });
  });

  // Settled live edge → fill spacer scrolled away → no labels.
  act(() => {
    port.scrollTop = LIVE_EDGE_TOP;
    fireEvent.scroll(port);
  });
  expect(screen.queryByTestId('fill-rubber-pause-label-left')).not.toBeInTheDocument();
  expect(screen.queryByTestId('fill-rubber-pause-label-right')).not.toBeInTheDocument();

  // Re-enter fill rubber → labels return (fade restarts via rising edge).
  act(() => {
    port.scrollTop = 0;
    fireEvent.scroll(port);
  });
  expect(screen.getByTestId('fill-rubber-pause-label-left')).toBeInTheDocument();

  // Auto-pause at full fill → still no labels.
  rerender(
    <TelegramTable
      telegrams={makeList(4, 3)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      isPaused
      isManualPause={false}
    />,
  );
  act(() => {
    port.scrollTop = 0;
    fireEvent.scroll(port);
  });
  expect(screen.queryByTestId('fill-rubber-pause-label-left')).not.toBeInTheDocument();
});

test('newest-on-bottom: clicking a row stays anchored while the full buffer evicts (#297)', () => {
  const asc: SortConfig = [{ key: 'timestamp', direction: 'asc' }];
  // In asc view the parent hands rows oldest-first, newest at the bottom edge.
  const oldestFirst = (count: number, newestOffsetS: number) => makeList(count, newestOffsetS).slice().reverse();

  const onListFollowChange = vi.fn();
  const { container, rerender } = render(
    <TelegramTable
      telegrams={oldestFirst(6, 5)}
      visibleColumns={visibleColumns}
      sortConfig={asc}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow
      onListFollowChange={onListFollowChange}
    />,
  );
  // Click a row that is neither the oldest nor the newest, then simulate a
  // capacity eviction: one new telegram at the bottom, one dropped from the top.
  fireEvent.click(container.querySelectorAll('.log-row')[2]);
  expect(onListFollowChange).toHaveBeenCalledWith(false);
  rerender(
    <TelegramTable
      telegrams={oldestFirst(6, 6)}
      visibleColumns={visibleColumns}
      sortConfig={asc}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={false}
      onListFollowChange={onListFollowChange}
    />,
  );

  // Every row still fits, including the newest, so the pill stays hidden.
  expect(screen.queryByText(/new telegram/)).not.toBeInTheDocument();
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

test('jump pill counts telegrams newer than the newest one on screen, for both time directions', () => {
  const ROW = 85;
  scrollBlockSize = ROW * 2;
  const table = (telegrams: Telegram[], sort: SortConfig, follow: boolean, anchor: string | null = null) => (
    <TelegramTable
      telegrams={telegrams}
      visibleColumns={visibleColumns}
      sortConfig={sort}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={follow}
      onListFollowChange={vi.fn()}
      listAnchorKey={anchor}
      onListAnchorKeyChange={vi.fn()}
    />
  );

  const scrollTo = (container: HTMLElement, top: number) => {
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    port.scrollTop = top;
    fireEvent.scroll(port);
  };

  try {
    const rows = makeList(10, 9);
    // Newest first and still following: the newest row is on screen, so no pill.
    const live = render(table(rows, sortConfig, true));
    expect(screen.queryByText(/new telegram/)).not.toBeInTheDocument();
    live.unmount();

    // Scrolled so the fourth row is the newest one on screen: three are newer.
    // scrollTop is measured past the fill-rubber padding (settled edge = LIVE_EDGE_TOP).
    const three = render(table(rows, sortConfig, false));
    scrollTo(three.container, LIVE_EDGE_TOP + ROW * 3);
    expect(screen.getByRole('button', { name: '3 newer telegrams' })).toBeInTheDocument();
    three.unmount();

    // One newer telegram keeps the singular form.
    const one = render(table(rows, sortConfig, false));
    scrollTo(one.container, LIVE_EDGE_TOP + ROW);
    expect(screen.getByRole('button', { name: '1 newer telegram' })).toBeInTheDocument();
    one.unmount();

    // Oldest first. The viewport holds the two oldest rows, so eight are newer.
    const asc: SortConfig = [{ key: 'timestamp', direction: 'asc' }];
    const ascRows = rows.slice().reverse();
    const view = render(table(ascRows, asc, false));
    scrollTo(view.container, 0);
    expect(screen.getByRole('button', { name: '8 newer telegrams' })).toBeInTheDocument();

    // Live mode hides the pill even while those newer rows are off screen.
    view.rerender(table(ascRows, asc, true));
    expect(screen.queryByText(/new telegram/)).not.toBeInTheDocument();
  } finally {
    scrollBlockSize = 800;
  }
});

test('empty list drops sticky newer-pill; pausedCount alone still shows', () => {
  const rows = makeList(6, 5);
  const { rerender } = render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={false}
      onListFollowChange={vi.fn()}
      isPaused
      pausedCount={4}
    />,
  );
  expect(screen.getByRole('button', { name: /newer telegram/ })).toBeInTheDocument();

  // Buffer cleared: no rows, no paused backlog — sticky must not keep the pill.
  rerender(
    <TelegramTable
      telegrams={[]}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={false}
      onListFollowChange={vi.fn()}
      isPaused
      pausedCount={0}
    />,
  );
  expect(screen.queryByRole('button', { name: /newer telegram/ })).not.toBeInTheDocument();

  // Real unpublished arrivals after clear may still drive the pill.
  rerender(
    <TelegramTable
      telegrams={[]}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={false}
      onListFollowChange={vi.fn()}
      isPaused
      pausedCount={2}
    />,
  );
  expect(screen.getByRole('button', { name: '2 newer telegrams' })).toBeInTheDocument();
});

test('jump pill adds pausedCount while the buffer snapshot is frozen', () => {
  const ROW = 85;
  scrollBlockSize = ROW * 2;
  const rows = makeList(10, 9);
  const scrollTo = (container: HTMLElement, top: number) => {
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    port.scrollTop = top;
    fireEvent.scroll(port);
  };

  try {
    const { container, rerender } = render(
      <TelegramTable
        telegrams={rows}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
        listFollow={false}
        onListFollowChange={vi.fn()}
        isPaused
        pausedCount={5}
      />,
    );
    // Three visible newer + five frozen arrivals (settled edge has no backlog pad).
    scrollTo(container, LIVE_EDGE_TOP + ROW * 3);
    expect(screen.getByRole('button', { name: '8 newer telegrams' })).toBeInTheDocument();

    // pausedCount is always folded (0 once the cache has flushed); a stale
    // non-zero pausedCount still counts so the pill does not dip during flush.
    rerender(
      <TelegramTable
        telegrams={rows}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
        listFollow={false}
        onListFollowChange={vi.fn()}
        isPaused={false}
        pausedCount={5}
      />,
    );
    expect(screen.getByRole('button', { name: '8 newer telegrams' })).toBeInTheDocument();

    rerender(
      <TelegramTable
        telegrams={rows}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
        listFollow={false}
        onListFollowChange={vi.fn()}
        isPaused={false}
        pausedCount={0}
      />,
    );
    // Backlog padding gone; settle at fill-rubber + three published newer rows.
    scrollTo(container, LIVE_EDGE_TOP + ROW * 3);
    expect(screen.getByRole('button', { name: '3 newer telegrams' })).toBeInTheDocument();

    // pausedCount alone (no scrolled newer rows) still shows the pill when paused.
    rerender(
      <TelegramTable
        telegrams={rows}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
        listFollow={false}
        onListFollowChange={vi.fn()}
        listAnchorKey={anchorKey(rows[0])}
        isPaused
        pausedCount={2}
      />,
    );
    scrollTo(container, 0);
    expect(screen.getByRole('button', { name: '2 newer telegrams' })).toBeInTheDocument();
  } finally {
    scrollBlockSize = 800;
  }
});

test('pause-buffer flush keeps the newer-telegrams pill visible across the flush gap', () => {
  const ROW = 85;
  scrollBlockSize = ROW * 2;
  const frozen = makeList(10, 9);
  const flushed = makeList(14, 13); // four newer telegrams prepended
  const props = (telegrams: Telegram[], paused: boolean, pausedN: number) => (
    <TelegramTable
      telegrams={telegrams}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={false}
      onListFollowChange={vi.fn()}
      listAnchorKey={anchorKey(frozen[0])}
      isPaused={paused}
      pausedCount={pausedN}
    />
  );

  try {
    const { container, rerender } = render(props(frozen, true, 4));
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    // At the frozen live edge the pill is driven only by pausedCount.
    port.scrollTop = 0;
    fireEvent.scroll(port);
    expect(screen.getByRole('button', { name: '4 newer telegrams' })).toBeInTheDocument();

    // Intermediate flush frame: isPaused false, pausedCount cleared, rows not
    // published yet — newerCount is 0 at the frozen edge; pill must stay.
    rerender(props(frozen, false, 0));
    expect(screen.getByRole('button', { name: /newer telegram/ })).toBeInTheDocument();

    // Published backlog while still scrolled off the new live edge — pill stays.
    port.scrollTop = ROW * 3;
    fireEvent.scroll(port);
    rerender(props(flushed, false, 0));
    expect(screen.getByRole('button', { name: /newer telegram/ })).toBeInTheDocument();
  } finally {
    scrollBlockSize = 800;
  }
});

test('at the newest telegram after flush the newer-pill is gone even without live-follow', () => {
  const ROW = 85;
  scrollBlockSize = ROW * 2;
  const frozen = makeList(10, 9);
  const flushed = makeList(14, 13);
  const props = (telegrams: Telegram[], paused: boolean, pausedN: number) => (
    <TelegramTable
      telegrams={telegrams}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={false}
      onListFollowChange={vi.fn()}
      isPaused={paused}
      pausedCount={pausedN}
    />
  );

  try {
    const { container, rerender } = render(props(frozen, true, 4));
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    port.scrollTop = 0;
    fireEvent.scroll(port);
    expect(screen.getByRole('button', { name: /newer telegram/ })).toBeInTheDocument();

    // Flush gap then settle at the live edge of the published list.
    rerender(props(frozen, false, 0));
    rerender(props(flushed, false, 0));
    port.scrollTop = 0;
    fireEvent.scroll(port);
    expect(screen.queryByRole('button', { name: /newer telegram/ })).not.toBeInTheDocument();
  } finally {
    scrollBlockSize = 800;
  }
});

test('pause-buffer flush keeps the scroll position when not at the live edge', () => {
  const ROW = 85;
  scrollBlockSize = ROW * 2;
  const frozen = makeList(10, 9);
  const flushed = makeList(14, 13);
  const props = (telegrams: Telegram[], paused: boolean) => (
    <TelegramTable
      telegrams={telegrams}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={false}
      onListFollowChange={vi.fn()}
      listAnchorKey={anchorKey(frozen[3])}
      isPaused={paused}
      pausedCount={paused ? 4 : 0}
    />
  );

  try {
    const { container, rerender } = render(props(frozen, true));
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    port.scrollTop = ROW * 3;
    fireEvent.scroll(port);
    const before = port.scrollTop;
    rerender(props(flushed, false));
    expect(port.scrollTop).toBe(before);
    expect(port.scrollTop).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /newer telegram/ })).toBeInTheDocument();
  } finally {
    scrollBlockSize = 800;
  }
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

test('short list N>1 gets spacer travel so the live edge can be left', () => {
  scrollBlockSize = 800;
  try {
    const { container } = render(
      <TelegramTable
        telegrams={makeList(3, 2)}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
      />,
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    // Settle pad keeps ≥1 row; opposite rubber adds another LIVE_EDGE_TOP overscroll.
    const rowsHeight = 3 * 85;
    expect(port.scrollHeight).toBeGreaterThan(port.clientHeight);
    expect(port.scrollHeight - port.clientHeight).toBe(
      LIVE_EDGE_TOP + rowsHeight - 85 + LIVE_EDGE_TOP,
    );
    // Settled travel away from the live edge (excluding opposite rubber).
    expect(port.scrollHeight - port.clientHeight - 2 * LIVE_EDGE_TOP).toBe(rowsHeight - 85);

    port.scrollTop = LIVE_EDGE_TOP + 85;
    fireEvent.scroll(port);
    expect(port.scrollTop).toBe(LIVE_EDGE_TOP + 85);
  } finally {
    scrollBlockSize = 800;
  }
});

test('against-fill wheel never flushes pause backlog; along-fill does (short list)', () => {
  scrollBlockSize = 800;
  const onPauseFlush = vi.fn();
  const onListFollowChange = vi.fn();
  try {
    const { container } = render(
      <TelegramTable
        telegrams={makeList(3, 2)}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
        listFollow={false}
        onListFollowChange={onListFollowChange}
        isPaused
        pausedCount={4}
        onPauseFlush={onPauseFlush}
      />,
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    port.scrollTop = 0;
    fireEvent.scroll(port);

    // Against fill (newest-on-top → positive deltaY / older).
    fireEvent.wheel(port, { deltaY: 40 });
    expect(onPauseFlush).not.toHaveBeenCalled();

    // Along fill (toward live edge / newer).
    fireEvent.wheel(port, { deltaY: -40 });
    expect(onPauseFlush).toHaveBeenCalledTimes(1);
    expect(onListFollowChange).not.toHaveBeenCalledWith(true);
  } finally {
    scrollBlockSize = 800;
  }
});

test('along-fill flush on ascending live edge stays seamless (no edge snap)', () => {
  const ROW = 85;
  scrollBlockSize = ROW * 2;
  const onPauseFlush = vi.fn();
  const onListFollowChange = vi.fn();
  const asc: SortConfig = [{ key: 'timestamp', direction: 'asc' }];
  // Ascending: oldest first, live edge at bottom — toward newer is +deltaY.
  const frozen = [...makeList(8, 7)].reverse();
  const flushed = [...makeList(13, 12)].reverse();
  const props = (telegrams: Telegram[], paused: boolean, pausedN: number) => (
    <TelegramTable
      telegrams={telegrams}
      visibleColumns={visibleColumns}
      sortConfig={asc}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={false}
      onListFollowChange={onListFollowChange}
      isPaused={paused}
      pausedCount={pausedN}
      onPauseFlush={onPauseFlush}
    />
  );

  try {
    const { container, rerender } = render(props(frozen, true, 5));
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    // Sit at settled bottom live edge (not into the fill rubber).
    const max = Math.max(0, port.scrollHeight - port.clientHeight);
    port.scrollTop = Math.max(0, max - LIVE_EDGE_TOP);
    fireEvent.scroll(port);

    fireEvent.wheel(port, { deltaY: -40 }); // against fill (toward older)
    expect(onPauseFlush).not.toHaveBeenCalled();

    const deltaY = 40;
    fireEvent.wheel(port, { deltaY });
    expect(onPauseFlush).toHaveBeenCalledTimes(1);

    rerender(props(frozen, false, 0));
    const pinned = ROW * 3;
    port.scrollTop = pinned;
    rerender(props(flushed, false, 0));
    expect(port.scrollTop).toBe(pinned + deltaY);
    expect(onListFollowChange).not.toHaveBeenCalledWith(true);
  } finally {
    scrollBlockSize = 800;
  }
});

test('short list: stepwise along-fill scroll does not re-follow until at live edge', () => {
  scrollBlockSize = 800;
  const onListFollowChange = vi.fn();
  try {
    const { container, rerender } = render(
      <TelegramTable
        telegrams={makeList(4, 3)}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
        listFollow
        onListFollowChange={onListFollowChange}
      />,
    );
    fireEvent.click(container.querySelectorAll('.log-row')[0]);
    expect(onListFollowChange).toHaveBeenCalledWith(false);
    onListFollowChange.mockClear();

    rerender(
      <TelegramTable
        telegrams={makeList(4, 3)}
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
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    const maxAway = port.scrollHeight - port.clientHeight - LIVE_EDGE_TOP;
    expect(maxAway).toBeGreaterThanOrEqual(85);

    // Leave the settled live edge using against-fill travel into the spacer.
    port.scrollTop = LIVE_EDGE_TOP + 85;
    fireEvent.scroll(port);
    port.scrollTop = LIVE_EDGE_TOP + maxAway;
    fireEvent.scroll(port);
    expect(onListFollowChange).not.toHaveBeenCalledWith(true);

    // Step back toward newer without jumping to follow until at the edge.
    port.scrollTop = LIVE_EDGE_TOP + 85;
    fireEvent.scroll(port);
    expect(onListFollowChange).not.toHaveBeenCalledWith(true);
    expect(port.scrollTop).toBe(LIVE_EDGE_TOP + 85);

    fireEvent.wheel(port, { deltaY: -40 });
    // Still away from edge — native scroll / engage no-ops until checkAtEdge.
    expect(onListFollowChange).not.toHaveBeenCalledWith(true);
  } finally {
    scrollBlockSize = 800;
  }
});

test('settled live edge does not show a phantom newer-pill from fill rubber', async () => {
  scrollBlockSize = 800;
  const flushFrames = () => act(() => new Promise<void>(r => {
    requestAnimationFrame(() => requestAnimationFrame(() => r()));
  }));
  try {
    const { container } = render(
      <TelegramTable
        telegrams={makeList(6, 5)}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
        listFollow={false}
        onListFollowChange={vi.fn()}
      />,
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    await flushFrames();
    port.scrollTop = LIVE_EDGE_TOP;
    fireEvent.scroll(port);
    await flushFrames();
    expect(screen.queryByRole('button', { name: /newer telegram/ })).not.toBeInTheDocument();
  } finally {
    scrollBlockSize = 800;
  }
});

test('opposite rubber spacer overscroll animates back to the settled opposite edge', async () => {
  scrollBlockSize = 800;
  const flushFrames = () => act(() => new Promise<void>(r => {
    requestAnimationFrame(() => requestAnimationFrame(() => r()));
  }));
  try {
    const { container } = render(
      <TelegramTable
        telegrams={makeList(3, 2)}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
        listFollow={false}
        onListFollowChange={vi.fn()}
      />,
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    await flushFrames();

    const max = port.scrollHeight - port.clientHeight;
    const settledOpposite = max - LIVE_EDGE_TOP;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      port.scrollTop = max; // deep into opposite rubber
      fireEvent.scroll(port);
      fireEvent.wheel(port, { deltaY: 40 });

      await act(async () => {
        vi.advanceTimersByTime(90);
      });
      await act(async () => {
        vi.advanceTimersByTime(180);
      });

      expect(port.scrollTop).toBe(settledOpposite);
    } finally {
      vi.useRealTimers();
    }
  } finally {
    scrollBlockSize = 800;
  }
});

test('opposite rubber finishes while paused even if pause-flush is armed', async () => {
  scrollBlockSize = 800;
  const flushFrames = () => act(() => new Promise<void>(r => {
    requestAnimationFrame(() => requestAnimationFrame(() => r()));
  }));
  const onPauseFlush = vi.fn();
  try {
    const { container, rerender } = render(
      <TelegramTable
        telegrams={makeList(3, 2)}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
        listFollow={false}
        onListFollowChange={vi.fn()}
        isPaused
        pausedCount={4}
        onPauseFlush={onPauseFlush}
      />,
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    await flushFrames();

    const max = port.scrollHeight - port.clientHeight;
    const settledOpposite = max - LIVE_EDGE_TOP;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      port.scrollTop = max;
      fireEvent.scroll(port);
      fireEvent.wheel(port, { deltaY: 40 });
      await act(async () => {
        vi.advanceTimersByTime(90);
      });

      // Pause-flush merge must not abort opposite rubber.
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
          onListFollowChange={vi.fn()}
          isPaused={false}
          pausedCount={0}
          onPauseFlush={onPauseFlush}
        />,
      );

      await act(async () => {
        vi.advanceTimersByTime(180);
      });
      expect(port.scrollTop).toBe(settledOpposite);
    } finally {
      vi.useRealTimers();
    }
  } finally {
    scrollBlockSize = 800;
  }
});

test('live prepend during fill rubber does not retarget spacer or animation', async () => {
  scrollBlockSize = 800;
  const flushFrames = () => act(() => new Promise<void>(r => {
    requestAnimationFrame(() => requestAnimationFrame(() => r()));
  }));
  try {
    const { container, rerender } = render(
      <TelegramTable
        telegrams={makeList(4, 3)}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
        listFollow={false}
        onListFollowChange={vi.fn()}
      />,
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    await flushFrames();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      port.scrollTop = 0;
      fireEvent.scroll(port);
      fireEvent.wheel(port, { deltaY: -40 });
      await act(async () => {
        vi.advanceTimersByTime(90); // start rubber toward settled edge
      });
      const mid = port.scrollTop;

      rerender(
        <TelegramTable
          telegrams={makeList(5, 4)}
          visibleColumns={visibleColumns}
          sortConfig={sortConfig}
          onSort={vi.fn()}
          activeFilters={DEFAULT_FILTERS}
          onQuickFilter={vi.fn()}
          onQuickVisualize={vi.fn()}
          listFollow={false}
          onListFollowChange={vi.fn()}
        />,
      );

      // Prepend must not snap away from the in-flight rubber path.
      expect(Math.abs(port.scrollTop - mid)).toBeLessThan(2);

      await act(async () => {
        vi.advanceTimersByTime(180);
      });
      expect(port.scrollTop).toBe(LIVE_EDGE_TOP);
    } finally {
      vi.useRealTimers();
    }
  } finally {
    scrollBlockSize = 800;
  }
});

const oppositeSpacerEl = (port: HTMLElement) =>
  Array.from(port.children).find(
    (el) => (el as HTMLElement).getAttribute('aria-hidden') === 'true',
  ) as HTMLElement | undefined;

test('live prepend during opposite rubber keeps spacer and finishes at opposite settle', async () => {
  scrollBlockSize = 800;
  const flushFrames = () => act(() => new Promise<void>(r => {
    requestAnimationFrame(() => requestAnimationFrame(() => r()));
  }));
  try {
    // 8 rows: still short (settle pad > 0). 9th row would collapse settle pad without lock.
    const { container, rerender } = render(
      <TelegramTable
        telegrams={makeList(8, 7)}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
        listFollow={false}
        onListFollowChange={vi.fn()}
      />,
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    await flushFrames();

    const spacerBefore = oppositeSpacerEl(port);
    expect(spacerBefore).toBeTruthy();
    const spacerHeightBefore = Number.parseFloat(spacerBefore!.style.height);
    expect(spacerHeightBefore).toBeGreaterThan(LIVE_EDGE_TOP);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const max = port.scrollHeight - port.clientHeight;
      const settledOpposite = max - LIVE_EDGE_TOP;
      port.scrollTop = max;
      fireEvent.scroll(port);
      fireEvent.wheel(port, { deltaY: 40 });
      await act(async () => {
        vi.advanceTimersByTime(90); // start opposite rubber-band
      });
      const mid = port.scrollTop;

      rerender(
        <TelegramTable
          telegrams={makeList(9, 8)}
          visibleColumns={visibleColumns}
          sortConfig={sortConfig}
          onSort={vi.fn()}
          activeFilters={DEFAULT_FILTERS}
          onQuickFilter={vi.fn()}
          onQuickVisualize={vi.fn()}
          listFollow={false}
          onListFollowChange={vi.fn()}
        />,
      );

      const spacerAfter = oppositeSpacerEl(port);
      expect(Number.parseFloat(spacerAfter!.style.height)).toBe(spacerHeightBefore);
      expect(Math.abs(port.scrollTop - mid)).toBeLessThan(2);
      expect(port.scrollTop).not.toBe(LIVE_EDGE_TOP);

      await act(async () => {
        vi.advanceTimersByTime(180);
      });
      expect(port.scrollTop).toBe(settledOpposite);
    } finally {
      vi.useRealTimers();
    }
  } finally {
    scrollBlockSize = 800;
  }
});

test('live prepend while held in fill rubber does not snap to settled edge', async () => {
  scrollBlockSize = 800;
  const flushFrames = () => act(() => new Promise<void>(r => {
    requestAnimationFrame(() => requestAnimationFrame(() => r()));
  }));
  try {
    const { container, rerender } = render(
      <TelegramTable
        telegrams={makeList(4, 3)}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
        listFollow={true}
        onListFollowChange={vi.fn()}
      />,
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    await flushFrames();

    // Hold in fill rubber without starting the rubber-band animation.
    port.scrollTop = 0;
    fireEvent.scroll(port);
    expect(port.scrollTop).toBe(0);

    rerender(
      <TelegramTable
        telegrams={makeList(5, 4)}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
        listFollow={true}
        onListFollowChange={vi.fn()}
      />,
    );

    expect(port.scrollTop).toBe(0);
    expect(port.scrollTop).not.toBe(LIVE_EDGE_TOP);
  } finally {
    scrollBlockSize = 800;
  }
});

test('fill-axis rubber spacer overscroll animates back to the edge telegram', async () => {
  scrollBlockSize = 800;
  const flushFrames = () => act(() => new Promise<void>(r => {
    requestAnimationFrame(() => requestAnimationFrame(() => r()));
  }));
  try {
    const { container } = render(
      <TelegramTable
        telegrams={makeList(4, 3)}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
        listFollow={false}
        onListFollowChange={vi.fn()}
      />,
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    // Fill rubber is virtualizer padding — settled edge still sits one row in.
    expect(port.scrollHeight - port.clientHeight).toBeGreaterThanOrEqual(LIVE_EDGE_TOP);
    await flushFrames();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      // Overscroll into the fill rubber, then along-fill wheel schedules rubber-band.
      port.scrollTop = 0;
      fireEvent.scroll(port);
      fireEvent.wheel(port, { deltaY: -40 });
      expect(port.scrollTop).toBe(0);

      await act(async () => {
        vi.advanceTimersByTime(90); // debounce → start rubber-band
      });
      await act(async () => {
        vi.advanceTimersByTime(180); // settle timer → edge telegram
      });

      expect(port.scrollTop).toBe(LIVE_EDGE_TOP);
      expect(screen.queryByRole('button', { name: /newer telegram/ })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  } finally {
    scrollBlockSize = 800;
  }
});

test('pausedCount does not grow scrollHeight; pill still shows backlog', () => {
  scrollBlockSize = 800;
  const rows = makeList(10, 9);
  const props = (pausedN: number, sort: SortConfig) => (
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sort}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={false}
      onListFollowChange={vi.fn()}
      isPaused={pausedN > 0}
      pausedCount={pausedN}
    />
  );

  try {
    const desc = render(props(0, sortConfig));
    const portDesc = desc.container.querySelector('.custom-scrollbar') as HTMLElement;
    const baseDesc = portDesc.scrollHeight;
    desc.rerender(props(3, sortConfig));
    expect(portDesc.scrollHeight).toBe(baseDesc);
    expect(screen.getByRole('button', { name: '3 newer telegrams' })).toBeInTheDocument();
    desc.unmount();

    const asc: SortConfig = [{ key: 'timestamp', direction: 'asc' }];
    const ascView = render(props(0, asc));
    const portAsc = ascView.container.querySelector('.custom-scrollbar') as HTMLElement;
    const baseAsc = portAsc.scrollHeight;
    ascView.rerender(props(4, asc));
    expect(portAsc.scrollHeight).toBe(baseAsc);
    expect(screen.getByRole('button', { name: '4 newer telegrams' })).toBeInTheDocument();
    ascView.unmount();
  } finally {
    scrollBlockSize = 800;
  }
});

test('overlay scrollbar thumb shrinks with pausedCount while scrollHeight stays fixed', () => {
  scrollBlockSize = 800;
  const rows = makeList(10, 9);
  const props = (pausedN: number) => (
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={false}
      onListFollowChange={vi.fn()}
      isPaused={pausedN > 0}
      pausedCount={pausedN}
    />
  );

  try {
    const view = render(props(0));
    const port = view.container.querySelector('.custom-scrollbar') as HTMLElement;
    fireEvent.scroll(port);
    const track = screen.getByTestId('list-scrollbar-track');
    const thumb0 = screen.getByTestId('list-scrollbar-thumb');
    expect(track.style.display).not.toBe('none');
    const h0 = Number.parseFloat(thumb0.style.height);
    expect(h0).toBeGreaterThan(0);
    const sh0 = port.scrollHeight;

    view.rerender(props(5));
    fireEvent.scroll(port);
    const thumb5 = screen.getByTestId('list-scrollbar-thumb');
    const h5 = Number.parseFloat(thumb5.style.height);
    expect(port.scrollHeight).toBe(sh0);
    expect(h5).toBeLessThan(h0);
    expect(h5).toBeCloseTo(
      Math.max(20, (800 * 800) / (sh0 + 5 * 85)),
      0,
    );
    expect(screen.getByRole('button', { name: '5 newer telegrams' })).toBeInTheDocument();
  } finally {
    scrollBlockSize = 800;
  }
});

test('settled live edge stays on newest published row when pausedCount is set', () => {
  const ROW = 85;
  scrollBlockSize = ROW * 2;
  try {
    const { container } = render(
      <TelegramTable
        telegrams={makeList(8, 7)}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
        listFollow={false}
        onListFollowChange={vi.fn()}
        isPaused
        pausedCount={3}
      />,
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    // Settled edge is fill rubber only — backlog is pill-only, not scroll pad.
    const settled = LIVE_EDGE_TOP;
    port.scrollTop = settled;
    fireEvent.scroll(port);
    expect(port.scrollTop).toBe(settled);
    // Only unpublished backlog — no published rows are newer than the edge.
    expect(screen.getByRole('button', { name: '3 newer telegrams' })).toBeInTheDocument();
  } finally {
    scrollBlockSize = 800;
  }
});

test('scrollbar hold freezes opposite spacer through overscroll; rubber waits for pointerup', async () => {
  scrollBlockSize = 800;
  const flushFrames = () => act(() => new Promise<void>(r => {
    requestAnimationFrame(() => requestAnimationFrame(() => r()));
  }));
  try {
    const { container, rerender } = render(
      <TelegramTable
        telegrams={makeList(8, 7)}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
        listFollow={false}
        onListFollowChange={vi.fn()}
      />,
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    await flushFrames();

    const spacerBefore = oppositeSpacerEl(port);
    expect(spacerBefore).toBeTruthy();
    const spacerHeightBefore = Number.parseFloat(spacerBefore!.style.height);
    const heightBefore = port.scrollHeight;

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fireEvent.pointerDown(port, { target: port, currentTarget: port });
      const max = port.scrollHeight - port.clientHeight;
      port.scrollTop = max;
      fireEvent.scroll(port);

      // Live prepend while thumb held must not change frozen spacer / scrollHeight.
      rerender(
        <TelegramTable
          telegrams={makeList(9, 8)}
          visibleColumns={visibleColumns}
          sortConfig={sortConfig}
          onSort={vi.fn()}
          activeFilters={DEFAULT_FILTERS}
          onQuickFilter={vi.fn()}
          onQuickVisualize={vi.fn()}
          listFollow={false}
          onListFollowChange={vi.fn()}
        />,
      );
      expect(Number.parseFloat(oppositeSpacerEl(port)!.style.height)).toBe(spacerHeightBefore);
      expect(port.scrollHeight).toBe(heightBefore);

      // Rubber must not settle while the scrollbar is still held.
      await act(async () => {
        vi.advanceTimersByTime(90);
      });
      await act(async () => {
        vi.advanceTimersByTime(180);
      });
      expect(port.scrollTop).toBe(max);

      fireEvent.pointerUp(window);
      await act(async () => {
        vi.advanceTimersByTime(90);
      });
      await act(async () => {
        vi.advanceTimersByTime(180);
      });
      expect(port.scrollTop).toBe(max - LIVE_EDGE_TOP);
    } finally {
      vi.useRealTimers();
    }
  } finally {
    scrollBlockSize = 800;
  }
});

// ── Metered pause-buffer reveal ─────────────────────────────────────────────
// With `onPauseReveal` the backlog is fed in a few rows per fill-axis gesture
// instead of one full flush, so the viewport never has to re-find an anchor
// that left the virtualizer window (the jump to the live edge above ~18 rows).

const ROW = 85;

const meteredProps = (
  telegrams: Telegram[],
  paused: boolean,
  pausedN: number,
  handlers: {
    onPauseReveal: ReturnType<typeof vi.fn>;
    onPauseFlush: ReturnType<typeof vi.fn>;
    onListFollowChange: ReturnType<typeof vi.fn>;
  },
  sort: SortConfig = sortConfig,
) => (
  <TelegramTable
    telegrams={telegrams}
    visibleColumns={visibleColumns}
    sortConfig={sort}
    onSort={vi.fn()}
    activeFilters={DEFAULT_FILTERS}
    onQuickFilter={vi.fn()}
    onQuickVisualize={vi.fn()}
    listFollow={false}
    onListFollowChange={handlers.onListFollowChange}
    isPaused={paused}
    pausedCount={pausedN}
    onPauseFlush={handlers.onPauseFlush}
    onPauseReveal={handlers.onPauseReveal}
  />
);

const meteredHandlers = () => ({
  onPauseReveal: vi.fn(),
  onPauseFlush: vi.fn(),
  onListFollowChange: vi.fn(),
});

test('metered reveal: a fill-axis wheel at the frozen edge asks for a few rows, never the whole backlog', () => {
  scrollBlockSize = ROW * 2;
  const h = meteredHandlers();
  const frozen = makeList(8, 7);
  try {
    const { container, rerender } = render(meteredProps(frozen, true, 50, h));
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    port.scrollTop = LIVE_EDGE_TOP;
    fireEvent.scroll(port);
    h.onListFollowChange.mockClear();

    // Enough rows for the 40px move plus the fill slot, one spare: 2 of 50.
    const deltaY = -40;
    fireEvent.wheel(port, { deltaY });
    expect(h.onPauseReveal).toHaveBeenCalledTimes(1);
    expect(h.onPauseReveal).toHaveBeenLastCalledWith(2);
    expect(h.onPauseFlush).not.toHaveBeenCalled();
    expect(h.onListFollowChange).not.toHaveBeenCalledWith(true);

    // Parent reveals the two oldest backlog rows; backlog shrinks, still paused.
    // The pin (no-op under jsdom geometry) is simulated by the prepended height.
    const pinned = LIVE_EDGE_TOP + 2 * ROW;
    port.scrollTop = pinned;
    rerender(meteredProps(makeList(10, 9), true, 48, h));
    // The gesture continues into the revealed rows — no snap to the edge.
    expect(port.scrollTop).toBe(pinned + deltaY);
    expect(h.onPauseReveal).toHaveBeenCalledTimes(1);
    expect(h.onListFollowChange).not.toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: /newer telegram/ })).toBeInTheDocument();

    // Away from the edge a wheel is plain scrolling; back at the edge the
    // next slice is requested — line by line, never all 48 at once.
    fireEvent.wheel(port, { deltaY });
    expect(h.onPauseReveal).toHaveBeenCalledTimes(1);
    port.scrollTop = LIVE_EDGE_TOP;
    fireEvent.scroll(port);
    fireEvent.wheel(port, { deltaY });
    expect(h.onPauseReveal).toHaveBeenCalledTimes(2);
    expect(h.onPauseReveal).toHaveBeenLastCalledWith(2);
    expect(h.onPauseFlush).not.toHaveBeenCalled();
  } finally {
    scrollBlockSize = 800;
  }
});

test('metered reveal: slice size follows the gesture and is capped below the overscan window', () => {
  scrollBlockSize = ROW * 2;
  const h = meteredHandlers();
  try {
    const { container } = render(meteredProps(makeList(8, 7), true, 500, h));
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    port.scrollTop = LIVE_EDGE_TOP;
    fireEvent.scroll(port);

    // A page-sized move would need 11 rows; the cap keeps the pinned row rendered.
    fireEvent.wheel(port, { deltaY: -800 });
    expect(h.onPauseReveal).toHaveBeenLastCalledWith(8);
  } finally {
    scrollBlockSize = 800;
  }
});

test('metered reveal: gesture outrunning the landed rows tops the slice up instead of snapping', () => {
  scrollBlockSize = ROW * 2;
  const h = meteredHandlers();
  try {
    const { container, rerender } = render(meteredProps(makeList(8, 7), true, 50, h));
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    port.scrollTop = LIVE_EDGE_TOP;
    fireEvent.scroll(port);

    fireEvent.wheel(port, { deltaY: -300 });
    expect(h.onPauseReveal).toHaveBeenLastCalledWith(6);

    // Rows measured shorter than estimated: the pin lands only 200px further,
    // so the 300px move runs into the fill slot (clamped at 0, 58px short).
    port.scrollTop = LIVE_EDGE_TOP + 200;
    rerender(meteredProps(makeList(14, 13), true, 44, h));
    expect(port.scrollTop).toBe(0);
    // The open slot is refilled right away: 58px leftover + fill slot → 3 rows.
    expect(h.onPauseReveal).toHaveBeenCalledTimes(2);
    expect(h.onPauseReveal).toHaveBeenLastCalledWith(3);
    expect(h.onListFollowChange).not.toHaveBeenCalledWith(true);
  } finally {
    scrollBlockSize = 800;
  }
});

test('metered reveal: a slice with every row filtered out requests the next, wider slice', () => {
  scrollBlockSize = ROW * 2;
  const h = meteredHandlers();
  const rows = makeList(8, 7);
  try {
    const { container, rerender } = render(meteredProps(rows, true, 50, h));
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    port.scrollTop = LIVE_EDGE_TOP;
    fireEvent.scroll(port);

    const deltaY = -40;
    fireEvent.wheel(port, { deltaY });
    expect(h.onPauseReveal).toHaveBeenLastCalledWith(2);

    // Backlog shrank but the visible list did not change (rows filtered out):
    // keep going with a doubled slice, capped.
    rerender(meteredProps(rows, true, 48, h));
    expect(h.onPauseReveal).toHaveBeenCalledTimes(2);
    expect(h.onPauseReveal).toHaveBeenLastCalledWith(4);
    rerender(meteredProps(rows, true, 44, h));
    expect(h.onPauseReveal).toHaveBeenCalledTimes(3);
    expect(h.onPauseReveal).toHaveBeenLastCalledWith(8);
    expect(port.scrollTop).toBe(LIVE_EDGE_TOP);

    // Backlog drained without a single visible row: parent resumes playing,
    // the held gesture is applied once, nothing is flushed wholesale.
    rerender(meteredProps(rows, false, 0, h));
    expect(h.onPauseReveal).toHaveBeenCalledTimes(3);
    expect(port.scrollTop).toBe(LIVE_EDGE_TOP + deltaY);
    expect(h.onPauseFlush).not.toHaveBeenCalled();
  } finally {
    scrollBlockSize = 800;
  }
});

test('metered reveal: passively returning to the newest row with a backlog does not re-follow', () => {
  scrollBlockSize = ROW * 2;
  const h = meteredHandlers();
  try {
    const { container } = render(meteredProps(makeList(12, 11), true, 4, h));
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;

    // Leave the edge, then scroll back onto the newest row.
    port.scrollTop = ROW * 6;
    fireEvent.scroll(port);
    port.scrollTop = LIVE_EDGE_TOP;
    fireEvent.scroll(port);
    // Re-following would hand the whole backlog to a full flush + edge snap.
    expect(h.onListFollowChange).not.toHaveBeenCalledWith(true);
    expect(h.onPauseReveal).not.toHaveBeenCalled();

    // Only the fill-axis gesture feeds the backlog.
    fireEvent.wheel(port, { deltaY: -40 });
    expect(h.onPauseReveal).toHaveBeenCalledTimes(1);
    expect(h.onPauseFlush).not.toHaveBeenCalled();
  } finally {
    scrollBlockSize = 800;
  }
});

test('metered reveal: the fill slot is filled from the backlog instead of rubber-banding; rubber returns once drained', async () => {
  scrollBlockSize = 800;
  const h = meteredHandlers();
  const flushFrames = () => act(() => new Promise<void>(r => {
    requestAnimationFrame(() => requestAnimationFrame(() => r()));
  }));
  try {
    const { container, rerender } = render(meteredProps(makeList(6, 5), true, 2, h));
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    await flushFrames();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      // The empty fill slot comes on screen with a backlog waiting: fill it.
      port.scrollTop = 0;
      fireEvent.scroll(port);
      expect(h.onPauseReveal).toHaveBeenCalledTimes(1);
      await act(async () => { vi.advanceTimersByTime(90 + 180); });
      // No rubber-band while the slice is pending.
      expect(port.scrollTop).toBe(0);

      // Backlog gone (parent resumed): the fill padding is a rubber band again.
      rerender(meteredProps(makeList(8, 7), false, 0, h));
      fireEvent.scroll(port);
      await act(async () => { vi.advanceTimersByTime(90); });
      await act(async () => { vi.advanceTimersByTime(180); });
      expect(port.scrollTop).toBe(LIVE_EDGE_TOP);
    } finally {
      vi.useRealTimers();
    }
  } finally {
    scrollBlockSize = 800;
  }
});

test('metered reveal: manual pause stays a hard stop, no slice is requested', () => {
  scrollBlockSize = ROW * 2;
  const h = meteredHandlers();
  try {
    const { container } = render(
      <TelegramTable
        telegrams={makeList(8, 7)}
        visibleColumns={visibleColumns}
        sortConfig={sortConfig}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
        listFollow={false}
        onListFollowChange={h.onListFollowChange}
        isPaused
        isManualPause
        pausedCount={5}
        onPauseFlush={h.onPauseFlush}
        onPauseReveal={h.onPauseReveal}
      />,
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    port.scrollTop = LIVE_EDGE_TOP;
    fireEvent.scroll(port);
    fireEvent.wheel(port, { deltaY: -40 });
    expect(h.onPauseReveal).not.toHaveBeenCalled();
    expect(h.onPauseFlush).not.toHaveBeenCalled();
    expect(h.onListFollowChange).not.toHaveBeenCalledWith(true);
  } finally {
    scrollBlockSize = 800;
  }
});

test('metered reveal: overlay scrollbar thumb pulled past the fill stop feeds the backlog', () => {
  scrollBlockSize = 800;
  const h = meteredHandlers();
  try {
    const { container } = render(meteredProps(makeList(20, 19), true, 30, h));
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    port.scrollTop = LIVE_EDGE_TOP;
    fireEvent.scroll(port);
    const thumb = screen.getByTestId('list-scrollbar-thumb');

    // Dragging up from the settled edge: the real range is exhausted, the
    // overhang asks for backlog rows (capped per step).
    act(() => {
      fireEvent.pointerDown(thumb, { pointerId: 1, clientY: 200 });
      fireEvent.pointerMove(thumb, { pointerId: 1, clientY: 100 });
    });
    expect(h.onPauseReveal).toHaveBeenCalledTimes(1);
    expect(h.onPauseReveal.mock.calls[0][0]).toBeGreaterThan(0);
    expect(h.onPauseReveal.mock.calls[0][0]).toBeLessThanOrEqual(8);
    expect(h.onPauseFlush).not.toHaveBeenCalled();
    act(() => {
      fireEvent.pointerUp(thumb, { pointerId: 1, clientY: 100 });
    });
  } finally {
    scrollBlockSize = 800;
  }
});

test('metered reveal on the ascending live edge (bottom) stays seamless', () => {
  scrollBlockSize = ROW * 2;
  const h = meteredHandlers();
  const asc: SortConfig = [{ key: 'timestamp', direction: 'asc' }];
  const frozen = [...makeList(8, 7)].reverse();
  const revealed = [...makeList(10, 9)].reverse();
  try {
    const { container, rerender } = render(meteredProps(frozen, true, 20, h, asc));
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    const max = Math.max(0, port.scrollHeight - port.clientHeight);
    port.scrollTop = Math.max(0, max - LIVE_EDGE_TOP);
    fireEvent.scroll(port);

    fireEvent.wheel(port, { deltaY: -40 }); // toward older: nothing
    expect(h.onPauseReveal).not.toHaveBeenCalled();

    const deltaY = 40;
    fireEvent.wheel(port, { deltaY });
    expect(h.onPauseReveal).toHaveBeenCalledTimes(1);
    expect(h.onPauseReveal).toHaveBeenLastCalledWith(2);

    // Appending at the bottom leaves existing rows in place; the gesture
    // continues into the new rows.
    const before = port.scrollTop;
    rerender(meteredProps(revealed, true, 18, h, asc));
    expect(port.scrollTop).toBe(before + deltaY);
    expect(h.onListFollowChange).not.toHaveBeenCalledWith(true);
    expect(h.onPauseFlush).not.toHaveBeenCalled();
  } finally {
    scrollBlockSize = 800;
  }
});

// ── Spacer after a buffer clear; manual-pause hold ──────────────────────────

const holdProps = (
  telegrams: Telegram[],
  opts: {
    paused: boolean;
    manual: boolean;
    pausedN: number;
    listFollow?: boolean;
    handlers: ReturnType<typeof meteredHandlers>;
    onJumpToLive?: ReturnType<typeof vi.fn>;
    sort?: SortConfig;
  },
) => (
  <TelegramTable
    telegrams={telegrams}
    visibleColumns={visibleColumns}
    sortConfig={opts.sort ?? sortConfig}
    onSort={vi.fn()}
    activeFilters={DEFAULT_FILTERS}
    onQuickFilter={vi.fn()}
    onQuickVisualize={vi.fn()}
    listFollow={opts.listFollow ?? false}
    onListFollowChange={opts.handlers.onListFollowChange}
    isPaused={opts.paused}
    isManualPause={opts.manual}
    pausedCount={opts.pausedN}
    onPauseFlush={opts.handlers.onPauseFlush}
    onPauseReveal={opts.handlers.onPauseReveal}
    onJumpToLive={opts.onJumpToLive}
  />
);

test('cleared list: newer-pill reveal lands on the edge row, not on the fill spacer', () => {
  scrollBlockSize = 800;
  const h = meteredHandlers();
  const onJumpToLive = vi.fn();
  try {
    const { container, rerender } = render(
      holdProps(makeList(6, 5), { paused: false, manual: false, pausedN: 0, listFollow: true, handlers: h, onJumpToLive }),
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    expect(port.scrollTop).toBe(LIVE_EDGE_TOP);

    // Buffer cleared while manually paused: "No data available", backlog waits.
    rerender(holdProps([], { paused: true, manual: true, pausedN: 3, handlers: h, onJumpToLive }));
    expect(screen.getByText('No data available.')).toBeInTheDocument();
    port.scrollTop = 0;
    fireEvent.scroll(port);

    fireEvent.click(screen.getByRole('button', { name: /newer telegram/ }));
    expect(onJumpToLive).toHaveBeenCalledTimes(1);

    // Parent flushed the backlog: the first rows must sit flush with the edge —
    // the fill spacer (scrollTop 0) must not stay on screen.
    rerender(holdProps(makeList(3, 2), { paused: false, manual: false, pausedN: 0, handlers: h, onJumpToLive }));
    expect(port.scrollTop).toBe(LIVE_EDGE_TOP);
    expect(screen.queryByTestId('fill-rubber-pause-label-left')).not.toBeInTheDocument();
  } finally {
    scrollBlockSize = 800;
  }
});

test('cleared list: the first live telegram while following lands on the edge row', () => {
  scrollBlockSize = 800;
  const h = meteredHandlers();
  try {
    const { container, rerender } = render(
      holdProps(makeList(6, 5), { paused: false, manual: false, pausedN: 0, listFollow: true, handlers: h }),
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    rerender(holdProps([], { paused: false, manual: false, pausedN: 0, listFollow: true, handlers: h }));
    // An empty list has no scroll range: the browser clamps scrollTop to 0.
    port.scrollTop = 0;
    fireEvent.scroll(port);

    rerender(holdProps(makeList(1, 0), { paused: false, manual: false, pausedN: 0, listFollow: true, handlers: h }));
    expect(port.scrollTop).toBe(LIVE_EDGE_TOP);
  } finally {
    scrollBlockSize = 800;
  }
});

test('cleared list: first rows while detached from the edge leave the viewport alone', () => {
  scrollBlockSize = 800;
  const h = meteredHandlers();
  try {
    const { container, rerender } = render(
      holdProps(makeList(20, 19), { paused: false, manual: false, pausedN: 0, listFollow: true, handlers: h }),
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    fireEvent.click(container.querySelectorAll('.log-row')[3]);
    expect(h.onListFollowChange).toHaveBeenCalledWith(false);
    port.scrollTop = ROW * 5;
    fireEvent.scroll(port);

    rerender(holdProps([], { paused: true, manual: true, pausedN: 2, handlers: h }));
    port.scrollTop = 0;
    fireEvent.scroll(port);
    rerender(holdProps(makeList(2, 1), { paused: true, manual: true, pausedN: 0, handlers: h }));
    expect(port.scrollTop).toBe(0);
  } finally {
    scrollBlockSize = 800;
  }
});

test('manual pause with a backlog: the fill spacer holds, no rubber-band, labels stay', async () => {
  scrollBlockSize = 800;
  const h = meteredHandlers();
  const flushFrames = () => act(() => new Promise<void>(r => {
    requestAnimationFrame(() => requestAnimationFrame(() => r()));
  }));
  try {
    const { container } = render(
      holdProps(makeList(6, 5), { paused: true, manual: true, pausedN: 4, handlers: h }),
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    await flushFrames();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      act(() => {
        port.scrollTop = 0;
        fireEvent.scroll(port);
      });
      expect(screen.getByTestId('fill-rubber-pause-label-left')).toHaveTextContent('...paused manually...');
      act(() => {
        fireEvent.wheel(port, { deltaY: -40 });
      });
      await act(async () => { vi.advanceTimersByTime(90); });
      await act(async () => { vi.advanceTimersByTime(180); });
      expect(port.scrollTop).toBe(0);
      expect(screen.getByTestId('fill-rubber-pause-label-left')).toBeInTheDocument();
      expect(h.onPauseReveal).not.toHaveBeenCalled();
      expect(h.onPauseFlush).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  } finally {
    scrollBlockSize = 800;
  }
});

test('manual pause without a backlog: the fill spacer still rubber-bands back', async () => {
  scrollBlockSize = 800;
  const h = meteredHandlers();
  const flushFrames = () => act(() => new Promise<void>(r => {
    requestAnimationFrame(() => requestAnimationFrame(() => r()));
  }));
  try {
    const { container } = render(
      holdProps(makeList(6, 5), { paused: true, manual: true, pausedN: 0, handlers: h }),
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    await flushFrames();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      act(() => {
        port.scrollTop = 0;
        fireEvent.scroll(port);
      });
      await act(async () => { vi.advanceTimersByTime(90); });
      await act(async () => { vi.advanceTimersByTime(180); });
      expect(port.scrollTop).toBe(LIVE_EDGE_TOP);
    } finally {
      vi.useRealTimers();
    }
  } finally {
    scrollBlockSize = 800;
  }
});

test('manual → auto pause with the spacer on screen fills the slot with one backlog row', () => {
  scrollBlockSize = 800;
  const h = meteredHandlers();
  try {
    const { container, rerender } = render(
      holdProps(makeList(6, 5), { paused: true, manual: true, pausedN: 4, handlers: h }),
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    port.scrollTop = 0;
    fireEvent.scroll(port);
    expect(h.onPauseReveal).not.toHaveBeenCalled();

    rerender(holdProps(makeList(6, 5), { paused: true, manual: false, pausedN: 4, handlers: h }));
    expect(h.onPauseReveal).toHaveBeenCalledTimes(1);
    expect(h.onPauseReveal).toHaveBeenLastCalledWith(1);
    expect(h.onPauseFlush).not.toHaveBeenCalled();
    expect(port.scrollTop).toBe(0);

    // The oldest backlog row lands in the slot; the previous edge row keeps
    // its place. The pin (no-op under jsdom geometry) is simulated by the
    // prepended height — no snap to the edge, no further slice, still frozen:
    // no follow.
    port.scrollTop = ROW;
    rerender(holdProps(makeList(7, 6), { paused: true, manual: false, pausedN: 3, handlers: h }));
    expect(port.scrollTop).toBe(ROW);
    expect(h.onListFollowChange).not.toHaveBeenCalledWith(true);
    expect(h.onPauseReveal).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /newer telegram/ })).toBeInTheDocument();
  } finally {
    scrollBlockSize = 800;
  }
});

test('after the slot fill, a wheel that would run into the fill slot continues the metered feed with its full delta', () => {
  scrollBlockSize = 800;
  const h = meteredHandlers();
  try {
    // Edge row sits one row in (the slot row above it), still a backlog.
    const { container, rerender } = render(meteredProps(makeList(7, 6), true, 3, h));
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    port.scrollTop = ROW;
    fireEvent.scroll(port);
    expect(h.onPauseReveal).not.toHaveBeenCalled();

    // 85 → -15: the move crosses the settled edge (43) by 58px — not "at the
    // edge" by the EPS test, but the browser would clamp it. Reveal instead.
    const deltaY = -100;
    fireEvent.wheel(port, { deltaY });
    expect(h.onPauseReveal).toHaveBeenCalledTimes(1);
    expect(h.onPauseReveal).toHaveBeenLastCalledWith(3);

    // Pin simulated by the prepended height; the full delta is then applied.
    port.scrollTop = ROW + 3 * ROW;
    rerender(meteredProps(makeList(10, 9), true, 0, h));
    expect(port.scrollTop).toBe(ROW + 3 * ROW + deltaY);
    expect(h.onListFollowChange).not.toHaveBeenCalledWith(true);
  } finally {
    scrollBlockSize = 800;
  }
});

test('manual → auto pause away from the spacer requests nothing', () => {
  scrollBlockSize = 800;
  const h = meteredHandlers();
  try {
    const { container, rerender } = render(
      holdProps(makeList(20, 19), { paused: true, manual: true, pausedN: 4, handlers: h }),
    );
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    port.scrollTop = ROW * 5;
    fireEvent.scroll(port);

    rerender(holdProps(makeList(20, 19), { paused: true, manual: false, pausedN: 4, handlers: h }));
    expect(h.onPauseReveal).not.toHaveBeenCalled();
    expect(h.onPauseFlush).not.toHaveBeenCalled();
    expect(port.scrollTop).toBe(ROW * 5);
  } finally {
    scrollBlockSize = 800;
  }
});
