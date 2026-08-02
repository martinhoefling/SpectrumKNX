import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { UpdateNotification } from './UpdateNotification';
import type { UpdateInfo } from '../hooks/useUpdateCheck';

const INFO: UpdateInfo = {
  enabled: true,
  current: 'v1.10.0',
  latest: 'v1.11.0',
  update_available: true,
  html_url: 'https://github.com/x/y/releases/tag/v1.11.0',
  published_at: '2026-07-09T00:00:00Z',
  releases: [
    { version: 'v1.11.0', name: 'v1.11.0', notes: 'Added **cool** thing', html_url: 'https://github.com/x/y/releases/tag/v1.11.0', published_at: '2026-07-09T00:00:00Z' },
  ],
};

test('renders the new version, notes and a GitHub link', () => {
  render(<UpdateNotification info={INFO} onClose={() => {}} />);

  // Version shows in both the header and the release title.
  expect(screen.getAllByText('v1.11.0').length).toBeGreaterThanOrEqual(1);
  // Markdown is rendered (bold element present).
  expect(screen.getByText('cool').tagName.toLowerCase()).toBe('strong');
  const link = screen.getByRole('link', { name: /View on GitHub/i });
  expect(link).toHaveAttribute('href', INFO.html_url);
});

test('calls onClose when dismissed', () => {
  const onClose = vi.fn();
  render(<UpdateNotification info={INFO} onClose={onClose} />);
  fireEvent.click(screen.getByTitle('Dismiss'));
  expect(onClose).toHaveBeenCalledTimes(1);
});
