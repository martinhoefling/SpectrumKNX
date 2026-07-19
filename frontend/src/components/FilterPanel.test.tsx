import { render, screen, fireEvent, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { FilterPanel } from './FilterPanel';
import { DEFAULT_FILTERS, type FilterOptions } from '../types/filters';

const EMPTY_OPTIONS: FilterOptions = {
  sources: [], targets: [], types: ['Write', 'Read', 'Response'], dpts: [],
  ga_group_names: {}, pa_line_names: {},
};

test('shows the no-project notice and CTA when no project is loaded', () => {
  const onUploadProject = vi.fn();
  render(
    <FilterPanel
      options={EMPTY_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      mode="history"
      projectLoaded={false}
      onUploadProject={onUploadProject}
    />
  );

  expect(screen.getByText(/No ETS project loaded/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Upload ETS project/i }));
  expect(onUploadProject).toHaveBeenCalledTimes(1);
});

test('hides the notice while project status is unknown', () => {
  render(
    <FilterPanel
      options={EMPTY_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      mode="history"
    />
  );
  expect(screen.queryByText(/No ETS project loaded/i)).not.toBeInTheDocument();
});

test('toggles the direction filter (#194)', () => {
  const onFiltersChange = vi.fn();
  render(
    <FilterPanel
      options={EMPTY_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={onFiltersChange}
      counts={{ sources: {}, targets: {}, types: {}, directions: { Incoming: 7, Outgoing: 2 }, dpts: {} }}
      mode="live"
      projectLoaded={true}
    />
  );

  expect(screen.getByText('Direction')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Outgoing'));
  expect(onFiltersChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, directions: ['Outgoing'] });
});

// ── Quick actions on active filter rows (#214) ───────────────────────────────

const GA_OPTIONS: FilterOptions = {
  ...EMPTY_OPTIONS,
  sources: [{ address: '1.2.3', name: 'Taster EG' }],
  targets: [{ address: '0/1/2', name: 'Licht Küche', main: 1, sub: 1 }],
};
const ACTIVE = { ...DEFAULT_FILTERS, sources: ['1.2.3'], targets: ['0/1/2'] };

test('active target rows offer send-to-GA and last-seen actions (#214)', () => {
  const onQuickLastSeen = vi.fn();
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
      onQuickLastSeen={onQuickLastSeen}
    />
  );

  const active = screen.getByText('Active Filters').parentElement!;
  // One send trigger: the active GA target row (sources are PAs — no send).
  expect(within(active).getAllByTitle('Send to this GA')).toHaveLength(1);

  const lastSeen = within(active).getAllByTitle('Show last seen values');
  expect(lastSeen).toHaveLength(2); // source (PA) + target (GA)
  fireEvent.click(lastSeen[0]);
  expect(onQuickLastSeen).toHaveBeenCalledWith('1.2.3', 'pa');
  fireEvent.click(lastSeen[1]);
  expect(onQuickLastSeen).toHaveBeenCalledWith('0/1/2', 'ga');
});

test('hides the send action on active rows when writes are disabled', () => {
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={false}
      onQuickLastSeen={() => {}}
    />
  );
  const active = screen.getByText('Active Filters').parentElement!;
  expect(within(active).queryByTitle('Send to this GA')).not.toBeInTheDocument();
  expect(within(active).getAllByTitle('Show last seen values')).toHaveLength(2);
});

test('opens the quick-send popover from an active target row', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ telegrams: [] }),
  }) as Response));
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
    />
  );
  const active = screen.getByText('Active Filters').parentElement!;
  fireEvent.click(within(active).getByTitle('Send to this GA'));
  // The popover shows the last value and the write/read controls.
  expect(await screen.findByText(/Last value/)).toBeInTheDocument();
  expect(screen.getByTitle('Send a GroupValueRead')).toBeInTheDocument();
  vi.unstubAllGlobals();
});

test('hides the notice when a project is loaded', () => {
  render(
    <FilterPanel
      options={EMPTY_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
    />
  );
  expect(screen.queryByText(/No ETS project loaded/i)).not.toBeInTheDocument();
});
