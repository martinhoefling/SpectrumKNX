import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { VisualizerSidebar } from './VisualizerSidebar';
import { makeTelegram } from '../test/telegramFactory';
import { getPref } from '../utils/prefs';

const telegrams = [
  makeTelegram({ target_address: '1/2/3', target_name: 'Light' }),
  makeTelegram({ target_address: '1/2/4', target_name: 'Blind' }),
];

const sidebar = () => (
  <VisualizerSidebar
    telegrams={telegrams}
    selectedTargets={[]}
    onTargetsChange={() => {}}
    onClose={() => {}}
  />
);

afterEach(() => localStorage.clear());

test('persists the Targets search across panel remounts via prefs (#361)', () => {
  const { unmount } = render(sidebar());
  fireEvent.change(screen.getByPlaceholderText('Search targets...'), { target: { value: '1/2' } });
  expect(getPref('vizTargetSearch')).toBe('1/2');
  unmount();

  // Reopening the panel restores the persisted filter.
  render(sidebar());
  expect(screen.getByPlaceholderText('Search targets...')).toHaveValue('1/2');
});
