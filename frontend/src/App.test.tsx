import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import App from './App';

// Mock the WebSocket hook
vi.mock('./hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    isConnected: true,
    telegrams: [],
  }),
}));

// Mock fetch calls
vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
  Promise.resolve({
    json: () => Promise.resolve({}),
  })
));

test('renders app title', async () => {
  render(<App />);
  const titleElement = screen.getByText(/Spectrum KNX/i);
  expect(titleElement).toBeInTheDocument();
});

test('shows the five main-panel tabs with Telegram List active by default (#374)', async () => {
  render(<App />);
  const tabs = await screen.findAllByRole('tab');
  expect(tabs.map(t => t.getAttribute('title'))).toEqual([
    'Telegram List',
    'Visualization',
    'Statistics',
    'Building Structure',
    'Last Seen Values',
  ]);
  // 'list' is the default; every panel's close returns here.
  const list = screen.getByRole('tab', { name: 'Telegram List' });
  expect(list).toHaveAttribute('aria-selected', 'true');
});

test('play/pause and the filter toggle live with the Telegram List (#374)', async () => {
  render(<App />);
  // The list panel owns its own header with the filter toggle and play/pause.
  expect(await screen.findByRole('button', { name: 'Toggle filter panel' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
});

test('companion mode warns while Home Assistant\'s store holds pre-UTC timestamps (#462)', async () => {
  const fetchMock = vi.mocked(fetch);
  const original = fetchMock.getMockImplementation();
  const respondWith = (legacy: boolean) =>
    fetchMock.mockImplementation(((url: string) =>
      Promise.resolve({
        json: () => Promise.resolve(
          String(url).includes('/api/server/config')
            ? { mode: 'companion', status: { connected: true, write_enabled: false, legacy_timestamps: legacy } }
            : {},
        ),
      })) as unknown as typeof fetch);

  try {
    respondWith(true);
    const first = render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Telegram times may be wrong/);
    first.unmount();

    respondWith(false);
    render(<App />);
    await screen.findAllByRole('tab');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  } finally {
    fetchMock.mockImplementation(original!);
  }
});

test('Back and Forward step through panel changes', async () => {
  window.history.replaceState(null, '', '/');
  render(<App />);
  const selected = () => screen.getAllByRole('tab').find(t => t.getAttribute('aria-selected') === 'true')?.getAttribute('title');
  await screen.findAllByRole('tab');
  // Let the first sync pass: it only tidies the URL and adds no entry.
  await act(() => new Promise(r => setTimeout(r, 600)));
  const start = window.history.length;

  fireEvent.click(screen.getByRole('tab', { name: 'Visualization' }));
  await waitFor(() => expect(window.location.search).toContain('panel=visualizer'), { timeout: 2000 });
  fireEvent.click(screen.getByRole('tab', { name: 'Last Seen Values' }));
  await waitFor(() => expect(window.location.search).toContain('panel=lastseen'), { timeout: 2000 });
  expect(window.history.length).toBe(start + 2);

  act(() => window.history.back());
  await waitFor(() => expect(selected()).toBe('Visualization'));
  act(() => window.history.back());
  await waitFor(() => expect(selected()).toBe('Telegram List'));
  expect(window.location.search).toBe('');

  act(() => window.history.forward());
  await waitFor(() => expect(selected()).toBe('Visualization'));
  // Navigating must not have pushed anything itself.
  expect(window.history.length).toBe(start + 2);
});

test('toggling the filter pane updates the URL without a history entry', async () => {
  window.history.replaceState(null, '', '/');
  render(<App />);
  const toggle = await screen.findByRole('button', { name: 'Toggle filter panel' });
  await act(() => new Promise(r => setTimeout(r, 600)));
  const start = window.history.length;

  fireEvent.click(toggle);
  await waitFor(() => expect(window.location.search).toContain('fp=0'), { timeout: 2000 });
  expect(window.history.length).toBe(start);
});
