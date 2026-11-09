import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { WriteControls } from './WriteControls';

test('DPT 1 renders on/off as accent action buttons that write booleans (#218)', () => {
  const onWrite = vi.fn();
  render(<WriteControls dptMain={1} value="" onValueChange={() => {}} onWrite={onWrite} />);

  const on = screen.getByRole('button', { name: /^on$/i });
  const off = screen.getByRole('button', { name: /^off$/i });

  // Styled as filled accent action buttons (like Write), not passive tag chips.
  expect(on.style.background).toBe('var(--accent-primary)');
  expect(on.style.color).toBe('white');
  expect(on).toHaveTextContent('on');
  expect(off).toHaveTextContent('off');

  fireEvent.click(on);
  fireEvent.click(off);
  expect(onWrite).toHaveBeenNthCalledWith(1, true);
  expect(onWrite).toHaveBeenNthCalledWith(2, false);
});

test('multi-button send cells size to content then share leftover width', () => {
  const { container } = render(
    <WriteControls dptMain={1} value="" onValueChange={() => {}} onWrite={() => {}} />,
  );
  const send = screen.getByRole('button', { name: /^on$/i }).parentElement as HTMLElement;
  expect(send.style.gridTemplateColumns).toBe('repeat(2, minmax(max-content, 1fr))');
  expect(container.querySelectorAll('button').length).toBeGreaterThanOrEqual(2);
});

test('a 1-bit subtype renders its own values, not on/off', () => {
  const onWrite = vi.fn();
  const { rerender } = render(
    <WriteControls dptMain={1} dptKey="1.008" value="" onValueChange={() => {}} onWrite={onWrite} />,
  );

  expect(screen.queryByRole('button', { name: /^on$/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^up$/i }));
  fireEvent.click(screen.getByRole('button', { name: /^down$/i }));
  expect(onWrite).toHaveBeenNthCalledWith(1, false);
  expect(onWrite).toHaveBeenNthCalledWith(2, true);

  rerender(<WriteControls dptMain={1} dptKey="1.002" value="" onValueChange={() => {}} onWrite={onWrite} />);
  expect(screen.getByRole('button', { name: /^false$/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^true$/i })).toBeInTheDocument();
});

test('a 2-bit subtype offers the value with and without the control bit', () => {
  const onWrite = vi.fn();
  render(<WriteControls dptMain={2} dptKey="2.002" value="" onValueChange={() => {}} onWrite={onWrite} />);

  fireEvent.click(screen.getByRole('button', { name: /^true \(control\)$/i }));
  expect(onWrite).toHaveBeenCalledWith({ control: true, value: 'true' });
  expect(screen.queryByRole('button', { name: /^on$/i })).not.toBeInTheDocument();
});

test('a 4-bit control subtype lists only its legal direction and step codes', () => {
  const onWrite = vi.fn();
  render(<WriteControls dptMain={3} dptKey="3.008" value="" onValueChange={() => {}} onWrite={onWrite} />);

  fireEvent.click(screen.getByRole('button', { name: 'Value' }));
  const list = screen.getByRole('listbox', { name: 'Value' });
  const labels = [...list.querySelectorAll('[role="option"]')].map(option => option.textContent);
  expect(labels).toContain('up 0');
  expect(labels).toContain('down 7');
  expect(labels).toHaveLength(16);
  expect(labels.some(label => /^(on|off)$/i.test(label ?? ''))).toBe(false);

  fireEvent.mouseDown(screen.getByRole('option', { name: 'down 0' }));
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  expect(onWrite).toHaveBeenCalledWith({ control: 'down', step_code: 0 });
});

test('changing the DPT resets the select to its first entry', () => {
  const { rerender } = render(
    <WriteControls dptMain={3} dptKey="3.008" value="" onValueChange={() => {}} onWrite={() => {}} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Value' }));
  fireEvent.mouseDown(screen.getByRole('option', { name: 'down 0' }));
  expect(screen.getByRole('button', { name: 'Value' })).toHaveTextContent('down 0');

  rerender(<WriteControls dptMain={3} dptKey="3.007" value="" onValueChange={() => {}} onWrite={() => {}} />);
  expect(screen.getByRole('button', { name: 'Value' })).toHaveTextContent('decrease 0');
});

test('non-DPT-1 renders a value field and a Write button', () => {
  const onWrite = vi.fn();
  render(<WriteControls dptMain={5} value="50" onValueChange={() => {}} onWrite={onWrite} />);

  expect(screen.getByPlaceholderText('Value')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  expect(onWrite).toHaveBeenCalledWith(50);
  expect(screen.queryByRole('button', { name: /^on$/i })).not.toBeInTheDocument();
});

test('free-value placeholder stays short so the column can measure content width', () => {
  render(<WriteControls dptMain={5} value="" onValueChange={() => {}} onWrite={() => {}} />);
  const input = screen.getByPlaceholderText('Value');
  expect(input).toHaveAttribute('placeholder', 'Value');
  expect(input.getAttribute('placeholder')).not.toMatch(/e\.g\./);
});

test('value choice select keeps the chevron right-aligned', () => {
  const { container } = render(
    <WriteControls dptMain={3} dptKey="3.008" value="" onValueChange={() => {}} onWrite={() => {}} />,
  );
  const trigger = screen.getByRole('button', { name: 'Value' });
  const chevron = trigger.querySelector('svg');
  expect(chevron).not.toBeNull();
  expect(chevron).toHaveStyle({ marginLeft: 'auto' });
  expect(trigger).not.toHaveStyle({ minWidth: '120px' });
  expect(container.querySelector('[aria-label="Value"]')).toBe(trigger);
});

test('numeric free values are right-aligned against the unit sibling', () => {
  const { container } = render(
    <WriteControls dptMain={9} dptKey="9.001" value="21.5" unit="°C" onValueChange={() => {}} onWrite={() => {}} />,
  );
  const shell = container.querySelector('[data-value-field]') as HTMLElement;
  const input = screen.getByLabelText('Value');
  expect(shell).toHaveStyle({ width: '100%' });
  expect(input).toHaveStyle({ textAlign: 'right' });
  expect(input.nextElementSibling).toHaveTextContent('°C');
});

test('text DPTs stay left-aligned in the value shell', () => {
  render(<WriteControls dptMain={16} value="hello" onValueChange={() => {}} onWrite={() => {}} />);
  expect(screen.getByLabelText('Value')).toHaveStyle({ textAlign: 'left' });
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
