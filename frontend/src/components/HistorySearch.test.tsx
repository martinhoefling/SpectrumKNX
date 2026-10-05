import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';
import { HistorySearch } from './HistorySearch';
import { DEFAULT_FILTERS, type ActiveFilters, type FilterOptions } from '../types/filters';
import { makeTelegram } from '../test/telegramFactory';
import { loadHistoryTelegrams } from '../utils/historyLoad';

vi.mock('../utils/historyLoad', async importOriginal => ({
  ...(await importOriginal<typeof import('../utils/historyLoad')>()),
  loadHistoryTelegrams: vi.fn(),
}));

const OPTIONS: FilterOptions = {
  sources: [], targets: [], types: ['Write', 'Read', 'Response'], dpts: [],
  ga_group_names: {}, pa_line_names: {},
};

const LOADED = [
  makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', target_address: '1/2/3' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', target_address: '4/5/6' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', target_address: '4/5/6' }),
];

const FILTERED: ActiveFilters = { ...DEFAULT_FILTERS, targets: ['1/2/3'] };

beforeEach(() => {
  vi.mocked(loadHistoryTelegrams).mockReset().mockResolvedValue({
    telegrams: LOADED, metadata: { total_count: LOADED.length, limit_reached: false },
  });
});

const renderSearch = (props: Partial<React.ComponentProps<typeof HistorySearch>> = {}) => {
  const base: React.ComponentProps<typeof HistorySearch> = {
    visibleColumns: { time: true, target: true },
    loadLimit: 1000,
    filterOptions: OPTIONS,
    activeFilters: FILTERED,
    onFiltersChange: vi.fn(),
    onOpenSettings: vi.fn(),
    projectLoaded: true,
    selectedVisualizationTargets: [],
    onVisualizationTargetsChange: vi.fn(),
    // Auto-loads on mount, unfiltered, so all three telegrams are in memory.
    initialView: { plot: [], filters: DEFAULT_FILTERS, range: { kind: 'relative', seconds: 3600 }, embed: false },
    ...props,
  };
  const utils = render(<HistorySearch {...base} />);
  return { ...utils, rerenderWith: (next: typeof props) => utils.rerender(<HistorySearch {...base} {...next} />) };
};

test('master switch off shows every loaded telegram and keeps the filter set (#436)', async () => {
  const { rerenderWith } = renderSearch({ filtersEnabled: true, onFiltersEnabledChange: vi.fn() });
  await waitFor(() => expect(screen.getByText(/telegrams$/).textContent).toBe('1 / 3 telegrams'));

  rerenderWith({ filtersEnabled: false, onFiltersEnabledChange: vi.fn() });
  expect(screen.getByText(/telegrams$/).textContent).toBe('3 telegrams');
});

test('the switch in the filter pane reports the change (#436)', async () => {
  const onFiltersEnabledChange = vi.fn();
  renderSearch({ filtersEnabled: true, onFiltersEnabledChange });
  await waitFor(() => expect(screen.getByText(/telegrams$/)).toBeInTheDocument());

  fireEvent.click(screen.getByTitle('Disable all filters (keeps them)'));
  expect(onFiltersEnabledChange).toHaveBeenCalledWith(false);
});

test('switching off after a filtered load offers a reload for the full set (#436)', async () => {
  const { rerenderWith } = renderSearch({
    filtersEnabled: true,
    onFiltersEnabledChange: vi.fn(),
    initialView: { plot: [], filters: FILTERED, range: { kind: 'relative', seconds: 3600 }, embed: false },
  });
  await waitFor(() => expect(screen.getByText(/telegrams$/)).toBeInTheDocument());
  expect(screen.queryByText(/Reload for full results/)).not.toBeInTheDocument();

  rerenderWith({
    filtersEnabled: false,
    onFiltersEnabledChange: vi.fn(),
    initialView: { plot: [], filters: FILTERED, range: { kind: 'relative', seconds: 3600 }, embed: false },
  });
  expect(screen.getByText(/Reload for full results/)).toBeInTheDocument();
});
