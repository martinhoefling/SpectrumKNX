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

/** Test handle into the mocked cache: inject live telegrams, observe reveals. */
const cacheCtl = vi.hoisted(() => ({
  addLive: null as null | ((t: { timestamp: string }) => void),
  revealCalls: [] as number[],
  /** Per-test hook run on every reveal (e.g. to simulate the row pin). */
  onReveal: null as null | ((n: number) => void),
}));

/** Controllable cache so pause/clear tests can leave the empty-buffer lock. */
vi.mock('./hooks/useTelegramCache', () => {
  return {
    useTelegramCache: () => {
      const [telegrams, setTelegrams] = React.useState(() => [makeTelegram({ raw_hex: '0xseed' })]);
      const [pausedCount, setPausedCount] = React.useState(0);
      const pausedRef = React.useRef(false);
      const backlogRef = React.useRef<ReturnType<typeof makeTelegram>[]>([]);
      const addLive = (t: ReturnType<typeof makeTelegram>) => {
        if (pausedRef.current) {
          backlogRef.current.push(t);
          setPausedCount(c => c + 1);
        } else {
          setTelegrams(prev => [t, ...prev]);
        }
      };
      cacheCtl.addLive = addLive as (t: { timestamp: string }) => void;
      return {
        telegrams,
        addLive,
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
        revealPaused: (n: number) => {
          cacheCtl.revealCalls.push(n);
          if (!pausedRef.current || n <= 0) return backlogRef.current.length;
          const batch = backlogRef.current.splice(0, n);
          cacheCtl.onReveal?.(batch.length);
          if (batch.length > 0) setTelegrams(prev => [...batch.reverse(), ...prev]);
          const remaining = backlogRef.current.length;
          setPausedCount(remaining);
          return remaining;
        },
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

test('auto-pause backlog is fed in slices by fill-axis wheels and resumes playing once drained', async () => {
  cacheCtl.revealCalls.length = 0;
  const { container } = render(<App />);
  expect(await screen.findByRole('button', { name: 'Playing' })).toBeInTheDocument();
  const port = container.querySelector('.custom-scrollbar') as HTMLElement;
  // jsdom has no layout: give the scrollport a real range so edge / rubber
  // zone checks behave (scrollTop 60 is "at the live edge", not overscrolled).
  Object.defineProperty(port, 'scrollHeight', { configurable: true, get: () => 2000 });
  Object.defineProperty(port, 'clientHeight', { configurable: true, get: () => 800 });
  // Let the mount-time scrollToEdge's programmatic mark expire.
  await act(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

  // Scrolling away from the live edge unfollows → auto pause.
  await act(async () => {
    port.scrollTop = 500;
    fireEvent.scroll(port);
  });
  expect(screen.getByRole('button', { name: 'Paused automatically' })).toBeInTheDocument();

  // Five telegrams arrive into the frozen snapshot.
  const base = Date.now();
  await act(async () => {
    for (let i = 0; i < 5; i++) {
      cacheCtl.addLive!(makeTelegram({ timestamp: new Date(base + i * 1000).toISOString(), raw_hex: `0xb${i}` }));
    }
  });
  expect(screen.getByRole('button', { name: '5 newer telegrams' })).toBeInTheDocument();

  // Back at the live edge, a small wheel toward newer reveals a slice (not all).
  await act(async () => {
    port.scrollTop = 60;
    fireEvent.scroll(port);
  });
  await act(async () => {
    fireEvent.wheel(port, { deltaY: -5 });
  });
  expect(cacheCtl.revealCalls).toEqual([2]);
  expect(screen.getByRole('button', { name: 'Paused automatically' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '3 newer telegrams' })).toBeInTheDocument();

  // Further slices drain the backlog; the last one resumes playing.
  await act(async () => {
    fireEvent.wheel(port, { deltaY: -5 });
  });
  expect(cacheCtl.revealCalls).toEqual([2, 2]);
  expect(screen.getByRole('button', { name: 'Paused automatically' })).toBeInTheDocument();
  await act(async () => {
    fireEvent.wheel(port, { deltaY: -5 });
  });
  expect(cacheCtl.revealCalls).toEqual([2, 2, 1]);
  expect(screen.getByRole('button', { name: 'Playing' })).toBeInTheDocument();
});

test('manual → auto pause with the fill spacer on screen reveals one backlog row, not the whole backlog', async () => {
  cacheCtl.revealCalls.length = 0;
  const { container } = render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Playing' }));
  expect(screen.getByRole('button', { name: 'Paused manually' })).toBeInTheDocument();
  const port = container.querySelector('.custom-scrollbar') as HTMLElement;
  Object.defineProperty(port, 'scrollHeight', { configurable: true, get: () => 2000 });
  Object.defineProperty(port, 'clientHeight', { configurable: true, get: () => 800 });
  // jsdom rows have no height, so the table's pin is a no-op: simulate it by
  // moving scrollTop by the height of the rows prepended above the edge row.
  cacheCtl.onReveal = n => { port.scrollTop += n * 85; };
  await act(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

  const base = Date.now();
  await act(async () => {
    for (let i = 0; i < 3; i++) {
      cacheCtl.addLive!(makeTelegram({ timestamp: new Date(base + i * 1000).toISOString(), raw_hex: `0xm${i}` }));
    }
  });
  expect(screen.getByRole('button', { name: '3 newer telegrams' })).toBeInTheDocument();

  // Fill spacer fully on screen: manual pause holds it (labels, no reveal).
  await act(async () => {
    port.scrollTop = 0;
    fireEvent.scroll(port);
  });
  expect(screen.getByTestId('fill-rubber-pause-label-left')).toHaveTextContent('...paused manually...');
  expect(cacheCtl.revealCalls).toEqual([]);

  // Switching to auto pause fills the slot with the oldest backlog row only.
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Paused manually' }));
  });
  try {
    expect(screen.getByRole('button', { name: 'Paused automatically' })).toBeInTheDocument();
    expect(cacheCtl.revealCalls).toEqual([1]);
    expect(screen.getByRole('button', { name: '2 newer telegrams' })).toBeInTheDocument();
    // The previous edge row kept its place: no snap to the settled edge.
    expect(port.scrollTop).toBe(85);
  } finally {
    cacheCtl.onReveal = null;
  }
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
