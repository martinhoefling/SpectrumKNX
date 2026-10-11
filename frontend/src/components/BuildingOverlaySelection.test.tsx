import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { BuildingOverlay as BuildingOverlayType } from './BuildingOverlay';

// Tick state lives at module scope mirrored to sessionStorage (see
// utils/buildingSelection.ts), so start each test from a fresh module.
let BuildingOverlay: typeof BuildingOverlayType;

beforeEach(async () => {
  sessionStorage.clear();
  vi.resetModules();
  ({ BuildingOverlay } = await import('./BuildingOverlay'));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => BUILDING }) as Response));
});

afterEach(() => vi.unstubAllGlobals());

const device = (address: string, name: string) => ({ address, name, manufacturer: 'MDT', hardware: '', channels: [], kos: [] });
const room = (name: string, devices: unknown[], functions: unknown[] = []) => ({ kind: 'space', type: 'Room', name, spaces: [], devices, functions });

const BUILDING = {
  status: 'ok',
  unassigned_devices: [device('9.9.9', 'Loose Device')],
  tree: [
    {
      kind: 'space', type: 'Building', name: 'House', devices: [], functions: [],
      spaces: [
        { kind: 'space', type: 'Floor', name: 'Ground Floor', devices: [], functions: [], spaces: [
          room('Kitchen', [device('1.1.1', 'Push Button'), device('1.1.2', 'Dimmer')], [
            { id: 'f1', name: 'Kitchen Light', type: 'FT-1', type_name: 'Light', group_addresses: [] },
          ]),
          room('Hall', [device('1.1.3', 'Presence Sensor')]),
        ] },
        { kind: 'space', type: 'Floor', name: 'Attic', devices: [], functions: [], spaces: [
          room('Storage', [device('1.2.1', 'Switch Actuator')]),
          room('Office', [device('1.2.2', 'Heating Actuator')]),
        ] },
      ],
    },
  ],
};

const props = { onClose: vi.fn(), onFilterDevice: vi.fn(), onFilterGAs: vi.fn(), onLastSeen: vi.fn(), onVisualizeGAs: vi.fn(), onDeviceStatus: vi.fn() };

const renderOverlay = async () => {
  const view = render(<BuildingOverlay {...props} />);
  await screen.findByText('House');
  return view;
};

const openAll = () => {
  for (const name of ['Kitchen', 'Hall', 'Storage', 'Office']) fireEvent.click(screen.getByText(name));
};

test('ticking devices and hiding the rest leaves only those devices and their rooms (#505)', async () => {
  await renderOverlay();
  openAll();

  // Nothing ticked: no toggle yet.
  expect(screen.queryByText(/Only ticked/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByLabelText('Select device 1.1.1'));
  fireEvent.click(screen.getByLabelText('Select device 1.2.1'));

  // Ticking alone hides nothing.
  expect(screen.getByText('Dimmer')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Only ticked (2)'));

  expect(screen.getByText('Push Button')).toBeInTheDocument();
  expect(screen.getByText('Switch Actuator')).toBeInTheDocument();
  for (const hidden of ['Dimmer', 'Presence Sensor', 'Heating Actuator', 'Loose Device', 'Hall', 'Office', 'Kitchen Light', 'Unassigned Devices']) {
    expect(screen.queryByText(hidden)).not.toBeInTheDocument();
  }
  // The path to each ticked device stays.
  for (const kept of ['House', 'Ground Floor', 'Kitchen', 'Attic', 'Storage']) {
    expect(screen.getByText(kept)).toBeInTheDocument();
  }

  // Switching it off brings everything back.
  fireEvent.click(screen.getByText('Only ticked (2)'));
  expect(screen.getByText('Dimmer')).toBeInTheDocument();
  expect(screen.getByText('Loose Device')).toBeInTheDocument();
});

test('ticked devices in collapsed rooms are brought into view', async () => {
  await renderOverlay();
  fireEvent.click(screen.getByText('Storage'));
  fireEvent.click(screen.getByLabelText('Select device 1.2.1'));
  fireEvent.click(screen.getByText('Storage')); // collapse it again
  expect(screen.queryByText('Switch Actuator')).not.toBeInTheDocument();

  fireEvent.click(screen.getByText('Only ticked (1)'));
  expect(screen.getByText('Switch Actuator')).toBeInTheDocument();
});

test('ticking a device does not expand or collapse it', async () => {
  await renderOverlay();
  fireEvent.click(screen.getByText('Kitchen'));
  const box = screen.getByLabelText('Select device 1.1.1') as HTMLInputElement;
  fireEvent.click(box);
  expect(box.checked).toBe(true);
  expect(screen.getByText('Push Button')).toBeInTheDocument();
});

test('unticking the last device shows the whole building again', async () => {
  await renderOverlay();
  openAll();
  fireEvent.click(screen.getByLabelText('Select device 1.1.1'));
  fireEvent.click(screen.getByText('Only ticked (1)'));
  expect(screen.queryByText('Dimmer')).not.toBeInTheDocument();

  fireEvent.click(screen.getByLabelText('Select device 1.1.1'));
  expect(screen.getByText('Dimmer')).toBeInTheDocument();
  expect(screen.queryByText(/Only ticked/)).not.toBeInTheDocument();
});

test('"untick all" clears the selection and the hiding', async () => {
  await renderOverlay();
  openAll();
  fireEvent.click(screen.getByLabelText('Select device 1.1.1'));
  fireEvent.click(screen.getByText('Only ticked (1)'));
  fireEvent.click(screen.getByTitle('Untick all devices'));

  expect(screen.getByText('Dimmer')).toBeInTheDocument();
  expect((screen.getByLabelText('Select device 1.1.1') as HTMLInputElement).checked).toBe(false);
});

test('the selection survives leaving and reopening the panel', async () => {
  const first = await renderOverlay();
  openAll();
  fireEvent.click(screen.getByLabelText('Select device 1.1.1'));
  fireEvent.click(screen.getByText('Only ticked (1)'));
  first.unmount();

  await renderOverlay();
  await waitFor(() => expect(screen.getByText('Only ticked (1)')).toBeInTheDocument());
  expect(screen.getByText('Push Button')).toBeInTheDocument();
  expect(screen.queryByText('Dimmer')).not.toBeInTheDocument();
});

test('the search still applies within the ticked devices', async () => {
  await renderOverlay();
  openAll();
  fireEvent.click(screen.getByLabelText('Select device 1.1.1'));
  fireEvent.click(screen.getByLabelText('Select device 1.2.1'));
  fireEvent.click(screen.getByText('Only ticked (2)'));

  fireEvent.change(screen.getByPlaceholderText('Filter…'), { target: { value: 'actuator' } });
  expect(screen.getByText('Switch Actuator')).toBeInTheDocument();
  expect(screen.queryByText('Push Button')).not.toBeInTheDocument();
  expect(screen.queryByText('Heating Actuator')).not.toBeInTheDocument();
});
