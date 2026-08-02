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

  // Active rows live in the "Active filters" view (#370), not shown by default.
  fireEvent.click(screen.getByRole('button', { name: 'Active filters' }));
  // One send trigger: the active GA target row (sources are PAs — no send).
  expect(screen.getAllByTitle('Send to this GA')).toHaveLength(1);

  const lastSeen = screen.getAllByTitle('Show last seen values');
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
  fireEvent.click(screen.getByRole('button', { name: 'Active filters' }));
  expect(screen.queryByTitle('Send to this GA')).not.toBeInTheDocument();
  expect(screen.getAllByTitle('Show last seen values')).toHaveLength(2);
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
  fireEvent.click(screen.getByRole('button', { name: 'Active filters' }));
  fireEvent.click(screen.getByTitle('Send to this GA'));
  // The popover shows the last value and the write/read controls.
  expect(await screen.findByText(/Last value/)).toBeInTheDocument();
  expect(screen.getByTitle('Send a GroupValueRead')).toBeInTheDocument();
  vi.unstubAllGlobals();
});

// ── Edit ↔ Active view + all-AND + master toggle (#370) ──────────────────────

test('toggles Edit ↔ Active views, keeps the count badge, and has no AND/OR control', () => {
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
      onQuickLastSeen={() => {}}
    />
  );
  const header = screen.getByText('Filter').parentElement!;

  // Default = Edit view: category sections shown, active rows hidden.
  expect(screen.getByText('Direction')).toBeInTheDocument();
  expect(screen.queryByTitle('Send to this GA')).not.toBeInTheDocument();
  expect(within(header).getByText('2')).toBeInTheDocument();
  // All filters AND now — no combination control (#275).
  expect(screen.queryByText(/Combine as/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'OR' })).not.toBeInTheDocument();

  // Switch to Active view: rows appear, category sections gone, badge stays.
  fireEvent.click(screen.getByRole('button', { name: 'Active filters' }));
  expect(screen.getByTitle('Send to this GA')).toBeInTheDocument();
  expect(screen.queryByText('Direction')).not.toBeInTheDocument();
  expect(within(header).getByText('2')).toBeInTheDocument();
});

test('master toggle disables the whole set (live only, #370)', () => {
  const onFiltersEnabledChange = vi.fn();
  const { rerender } = render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      filtersEnabled={true}
      onFiltersEnabledChange={onFiltersEnabledChange}
    />
  );
  fireEvent.click(screen.getByTitle('Disable all filters (keeps them)'));
  expect(onFiltersEnabledChange).toHaveBeenCalledWith(false);

  // Not offered in history mode (there the filter is the query).
  rerender(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="history"
      projectLoaded={true}
      filtersEnabled={true}
      onFiltersEnabledChange={onFiltersEnabledChange}
    />
  );
  expect(screen.queryByTitle(/Disable all filters|Enable filters/)).not.toBeInTheDocument();
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
