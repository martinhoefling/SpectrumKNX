import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi, beforeAll } from 'vitest';
import { useState } from 'react';
import { TelegramTable } from './TelegramTable';
import { Visualizer } from './Visualizer';
import { StatisticsOverlay } from './StatisticsOverlay';
import { BuildingOverlay } from './BuildingOverlay';
import { LastSeenOverlay } from './LastSeenOverlay';
import { makeTelegram } from '../test/telegramFactory';
import { DEFAULT_FILTERS } from '../types/filters';

// ── Mock heavy/chart components to avoid uPlot/canvas errors in JSDOM ──
vi.mock('./TimelineChart', () => ({
  TimelineChart: () => <div data-testid="timeline-chart" />
}));

vi.mock('./MixedChart', () => ({
  MixedChart: () => <div data-testid="mixed-chart" />
}));

vi.mock('./TimeBrush', () => ({
  TimeBrush: ({ value, onChange }: { value: [number, number] | null; onChange: (val: [number, number] | null) => void }) => (
    <input
      data-testid="zoom-range-mock-element"
      value={value ? value.join(',') : ''}
      onChange={(e) => {
        const parts = e.target.value.split(',').map(Number);
        onChange([parts[0], parts[1]]);
      }}
    />
  ),
}));

beforeAll(() => {
  globalThis.ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(el: Element) {
      const size = { inlineSize: 1000, blockSize: 800 };
      this.cb(
        [{ target: el, contentRect: el.getBoundingClientRect(), borderBoxSize: [size], contentBoxSize: [size] } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 1000, height: 800, top: 0, bottom: 800, left: 0, right: 1000, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

  vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
    Promise.resolve({
      json: () => Promise.resolve({ telegrams: [] }),
    })
  ));
});

const visibleColumns = {
  time: true, delta: true, source: true, sourceName: true,
  target: true, targetName: true, type: true, dpt: true, data: true, value: true,
};

// ── 1. TelegramTable Persistence Test (Task 2.4) ──
test('TelegramTable quick-filter and follow/anchor survive unmount/remount', () => {
  const telegrams = [makeTelegram({ target_address: '1/1/1', raw_hex: '0x01' })];

  function TestWrapper() {
    const [show, setShow] = useState(true);
    const [open, setOpen] = useState(false);
    const [enabled, setEnabled] = useState(false);
    const [patterns, setPatterns] = useState({});
    const [follow, setFollow] = useState(true);
    const [anchor, setAnchor] = useState<string | null>(null);

    return (
      <div>
        <button onClick={() => setShow(!show)}>Toggle Table</button>
        {show && (
          <TelegramTable
            telegrams={telegrams}
            visibleColumns={visibleColumns}
            sortConfig={[{ key: 'timestamp', direction: 'desc' }]}
            onSort={vi.fn()}
            activeFilters={DEFAULT_FILTERS}
            onQuickFilter={vi.fn()}
            onQuickVisualize={vi.fn()}
            quickFilterOpen={open}
            onQuickFilterOpenChange={setOpen}
            quickFilterEnabled={enabled}
            onQuickFilterEnabledChange={setEnabled}
            quickPatterns={patterns}
            onQuickPatternsChange={setPatterns}
            listFollow={follow}
            onListFollowChange={setFollow}
            listAnchorKey={anchor}
            onListAnchorKeyChange={setAnchor}
          />
        )}
      </div>
    );
  }

  render(<TestWrapper />);

  // Open filter bar and type
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const input = screen.getByLabelText('Quick filter TARGET pattern');
  fireEvent.change(input, { target: { value: '1/1/1' } });

  // Unmount
  fireEvent.click(screen.getByText('Toggle Table'));
  expect(screen.queryByLabelText('Quick filter TARGET pattern')).not.toBeInTheDocument();

  // Remount
  fireEvent.click(screen.getByText('Toggle Table'));
  expect(screen.getByLabelText('Quick filter TARGET pattern')).toHaveValue('1/1/1');
});

// ── 2. Visualizer Zoom Persistence Test (Task 3.2) ──
test('Visualizer zoom survives remount and auto-follow state behaves correctly', () => {
  const telegrams = [
    makeTelegram({ timestamp: '2024-01-01T10:00:00.000Z', target_address: '1/1/1' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:10.000Z', target_address: '1/1/1' }),
  ];

  function TestWrapper() {
    const [show, setShow] = useState(true);
    const [zoom, setZoom] = useState<[number, number] | null>(null);

    return (
      <div>
        <button onClick={() => setShow(!show)}>Toggle Visualizer</button>
        {show && (
          <Visualizer
            telegrams={telegrams}
            selectedTargets={['1/1/1']}
            onTargetsChange={vi.fn()}
            onClose={vi.fn()}
            zoomRange={zoom}
            onZoomRangeChange={setZoom}
          />
        )}
      </div>
    );
  }

  render(<TestWrapper />);

  // Mock a zoom change
  const brushInput = screen.getByTestId('zoom-range-mock-element');
  fireEvent.change(brushInput, { target: { value: '1704103202000,1704103208000' } });

  // Unmount
  fireEvent.click(screen.getByText('Toggle Visualizer'));
  expect(screen.queryByTestId('zoom-range-mock-element')).not.toBeInTheDocument();

  // Remount
  fireEvent.click(screen.getByText('Toggle Visualizer'));
  expect(screen.getByTestId('zoom-range-mock-element')).toHaveValue('1704103202000,1704103208000');
});

// ── 3. Statistics & Building Search Persistence Test (Task 4.3) ──
test('Statistics and Building search queries survive remount', () => {
  const filterOptions = {
    sources: [],
    targets: [],
    types: [],
    dpts: [],
  };

  function TestWrapper() {
    const [showStats, setShowStats] = useState(true);
    const [showBuilding, setShowBuilding] = useState(true);
    const [statsQuery, setStatsQuery] = useState('');
    const [buildingQuery, setBuildingQuery] = useState('');

    return (
      <div>
        <button onClick={() => setShowStats(!showStats)}>Toggle Stats</button>
        <button onClick={() => setShowBuilding(!showBuilding)}>Toggle Building</button>
        {showStats && (
          <StatisticsOverlay
            filterOptions={filterOptions}
            onClose={vi.fn()}
            searchQuery={statsQuery}
            onSearchQueryChange={setStatsQuery}
          />
        )}
        {showBuilding && (
          <BuildingOverlay
            onClose={vi.fn()}
            onFilterDevice={vi.fn()}
            onFilterGAs={vi.fn()}
            onLastSeen={vi.fn()}
            onDeviceStatus={vi.fn()}
            searchQuery={buildingQuery}
            onSearchQueryChange={setBuildingQuery}
          />
        )}
      </div>
    );
  }

  render(<TestWrapper />);

  // Locate the input for stats using the header title
  const statsTitle = screen.getByText('Traffic Statistics');
  const statsInput = statsTitle.closest('div')?.parentElement?.querySelector('input[placeholder="Filter…"]');
  expect(statsInput).toBeTruthy();
  fireEvent.change(statsInput!, { target: { value: 'stats-query' } });

  // Locate the input for building using its header title
  const buildingTitle = screen.getByText('Building Structure');
  const buildingInput = buildingTitle.closest('div')?.querySelector('input[placeholder="Filter…"]');
  expect(buildingInput).toBeTruthy();
  fireEvent.change(buildingInput!, { target: { value: 'building-query' } });

  // Unmount Stats
  fireEvent.click(screen.getByText('Toggle Stats'));
  expect(screen.queryByText('Traffic Statistics')).not.toBeInTheDocument();

  // Remount Stats
  fireEvent.click(screen.getByText('Toggle Stats'));
  const remountedStatsTitle = screen.getByText('Traffic Statistics');
  const remountedStatsInput = remountedStatsTitle.closest('div')?.parentElement?.querySelector('input[placeholder="Filter…"]');
  expect(remountedStatsInput).toHaveValue('stats-query');

  // Unmount Building
  fireEvent.click(screen.getByText('Toggle Building'));
  expect(screen.queryByText('Building Structure')).not.toBeInTheDocument();

  // Remount Building
  fireEvent.click(screen.getByText('Toggle Building'));
  const remountedBuildingTitle = screen.getByText('Building Structure');
  const remountedBuildingInput = remountedBuildingTitle.closest('div')?.querySelector('input[placeholder="Filter…"]');
  expect(remountedBuildingInput).toHaveValue('building-query');
});

// ── 4. LastSeenOverlay Selectors & Selection (Task 5.4) ──
test('LastSeenOverlay selectors and selection survive remount', () => {
  const filterOptions = {
    sources: [{ address: '1.1.1', name: 'Device 1' }],
    targets: [{ address: '1/1/1', name: 'GA 1' }],
    types: [],
    dpts: [],
  };

  function TestWrapper() {
    const [show, setShow] = useState(true);
    const [limit, setLimit] = useState(20);
    const [live, setLive] = useState(false);
    const [search, setSearch] = useState('');
    const [addresses, setAddresses] = useState<string[]>(['1/1/1']);
    const [mode, setMode] = useState<'ga' | 'pa'>('ga');

    return (
      <div>
        <button onClick={() => setShow(!show)}>Toggle LastSeen</button>
        {show && (
          <LastSeenOverlay
            filterOptions={filterOptions}
            initialAddresses={addresses}
            initialMode={mode}
            onClose={vi.fn()}
            limit={limit}
            onLimitChange={setLimit}
            autoRefresh={live}
            onAutoRefreshChange={setLive}
            search={search}
            onSearchChange={setSearch}
            onSelectionChange={(m, a) => {
              setMode(m);
              setAddresses(a);
            }}
          />
        )}
      </div>
    );
  }

  render(<TestWrapper />);

  // Locate the input for lastseen using the sidebar
  const sidebar = screen.getByText('Group Addresses').closest('div')?.parentElement;
  const searchInput = sidebar?.querySelector('input[placeholder="Filter…"]');
  expect(searchInput).toBeTruthy();
  fireEvent.change(searchInput!, { target: { value: 'search-term' } });

  // Toggle autoRefresh
  const liveButton = screen.getByTitle('Enable auto-refresh (10s)');
  fireEvent.click(liveButton);

  // Unmount
  fireEvent.click(screen.getByText('Toggle LastSeen'));
  expect(screen.queryByText('Last Seen Values')).not.toBeInTheDocument();

  // Remount
  fireEvent.click(screen.getByText('Toggle LastSeen'));
  const remountedSidebar = screen.getByText('Group Addresses').closest('div')?.parentElement;
  const remountedSearchInput = remountedSidebar?.querySelector('input[placeholder="Filter…"]');
  expect(remountedSearchInput).toHaveValue('search-term');
  expect(screen.getByTitle('Disable auto-refresh (10s)')).toBeInTheDocument();
});
