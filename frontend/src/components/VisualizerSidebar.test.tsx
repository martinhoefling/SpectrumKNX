import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { VisualizerSidebar } from './VisualizerSidebar';
import { makeTelegram } from '../test/telegramFactory';

const telegrams = [
  makeTelegram({ target_address: '1/2/3', target_name: 'Light' }),
  makeTelegram({ target_address: '1/2/4', target_name: 'Blind' }),
];

test('the header X clears all selected targets rather than closing the panel (#347)', () => {
  const onTargetsChange = vi.fn();
  render(
    <VisualizerSidebar
      telegrams={telegrams}
      selectedTargets={['1/2/3', '1/2/4']}
      onTargetsChange={onTargetsChange}
    />,
  );

  const clearBtn = screen.getByTitle('Clear all selected targets');
  expect(clearBtn).not.toBeDisabled();
  fireEvent.click(clearBtn);
  expect(onTargetsChange).toHaveBeenCalledWith([]);
});

test('the clear button is disabled when no targets are selected (#347)', () => {
  render(
    <VisualizerSidebar
      telegrams={telegrams}
      selectedTargets={[]}
      onTargetsChange={vi.fn()}
    />,
  );

  expect(screen.getByTitle('Clear all selected targets')).toBeDisabled();
});
