import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { DeviceStatusOverlay } from './DeviceStatusOverlay';
import type { DeviceNode } from './BuildingOverlay';
import type { Telegram } from '../hooks/useWebSocket';

const DEVICE: DeviceNode = {
  address: '1.1.5',
  name: 'Switch Actuator',
  manufacturer: 'ACME',
  hardware: 'SA/S 4.16',
  channels: [
    {
      id: 'ch1',
      name: 'Channel A',
      kos: [
        {
          number: 10,
          name: 'Switch',
          text: 'Switch',
          function_text: 'On/Off',
          dpts: [{ main: 1, sub: 1, name: '1.001 - Switch' }],
          group_addresses: [{ address: '1/2/3', name: 'Kitchen Light' }],
        },
      ],
    },
  ],
  kos: [
    {
      number: 11,
      name: 'Status',
      text: 'Status',
      function_text: '',
      dpts: [{ main: 1, sub: 11, name: '1.011 - State' }],
      group_addresses: [{ address: '1/2/4', name: 'Kitchen Light Status' }],
    },
  ],
};

function telegram(target: string, value: string): Telegram {
  return {
    timestamp: new Date().toISOString(),
    source_address: '1.1.9',
    source_name: 'Push Button',
    target_address: target,
    telegram_type: 'GroupValueWrite',
    dpt: '1.001',
    dpt_main: 1,
    dpt_sub: 1,
    dpt_name: '1.001 - Switch',
    value_numeric: 1,
    value_json: null,
    value_formatted: value,
    raw_data: '01',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('loads latest values per GA and renders one row per KO group address', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    expect(url).toContain('/api/telegrams/last');
    expect(decodeURIComponent(url)).toContain('1/2/3,1/2/4');
    return { ok: true, json: async () => ({ telegrams: [telegram('1/2/3', 'On')] }) } as Response;
  }));

  render(<DeviceStatusOverlay device={DEVICE} latestTelegram={null} onClose={() => {}} />);

  await waitFor(() => expect(screen.getByText('On')).toBeInTheDocument());
  // KO 11's GA has no stored telegram yet
  expect(screen.getByText('never seen')).toBeInTheDocument();
  expect(screen.getByText('Channel A')).toBeInTheDocument();
  expect(screen.getByText('1/2/4')).toBeInTheDocument();
});

test('updates a value live from the websocket feed', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => (
    { ok: true, json: async () => ({ telegrams: [telegram('1/2/3', 'On')] }) } as Response
  )));

  const { rerender } = render(
    <DeviceStatusOverlay device={DEVICE} latestTelegram={null} onClose={() => {}} />
  );
  await waitFor(() => expect(screen.getByText('On')).toBeInTheDocument());

  rerender(
    <DeviceStatusOverlay device={DEVICE} latestTelegram={telegram('1/2/4', 'Off')} onClose={() => {}} />
  );
  await waitFor(() => expect(screen.getByText('Off')).toBeInTheDocument());
  expect(screen.queryByText('never seen')).not.toBeInTheDocument();

  // Telegrams for unrelated GAs are ignored
  rerender(
    <DeviceStatusOverlay device={DEVICE} latestTelegram={telegram('9/9/9', 'Ignored')} onClose={() => {}} />
  );
  expect(screen.queryByText('Ignored')).not.toBeInTheDocument();
});

test('collapses channel when clicked, showing and hiding KOs', async () => {
  const onLastSeenMock = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => (
    { ok: true, json: async () => ({ telegrams: [telegram('1/2/3', 'On')] }) } as Response
  )));

  render(
    <DeviceStatusOverlay
      device={DEVICE}
      latestTelegram={null}
      onClose={() => {}}
      onLastSeen={onLastSeenMock}
    />
  );

  // Initially Channel A and KOs are visible
  await waitFor(() => expect(screen.getByText('On')).toBeInTheDocument());
  expect(screen.getByText('Channel A')).toBeInTheDocument();
  expect(screen.getByText('Switch')).toBeInTheDocument();

  // Click channel row to collapse it
  fireEvent.click(screen.getByText('Channel A'));

  // It should collapse, hiding the KO inside it
  await waitFor(() => expect(screen.queryByText('Switch')).not.toBeInTheDocument());

  // Click again to expand
  fireEvent.click(screen.getByText('Channel A'));
  await waitFor(() => expect(screen.getByText('Switch')).toBeInTheDocument());
});

test('calls onLastSeen when clock history button is clicked', async () => {
  const onLastSeenMock = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => (
    { ok: true, json: async () => ({ telegrams: [telegram('1/2/3', 'On')] }) } as Response
  )));

  render(
    <DeviceStatusOverlay
      device={DEVICE}
      latestTelegram={null}
      onClose={() => {}}
      onLastSeen={onLastSeenMock}
    />
  );

  await waitFor(() => expect(screen.getByText('On')).toBeInTheDocument());

  const gaRow = screen.getByText('1/2/3').closest('div')?.parentElement;
  expect(gaRow).toBeTruthy();
  const historyBtn = within(gaRow!).getByTitle('Show history log');
  fireEvent.click(historyBtn);

  expect(onLastSeenMock).toHaveBeenCalledWith('1/2/3', 'ga');
});
