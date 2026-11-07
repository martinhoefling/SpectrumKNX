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

test('a 1-bit subtype renders its own values, not On/Off', () => {
  const onWrite = vi.fn();
  const { rerender } = render(
    <WriteControls dptMain={1} dptKey="1.008" value="" onValueChange={() => {}} onWrite={onWrite} />,
  );

  expect(screen.queryByRole('button', { name: /^On$/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Up$/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Down$/ }));
  expect(onWrite).toHaveBeenNthCalledWith(1, false);
  expect(onWrite).toHaveBeenNthCalledWith(2, true);

  rerender(<WriteControls dptMain={1} dptKey="1.002" value="" onValueChange={() => {}} onWrite={onWrite} />);
  expect(screen.getByRole('button', { name: /^False$/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^True$/ })).toBeInTheDocument();
});

test('a 2-bit subtype offers the value with and without the control bit', () => {
  const onWrite = vi.fn();
  render(<WriteControls dptMain={2} dptKey="2.002" value="" onValueChange={() => {}} onWrite={onWrite} />);

  fireEvent.click(screen.getByRole('button', { name: /^True \(control\)$/ }));
  expect(onWrite).toHaveBeenCalledWith({ control: true, value: 'true' });
  expect(screen.queryByRole('button', { name: /^On$/ })).not.toBeInTheDocument();
});

test('a 4-bit control subtype lists only its legal direction and step codes', () => {
  const onWrite = vi.fn();
  render(<WriteControls dptMain={3} dptKey="3.008" value="" onValueChange={() => {}} onWrite={onWrite} />);

  const select = screen.getByRole('combobox', { name: 'Value' });
  const labels = [...select.querySelectorAll('option')].map(option => option.textContent);
  expect(labels).toContain('Up 0');
  expect(labels).toContain('Down 7');
  expect(labels).toHaveLength(16);
  expect(labels.some(label => /On|Off/.test(label ?? ''))).toBe(false);

  fireEvent.change(select, { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  expect(onWrite).toHaveBeenCalledWith({ control: 'down', step_code: 0 });
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

test('DPT 16/28 (string) allow sending an empty value (#410)', () => {
  const onWrite = vi.fn();
  render(<WriteControls dptMain={16} value="" onValueChange={() => {}} onWrite={onWrite} />);

  const writeBtn = screen.getByRole('button', { name: /Write/ });
  expect(writeBtn).not.toBeDisabled();
  fireEvent.click(writeBtn);
  expect(onWrite).toHaveBeenCalledWith('');
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
