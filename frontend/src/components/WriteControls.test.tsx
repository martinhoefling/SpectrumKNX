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
