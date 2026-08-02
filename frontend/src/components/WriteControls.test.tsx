import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { WriteControls } from './WriteControls';

test('DPT 1 renders On/Off as accent action buttons that write booleans (#218)', () => {
  const onWrite = vi.fn();
  render(<WriteControls dptMain={1} value="" onValueChange={() => {}} onWrite={onWrite} />);

  const on = screen.getByRole('button', { name: /On/ });
  const off = screen.getByRole('button', { name: /Off/ });

  // Styled as filled accent action buttons (like Write), not passive tag chips.
  expect(on.style.background).toBe('var(--accent-primary)');
  expect(on.style.color).toBe('white');

  fireEvent.click(on);
  fireEvent.click(off);
  expect(onWrite).toHaveBeenNthCalledWith(1, true);
  expect(onWrite).toHaveBeenNthCalledWith(2, false);
});

test('non-DPT-1 renders a value field and a Write button', () => {
  const onWrite = vi.fn();
  render(<WriteControls dptMain={5} value="50" onValueChange={() => {}} onWrite={onWrite} />);

  expect(screen.getByPlaceholderText(/Value/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  expect(onWrite).toHaveBeenCalledWith(50);
  expect(screen.queryByRole('button', { name: /^On$/ })).not.toBeInTheDocument();
});

test('Write is disabled while the value is empty', () => {
  render(<WriteControls dptMain={5} value="   " onValueChange={() => {}} onWrite={() => {}} />);
  expect(screen.getByRole('button', { name: /Write/ })).toBeDisabled();
});

test('DPT 10 renders a time input field and handles write', () => {
  const onWrite = vi.fn();
  const onValueChange = vi.fn();
  const { container } = render(<WriteControls dptMain={10} value="12:30:00" onValueChange={onValueChange} onWrite={onWrite} />);

  const input = container.querySelector('input[type="time"]');
  expect(input).toBeInTheDocument();
  expect(input).toHaveValue('12:30:00');

  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  expect(onWrite).toHaveBeenCalledWith('12:30:00');
});

test('DPT 11 renders a date input field and handles write', () => {
  const onWrite = vi.fn();
  const { container } = render(<WriteControls dptMain={11} value="2026-07-18" onValueChange={() => {}} onWrite={onWrite} />);

  const input = container.querySelector('input[type="date"]');
  expect(input).toBeInTheDocument();
  expect(input).toHaveValue('2026-07-18');

  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  expect(onWrite).toHaveBeenCalledWith('2026-07-18');
});

test('DPT 19 renders a datetime-local input field and handles write', () => {
  const onWrite = vi.fn();
  const { container } = render(<WriteControls dptMain={19} value="2026-07-18T12:30" onValueChange={() => {}} onWrite={onWrite} />);

  const input = container.querySelector('input[type="datetime-local"]');
  expect(input).toBeInTheDocument();
  expect(input).toHaveValue('2026-07-18T12:30');

  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  expect(onWrite).toHaveBeenCalledWith('2026-07-18T12:30');
});
