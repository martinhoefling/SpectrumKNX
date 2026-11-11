import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import React from 'react';
import App from './App';
import { makeTelegram } from './test/telegramFactory';

// Mock the WebSocket hook
vi.mock('./hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    isConnected: true,
    telegrams: [],
  }),
}));

/** Controllable cache so pause/clear tests can leave the empty-buffer lock. */
vi.mock('./hooks/useTelegramCache', () => {
  return {
    useTelegramCache: () => {
      const [telegrams, setTelegrams] = React.useState(() => [makeTelegram({ raw_hex: '0xseed' })]);
      const [pausedCount, setPausedCount] = React.useState(0);
      const pausedRef = React.useRef(false);
      const backlogRef = React.useRef<ReturnType<typeof makeTelegram>[]>([]);
      return {
        telegrams,
        addLive: (t: ReturnType<typeof makeTelegram>) => {
          if (pausedRef.current) {
            backlogRef.current.push(t);
            setPausedCount(c => c + 1);
          } else {
            setTelegrams(prev => [t, ...prev]);
          }
        },
        setConnected: () => {},
        setPaused: (paused: boolean) => {
          if (pausedRef.current === paused) return;
          pausedRef.current = paused;
          setPausedCount(0);
          if (!paused && backlogRef.current.length > 0) {
            const batch = backlogRef.current;
            backlogRef.current = [];
            setTelegrams(prev => [...batch, ...prev]);
          }
        },
        pausedCount,
        loadRange: async () => {},
        isLoading: false,
        loadError: null,
        clear: async () => {
          backlogRef.current = [];
          setPausedCount(0);
          setTelegrams([]);
        },
      };
    },
  };
});

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
  expect(screen.getByRole('button', { name: 'Playing' })).toBeInTheDocument();
});

test('manual pause latches as Paused manually', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Playing' }));
  expect(screen.getByRole('button', { name: 'Paused manually' })).toBeInTheDocument();
});

test('Pause icon toggles Paused manually ↔ Paused automatically', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Playing' }));
  expect(screen.getByRole('button', { name: 'Paused manually' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Paused manually' }));
  expect(screen.getByRole('button', { name: 'Paused automatically' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Paused automatically' }));
  expect(screen.getByRole('button', { name: 'Paused manually' })).toBeInTheDocument();
});

test('clearing the buffer locks Paused manually while empty', async () => {
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Playing' })).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByTitle('Clear (also wipes the local telegram cache)'));
  });
  const pauseBtn = await screen.findByRole('button', { name: 'Paused manually' });
  expect(pauseBtn).toBeDisabled();
  fireEvent.click(pauseBtn);
  expect(screen.getByRole('button', { name: 'Paused manually' })).toBeDisabled();
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
