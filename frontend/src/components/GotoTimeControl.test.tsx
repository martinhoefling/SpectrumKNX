import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { format } from 'date-fns';
import { GotoTimeControl } from './GotoTimeControl';

afterEach(() => {
  vi.restoreAllMocks();
});

const seed = new Date('2026-07-20T14:30:15').getTime();

test('opens a popover seeded with the newest telegram time', () => {
  render(<GotoTimeControl seedMs={seed} onGoto={() => {}} />);

  // Popover is closed initially.
  expect(screen.queryByRole('button', { name: 'Go' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Go to time' }));

  const input = screen.getByLabelText('Target time') as HTMLInputElement;
  // Seeded to the newest telegram time (jsdom normalizes to ms precision).
  expect(input.value.startsWith(format(seed, "yyyy-MM-dd'T'HH:mm:ss"))).toBe(true);
  expect(new Date(input.value).getTime()).toBe(seed);
});

test('submits the entered time as epoch ms via the Go button', () => {
  const onGoto = vi.fn();
  render(<GotoTimeControl seedMs={seed} onGoto={onGoto} />);

  fireEvent.click(screen.getByRole('button', { name: 'Go to time' }));
  const input = screen.getByLabelText('Target time');
  fireEvent.change(input, { target: { value: '2026-07-20T09:05:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Go' }));

  expect(onGoto).toHaveBeenCalledTimes(1);
  expect(onGoto).toHaveBeenCalledWith(new Date('2026-07-20T09:05:00').getTime());
  // Popover closes after submit.
  expect(screen.queryByRole('button', { name: 'Go' })).not.toBeInTheDocument();
});

test('Enter in the input submits the time', () => {
  const onGoto = vi.fn();
  render(<GotoTimeControl seedMs={seed} onGoto={onGoto} />);

  fireEvent.click(screen.getByRole('button', { name: 'Go to time' }));
  const input = screen.getByLabelText('Target time');
  fireEvent.change(input, { target: { value: '2026-07-20T10:00:00' } });
  fireEvent.keyDown(input, { key: 'Enter' });

  expect(onGoto).toHaveBeenCalledWith(new Date('2026-07-20T10:00:00').getTime());
});

test('Escape closes the popover without submitting', () => {
  const onGoto = vi.fn();
  render(<GotoTimeControl seedMs={seed} onGoto={onGoto} />);

  fireEvent.click(screen.getByRole('button', { name: 'Go to time' }));
  expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();

  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('button', { name: 'Go' })).not.toBeInTheDocument();
  expect(onGoto).not.toHaveBeenCalled();
});

test('Go is disabled when there is no seed time', () => {
  render(<GotoTimeControl seedMs={null} onGoto={() => {}} />);

  fireEvent.click(screen.getByRole('button', { name: 'Go to time' }));
  expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
});
