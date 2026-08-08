import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { BuildingOverlay as BuildingOverlayType } from './BuildingOverlay';

// The tree's expand/collapse state is deliberately persisted at module scope
// (mirrored to sessionStorage) so it survives the overlay unmounting — see
// utils/buildingExpansion.ts. That means it also persists across tests in this
// file unless reset: clear storage and re-import the module fresh each time.
let BuildingOverlay: typeof BuildingOverlayType;

beforeEach(async () => {
  sessionStorage.clear();
  vi.resetModules();
  ({ BuildingOverlay } = await import('./BuildingOverlay'));
});

const BUILDING_DATA = {
  status: 'ok',
  unassigned_devices: [],
  tree: [
    {
      kind: 'space',
      type: 'Building',
      name: 'Main House',
      spaces: [],
      devices: [
        {
          address: '1.1.1',
          name: 'Push Button',
          manufacturer: 'MDT',
          hardware: 'BE-GTM1TS.01',
          channels: [],
          kos: [
            {
              number: 1,
              name: 'Switch',
              text: 'Switching',
              function_text: '',
              dpts: [{ main: 1, sub: 1, name: '1.001 - Switch' }],
              flags: { transmit: true },
              group_addresses: [
                // Sending GA (listed first per ETS convention) shares the KO's own DPT.
                { address: '1/1/1', name: 'Switch GA', dpt: { main: 1, sub: 1, name: '1.001 - Switch' } },
                // Different DPT main category than the KO's own declared DPT (#307 mismatch).
                { address: '1/1/2', name: 'Status GA', dpt: { main: 5, sub: 1, name: '5.001 - Percent' } },
              ],
            },
          ],
        },
      ],
      functions: [
        {
          id: 'func1',
          name: 'Kitchen Light',
          type: 'FT-1',
          type_name: 'Licht schalten',
          group_addresses: [
            { address: '1/1/1', name: 'Switch GA', dpts: [{ main: 1, sub: 1, name: '1.001 - Switch' }] },
          ],
        },
      ],
    },
  ],
};

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) return { ok: true, json: async () => body } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const noop = () => {};

test('resolves and shows the ETS function-type name next to the function (#307)', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/building': BUILDING_DATA, '/api/telegrams/last': { telegrams: [] } }));

  render(
    <BuildingOverlay
      onClose={noop} onFilterDevice={noop} onFilterGAs={noop} onLastSeen={noop}
      onVisualizeGAs={noop} onDeviceStatus={noop}
    />
  );

  await waitFor(() => expect(screen.getByText('Kitchen Light')).toBeInTheDocument());
  expect(screen.getByText('Licht schalten')).toBeInTheDocument();
});

test('visualizing a function adds all its group addresses and opens the visualizer (#307)', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/building': BUILDING_DATA, '/api/telegrams/last': { telegrams: [] } }));
  const onVisualizeGAs = vi.fn();

  render(
    <BuildingOverlay
      onClose={noop} onFilterDevice={noop} onFilterGAs={noop} onLastSeen={noop}
      onVisualizeGAs={onVisualizeGAs} onDeviceStatus={noop}
    />
  );

  await waitFor(() => expect(screen.getByText('Kitchen Light')).toBeInTheDocument());
  fireEvent.click(screen.getByTitle('Visualize all 1 group address of this function'));
  expect(onVisualizeGAs).toHaveBeenCalledWith(['1/1/1']);
});

test('visualizing a device adds all its group addresses (#307)', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/building': BUILDING_DATA, '/api/telegrams/last': { telegrams: [] } }));
  const onVisualizeGAs = vi.fn();

  render(
    <BuildingOverlay
      onClose={noop} onFilterDevice={noop} onFilterGAs={noop} onLastSeen={noop}
      onVisualizeGAs={onVisualizeGAs} onDeviceStatus={noop}
    />
  );

  await waitFor(() => expect(screen.getByText('Push Button')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Push Button')); // expand the device
  fireEvent.click(screen.getByTitle('Visualize all 2 group addresses of this device'));
  expect(onVisualizeGAs).toHaveBeenCalledWith(['1/1/1', '1/1/2']);
});

test('comm object filter action uses the multi-GA icon, not the single-GA one (#307)', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/building': BUILDING_DATA, '/api/telegrams/last': { telegrams: [] } }));

  render(
    <BuildingOverlay
      onClose={noop} onFilterDevice={noop} onFilterGAs={noop} onLastSeen={noop}
      onVisualizeGAs={noop} onDeviceStatus={noop}
    />
  );

  await waitFor(() => expect(screen.getByText('Push Button')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Push Button'));
  expect(screen.getByTitle('Filter by connected group addresses')).toBeInTheDocument();
});

test('comm object header shows the DPT-family mismatch and the newest value, framed when sent from the sending GA (#307)', async () => {
  vi.stubGlobal('fetch', mockFetch({
    '/api/building': BUILDING_DATA,
    '/api/telegrams/last': {
      telegrams: [
        {
          timestamp: new Date().toISOString(),
          source_address: '1.1.9', source_name: 'Push Button',
          target_address: '1/1/1', target_name: 'Switch GA',
          telegram_type: 'GroupValueWrite', dpt: '1.001', dpt_main: 1, dpt_sub: 1, dpt_name: '1.001 - Switch',
          value_numeric: 1, value_json: null, value_formatted: 'On', raw_data: '01',
        },
      ],
    },
  }));

  render(
    <BuildingOverlay
      onClose={noop} onFilterDevice={noop} onFilterGAs={noop} onLastSeen={noop}
      onVisualizeGAs={noop} onDeviceStatus={noop}
    />
  );

  await waitFor(() => expect(screen.getByText('Push Button')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Push Button'));

  // The KO's own DPT is main category 1; one connected GA (1/1/2) is main category 5.
  await waitFor(() => expect(screen.getByText('5.*')).toBeInTheDocument());

  const valueEl = await screen.findByText('On');
  expect(valueEl.style.border).toContain('var(--accent-primary)'); // framed: newest telegram targets the sending GA
});

test('visualizing a single GA row inside the expanded comm-object table propagates through (#307)', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/building': BUILDING_DATA, '/api/telegrams/last': { telegrams: [] } }));
  const onVisualizeGAs = vi.fn();

  render(
    <BuildingOverlay
      onClose={noop} onFilterDevice={noop} onFilterGAs={noop} onLastSeen={noop}
      onVisualizeGAs={onVisualizeGAs} onDeviceStatus={noop}
    />
  );

  await waitFor(() => expect(screen.getByText('Push Button')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Push Button')); // expand device
  fireEvent.click(screen.getByText('Switching')); // expand the KO's GA table

  const row = (await screen.findByText('Status GA')).closest('tr')!;
  fireEvent.click(within(row).getByTitle('Visualize this group address'));
  expect(onVisualizeGAs).toHaveBeenCalledWith(['1/1/2']);
});
