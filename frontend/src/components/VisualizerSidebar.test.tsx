import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { VisualizerSidebar } from './VisualizerSidebar';
import { makeTelegram } from '../test/telegramFactory';

const telegrams = [
  makeTelegram({ target_address: '1/2/3', target_name: 'Light' }),
  makeTelegram({ target_address: '1/2/4', target_name: 'Blind' }),
];

test('the header button clears all selected targets and shows how many (#347)', () => {
  const onTargetsChange = vi.fn();
  render(
    <VisualizerSidebar
      telegrams={telegrams}
      selectedTargets={['1/2/3', '1/2/4']}
      onTargetsChange={onTargetsChange}
    />,
  );

  const clearBtn = screen.getByTitle('Clear all selected targets');
  expect(clearBtn).toHaveTextContent('2');
  fireEvent.click(clearBtn);
  expect(onTargetsChange).toHaveBeenCalledWith([]);
});

test('no clear button — and nothing resembling a close button — when no targets are selected', () => {
  render(
    <VisualizerSidebar
      telegrams={telegrams}
      selectedTargets={[]}
      onTargetsChange={vi.fn()}
    />,
  );

  expect(screen.queryByTitle('Clear all selected targets')).not.toBeInTheDocument();
});
