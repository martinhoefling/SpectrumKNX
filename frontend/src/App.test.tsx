import { render, screen } from '@testing-library/react';
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
