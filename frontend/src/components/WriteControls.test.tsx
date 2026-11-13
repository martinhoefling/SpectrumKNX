import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { resetDiscreteLabelModes } from '../utils/dptValues';
import { WriteControls, needsValueColumn, readModeButtonMuted, valueSendMuted } from './WriteControls';

beforeEach(() => {
  localStorage.clear();
  resetDiscreteLabelModes();
});

test('Response follows the write button that sends the job value', () => {
  const writeOn = { read: false, payload: true };
  expect(valueSendMuted(true, writeOn, true)).toBe(false);
  expect(valueSendMuted(true, writeOn, false)).toBe(true);
  expect(valueSendMuted(true, writeOn)).toBe(false);
  expect(readModeButtonMuted(true, true, writeOn)).toBe(false);
  expect(readModeButtonMuted(false, true, writeOn)).toBe(true);
  const reading = { read: true, payload: undefined };
  expect(valueSendMuted(true, reading, true)).toBe(true);
  expect(readModeButtonMuted(true, true, reading)).toBe(true);
  expect(readModeButtonMuted(false, true, reading)).toBe(false);
  expect(readModeButtonMuted(true, false, writeOn)).toBe(false);
});

test('needsValueColumn is false only for button DPTs', () => {
  expect(needsValueColumn('1.001', 1)).toBe(false);
  expect(needsValueColumn('2.002', 2)).toBe(false);
  expect(needsValueColumn('5.001', 5)).toBe(true);
  expect(needsValueColumn('3.007', 3)).toBe(true);
  expect(needsValueColumn('', null)).toBe(true);
  expect(needsValueColumn('1', 1)).toBe(true);
});

test('reserveValueSlot false omits the empty value cell for button DPTs', () => {
  const { container } = render(
    <WriteControls
      dptMain={1}
      dptKey="1.001"
      value=""
      onValueChange={() => {}}
      onWrite={() => {}}
      reserveValueSlot={false}
      valueColProps={{ 'data-wtb-col': '5' }}
    />,
  );
  expect(container.querySelector('[data-wtb-col="5"]')).toBeNull();
  expect(screen.getByRole('button', { name: /^on$/i })).toBeInTheDocument();
});

test('DPT 1 renders on/off as accent action buttons that write booleans (#218)', () => {
  const onWrite = vi.fn();
  render(<WriteControls dptMain={1} dptKey="1.001" value="" onValueChange={() => {}} onWrite={onWrite} />);

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
    <WriteControls dptMain={1} dptKey="1.001" value="" onValueChange={() => {}} onWrite={() => {}} />,
  );
  const send = screen.getByRole('button', { name: /^on$/i }).parentElement as HTMLElement;
  expect(send.style.gridTemplateColumns).toBe('repeat(2, minmax(max-content, 1fr))');
  expect(container.querySelectorAll('button').length).toBeGreaterThanOrEqual(2);
});

test('sendFit hug keeps content-sized wrapping buttons', () => {
  render(
    <WriteControls
      dptMain={1}
      dptKey="1.001"
      value=""
      onValueChange={() => {}}
      onWrite={() => {}}
      sendFit="hug"
      sendEnd={<button type="button">Read</button>}
    />,
  );
  const on = screen.getByRole('button', { name: /^on$/i });
  const send = on.parentElement as HTMLElement;
  expect(send.style.display).toBe('flex');
  expect(send.style.flexWrap).toBe('wrap');
  expect(send.style.gridTemplateColumns).toBe('');
  expect(on.style.width).not.toBe('100%');
  expect(screen.getByRole('button', { name: /^Read$/i }).parentElement).toBe(send);
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

test('value choice select commits the next choice with arrow keys (wrapping)', async () => {
  const onWrite = vi.fn();
  render(<WriteControls dptMain={3} dptKey="3.008" value="" onValueChange={() => {}} onWrite={onWrite} />);
  const trigger = screen.getByRole('button', { name: 'Value' });
  // Starts at index 0; ArrowDown selects index 1 immediately.
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expect(screen.getByRole('listbox', { name: 'Value' })).toBeInTheDocument();
  expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(screen.queryByRole('listbox', { name: 'Value' })).not.toBeInTheDocument();
  await vi.waitFor(() => expect(trigger).toHaveFocus());
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  expect(onWrite).toHaveBeenCalledWith({ control: 'up', step_code: 1 });

  // ArrowUp from index 1 wraps to the last option.
  fireEvent.keyDown(trigger, { key: 'ArrowUp' });
  fireEvent.keyDown(trigger, { key: 'ArrowUp' });
  const options = screen.getAllByRole('option');
  expect(options[options.length - 1]).toHaveAttribute('aria-selected', 'true');
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

test('empty free-value placeholder stays left-aligned', () => {
  render(<WriteControls dptMain={9} dptKey="9.001" value="" unit="°C" onValueChange={() => {}} onWrite={() => {}} />);
  expect(screen.getByLabelText('Value')).toHaveStyle({ textAlign: 'left' });
  expect(screen.getByPlaceholderText('Value')).toBeInTheDocument();
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
  render(<WriteControls dptMain={16} dptKey="16.000" value="" onValueChange={() => {}} onWrite={onWrite} />);

  const writeBtn = screen.getByRole('button', { name: /Write/ });
  expect(writeBtn).not.toBeDisabled();
  fireEvent.click(writeBtn);
  expect(onWrite).toHaveBeenCalledWith(' '.repeat(14));
});

test('DPT 4 sends a single padded character and uses a mono value field', () => {
  const onWrite = vi.fn();
  render(<WriteControls dptMain={4} dptKey="4.001" value="" onValueChange={() => {}} onWrite={onWrite} />);
  const input = screen.getByLabelText('Value');
  expect(input).toHaveStyle({ fontFamily: "'JetBrains Mono', monospace" });
  expect(input).toHaveAttribute('maxLength', '1');
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  expect(onWrite).toHaveBeenCalledWith(' ');
});

test('ASCII text DPT reports charset errors instead of writing', () => {
  const onWrite = vi.fn();
  const onError = vi.fn();
  render(
    <WriteControls
      dptMain={16}
      dptKey="16.000"
      value="Ä"
      onValueChange={() => {}}
      onWrite={onWrite}
      onError={onError}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  expect(onWrite).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith('Character not allowed for DPT 16.000 (ASCII)');
});

test('DPT 10 renders a themed time picker and handles write', () => {
  const onWrite = vi.fn();
  const onValueChange = vi.fn();
  render(<WriteControls dptMain={10} dptKey="10.001" value="12:30:00" onValueChange={onValueChange} onWrite={onWrite} />);

  const input = screen.getByLabelText('Value');
  expect(input).toHaveAttribute('type', 'text');
  expect(input).toHaveValue('12:30:00');

  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  expect(onWrite).toHaveBeenCalledWith('12:30:00');
});

test('DPT 11 renders a themed date picker and handles write', () => {
  const onWrite = vi.fn();
  render(<WriteControls dptMain={11} dptKey="11.001" value="2026-07-18" onValueChange={() => {}} onWrite={onWrite} />);

  const input = screen.getByLabelText('Value');
  expect(input).toHaveAttribute('type', 'text');
  expect(input).toHaveValue('2026-07-18');

  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  expect(onWrite).toHaveBeenCalledWith('2026-07-18');
});

test('a bare DPT main renders a value field and one Write button', () => {
  render(<WriteControls dptMain={1} dptKey="1" value="" onValueChange={() => {}} onWrite={() => {}} />);
  expect(screen.getByPlaceholderText('Value')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Write/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^on$/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Toggle recent values' })).not.toBeInTheDocument();
});

test('focusing the value field selects its contents and keeps the selection after recents open', async () => {
  localStorage.setItem('recent_val_ga_1/2/3', JSON.stringify(['40', '10']));
  render(
    <WriteControls dptMain={5} dptKey="5.001" address="1/2/3" value="42" onValueChange={() => {}} onWrite={() => {}} />,
  );
  const input = screen.getByLabelText('Value') as HTMLInputElement;
  input.focus();
  expect(await screen.findByRole('listbox', { name: 'Recent values' })).toBeInTheDocument();
  // Menu mount / mouseup collapses the selection; the focus lock must restore it.
  input.setSelectionRange(2, 2);
  document.dispatchEvent(new Event('selectionchange'));
  await waitFor(() => {
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(2);
  });
});

test('recent values show a chevron and open from the field', () => {
  localStorage.setItem('recent_val_ga_1/2/3', JSON.stringify(['40', '10']));
  render(
    <WriteControls dptMain={5} dptKey="5.001" address="1/2/3" value="" onValueChange={() => {}} onWrite={() => {}} />,
  );
  const input = screen.getByLabelText('Value');
  const chevron = screen.getByRole('button', { name: 'Toggle recent values' });
  expect(chevron).toBeInTheDocument();
  expect(screen.queryByText('40')).not.toBeInTheDocument();
  fireEvent.focus(input);
  const recent = screen.getByText('40');
  expect(recent.closest('[data-portaled-menu]')?.parentElement).toBe(document.body);
  fireEvent.blur(input);
  expect(screen.queryByText('40')).not.toBeInTheDocument();
});

test('arrow keys move the recent-values highlight; Enter picks it', async () => {
  localStorage.setItem('recent_val_ga_1/2/3', JSON.stringify(['40', '10']));
  const onValueChange = vi.fn();
  render(
    <WriteControls dptMain={5} dptKey="5.001" address="1/2/3" value="" onValueChange={onValueChange} onWrite={() => {}} />,
  );
  const input = screen.getByLabelText('Value');
  fireEvent.focus(input);
  expect(screen.getByRole('option', { name: '40' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(screen.getByRole('option', { name: '10' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onValueChange).toHaveBeenCalledWith('10');
  expect(screen.queryByRole('listbox', { name: 'Recent values' })).not.toBeInTheDocument();
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Toggle recent values' })).toHaveFocus());
});

test('chevron arrow keys commit the next recent value from the unfiltered list, wrapping', async () => {
  localStorage.setItem('recent_val_ga_1/2/3', JSON.stringify(['40', '10', '21']));
  function Controlled() {
    const [value, setValue] = useState('40');
    return (
      <WriteControls
        dptMain={5}
        dptKey="5.001"
        address="1/2/3"
        value={value}
        onValueChange={setValue}
        onWrite={() => {}}
      />
    );
  }
  render(<Controlled />);
  const chevron = screen.getByRole('button', { name: 'Toggle recent values' });
  chevron.focus();
  fireEvent.keyDown(chevron, { key: 'ArrowDown' });
  expect(screen.getByLabelText('Value')).toHaveValue('10');
  expect(screen.getByRole('option', { name: '10' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('option', { name: '21' })).toBeInTheDocument();
  await vi.waitFor(() => expect(chevron).toHaveFocus());
  fireEvent.keyDown(chevron, { key: 'ArrowDown' });
  expect(screen.getByLabelText('Value')).toHaveValue('21');
  fireEvent.keyDown(chevron, { key: 'ArrowDown' });
  expect(screen.getByLabelText('Value')).toHaveValue('40');
  fireEvent.keyDown(chevron, { key: 'ArrowUp' });
  expect(screen.getByLabelText('Value')).toHaveValue('21');
});

test('arrow keys scroll the highlighted recent value inside the menu only', () => {
  localStorage.setItem(
    'recent_val_ga_1/2/3',
    JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']),
  );
  render(
    <WriteControls dptMain={5} dptKey="5.001" address="1/2/3" value="" onValueChange={() => {}} onWrite={() => {}} />,
  );
  const input = screen.getByLabelText('Value');
  fireEvent.focus(input);
  const list = screen.getByRole('listbox', { name: 'Recent values' });
  list.getBoundingClientRect = () => ({
    top: 100, bottom: 150, left: 0, right: 120, width: 120, height: 50,
    x: 0, y: 100, toJSON() { return {}; },
  });
  // Option "b" sits below the visible menu — scrolling must bump menu.scrollTop only.
  const optB = screen.getByRole('option', { name: 'b' });
  optB.getBoundingClientRect = () => ({
    top: 160, bottom: 180, left: 0, right: 120, width: 120, height: 20,
    x: 0, y: 160, toJSON() { return {}; },
  });
  const before = list.scrollTop;
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(optB).toHaveAttribute('aria-selected', 'true');
  expect(list.scrollTop).toBe(before + 30);
});

test('Enter with an open recent-values list picks the highlight without writing', async () => {
  localStorage.setItem('recent_val_ga_1/2/3', JSON.stringify(['40', '10']));
  const onValueChange = vi.fn();
  const onWrite = vi.fn();
  render(
    <WriteControls dptMain={5} dptKey="5.001" address="1/2/3" value="" onValueChange={onValueChange} onWrite={onWrite} />,
  );
  const input = screen.getByLabelText('Value');
  fireEvent.focus(input);
  expect(screen.getByRole('option', { name: '40' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onValueChange).toHaveBeenCalledWith('40');
  expect(onWrite).not.toHaveBeenCalled();
  expect(screen.queryByRole('listbox', { name: 'Recent values' })).not.toBeInTheDocument();
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Toggle recent values' })).toHaveFocus());
});

test('typing clears the recent-values highlight', () => {
  localStorage.setItem('recent_val_ga_1/2/3', JSON.stringify(['40', '10']));
  const onValueChange = vi.fn();
  render(
    <WriteControls dptMain={5} dptKey="5.001" address="1/2/3" value="" onValueChange={onValueChange} onWrite={() => {}} />,
  );
  const input = screen.getByLabelText('Value');
  fireEvent.focus(input);
  expect(screen.getByRole('option', { name: '40' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.change(input, { target: { value: '2' } });
  expect(screen.getByRole('option', { name: '40' })).toHaveAttribute('aria-selected', 'false');
  expect(screen.getByRole('option', { name: '10' })).toHaveAttribute('aria-selected', 'false');
});

test('Enter after typing writes the typed value instead of a recent', () => {
  localStorage.setItem('recent_val_ga_1/2/3', JSON.stringify(['40', '10']));
  const onWrite = vi.fn();
  function Controlled() {
    const [value, setValue] = useState('');
    return (
      <WriteControls
        dptMain={5}
        dptKey="5.001"
        address="1/2/3"
        value={value}
        onValueChange={setValue}
        onWrite={onWrite}
      />
    );
  }
  render(<Controlled />);
  const input = screen.getByLabelText('Value');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '21' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onWrite).toHaveBeenCalledWith(21);
  expect(screen.queryByRole('listbox', { name: 'Recent values' })).not.toBeInTheDocument();
  expect(input).toHaveFocus();
});

test('focusToken focuses the value input and may open recents', () => {
  localStorage.setItem('recent_val_ga_1/2/3', JSON.stringify(['40']));
  const { rerender } = render(
    <WriteControls
      dptMain={5}
      dptKey="5.001"
      address="1/2/3"
      value=""
      onValueChange={() => {}}
      onWrite={() => {}}
      focusToken={null}
    />,
  );
  rerender(
    <WriteControls
      dptMain={5}
      dptKey="5.001"
      address="1/2/3"
      value=""
      onValueChange={() => {}}
      onWrite={() => {}}
      focusToken={1}
    />,
  );
  expect(screen.getByLabelText('Value')).toHaveFocus();
  expect(screen.getByRole('listbox', { name: 'Recent values' })).toBeInTheDocument();
});

test('focusToken focuses the leftmost write button when there is no value field', () => {
  const { rerender } = render(
    <WriteControls
      dptMain={1}
      dptKey="1.001"
      value=""
      onValueChange={() => {}}
      onWrite={() => {}}
      focusToken={null}
      reserveValueSlot={false}
    />,
  );
  rerender(
    <WriteControls
      dptMain={1}
      dptKey="1.001"
      value=""
      onValueChange={() => {}}
      onWrite={() => {}}
      focusToken={1}
      reserveValueSlot={false}
    />,
  );
  const on = screen.getByRole('button', { name: /^on$/i });
  const off = screen.getByRole('button', { name: /^off$/i });
  // 1.001 choices render off then on — leftmost write button is off.
  expect(off).toHaveFocus();
  expect(on).not.toHaveFocus();
});

test('recent values list is placed below the value field shell', async () => {
  localStorage.setItem('recent_val_ga_1/2/3', JSON.stringify(['40']));
  const { container } = render(
    <WriteControls
      dptMain={5}
      dptKey="5.001"
      address="1/2/3"
      value=""
      onValueChange={() => {}}
      onWrite={() => {}}
      focusToken={1}
    />,
  );
  const shell = container.querySelector('[data-value-field]') as HTMLElement;
  let bottom = 230;
  shell.getBoundingClientRect = () => ({
    top: bottom - 30, bottom, left: 40, right: 160, width: 120, height: 30,
    x: 40, y: bottom - 30, toJSON() { return {}; },
  });
  // Re-open placement after mocking geometry (focus already opened recents).
  fireEvent.focus(screen.getByLabelText('Value'));
  await waitFor(() => {
    const list = screen.getByRole('listbox', { name: 'Recent values' });
    expect(Number.parseFloat(list.style.top)).toBe(234);
  });
  // Popover nudge / last-value load can move the shell — list must follow below.
  bottom = 120;
  await waitFor(() => {
    const list = screen.getByRole('listbox', { name: 'Recent values' });
    expect(Number.parseFloat(list.style.top)).toBe(124);
  });
});

test('write button click keeps focus on the button', async () => {
  const onWrite = vi.fn();
  render(
    <WriteControls dptMain={1} dptKey="1.001" value="" onValueChange={() => {}} onWrite={onWrite} />,
  );
  const on = screen.getByRole('button', { name: /^on$/i });
  on.focus();
  fireEvent.click(on);
  expect(onWrite).toHaveBeenCalledWith(true);
  await vi.waitFor(() => expect(on).toHaveFocus());
});

test('write button keeps visible focus after a busy disable cycle', async () => {
  const onWrite = vi.fn();
  const { rerender } = render(
    <WriteControls dptMain={1} dptKey="1.001" value="" onValueChange={() => {}} onWrite={onWrite} />,
  );
  const off = screen.getByRole('button', { name: /^off$/i });
  fireEvent.click(off);
  expect(onWrite).toHaveBeenCalledWith(false);
  // Parent busy→disabled steals focus from the actuated button.
  rerender(
    <WriteControls dptMain={1} dptKey="1.001" value="" onValueChange={() => {}} onWrite={onWrite} disabled />,
  );
  expect(off).toBeDisabled();
  rerender(
    <WriteControls dptMain={1} dptKey="1.001" value="" onValueChange={() => {}} onWrite={onWrite} />,
  );
  await vi.waitFor(() => expect(screen.getByRole('button', { name: /^off$/i })).toHaveFocus());
});

test('Enter on the value field keeps focus after a busy disable cycle', async () => {
  const onWrite = vi.fn();
  function Harness({ disabled = false }: { disabled?: boolean }) {
    const [value, setValue] = useState('42');
    return (
      <WriteControls
        dptMain={5}
        dptKey="5.001"
        value={value}
        onValueChange={setValue}
        onWrite={onWrite}
        disabled={disabled}
      />
    );
  }
  const { rerender } = render(<Harness />);
  const input = screen.getByLabelText('Value');
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onWrite).toHaveBeenCalledWith(42);
  rerender(<Harness disabled />);
  expect(screen.getByLabelText('Value')).toBeDisabled();
  rerender(<Harness />);
  await vi.waitFor(() => expect(screen.getByLabelText('Value')).toHaveFocus());
});

test('read button in sendEnd keeps focus after a busy disable cycle', async () => {
  const onWrite = vi.fn();
  const onRead = vi.fn();
  function Harness({ disabled = false }: { disabled?: boolean }) {
    return (
      <WriteControls
        dptMain={1}
        dptKey="1.001"
        value=""
        onValueChange={() => {}}
        onWrite={onWrite}
        disabled={disabled}
        sendEnd={(
          <button
            type="button"
            className="wtb-read-btn"
            disabled={disabled}
            onClick={onRead}
          >
            Read
          </button>
        )}
      />
    );
  }
  const { rerender } = render(<Harness />);
  const read = screen.getByRole('button', { name: /^Read$/i });
  expect(read).toHaveClass('wtb-read-btn');
  fireEvent.click(read);
  expect(onRead).toHaveBeenCalled();
  rerender(<Harness disabled />);
  expect(screen.getByRole('button', { name: /^Read$/i })).toBeDisabled();
  rerender(<Harness />);
  await vi.waitFor(() => expect(screen.getByRole('button', { name: /^Read$/i })).toHaveFocus());
});

test('typing filters recent values; clearing the input restores the MRU list', () => {
  localStorage.setItem('recent_val_ga_1/2/3', JSON.stringify(['40', '10', '21']));
  function Controlled() {
    const [value, setValue] = useState('');
    return (
      <WriteControls
        dptMain={5}
        dptKey="5.001"
        address="1/2/3"
        value={value}
        onValueChange={setValue}
        onWrite={() => {}}
      />
    );
  }
  render(<Controlled />);
  const input = screen.getByLabelText('Value');
  fireEvent.focus(input);
  expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['40', '10', '21']);
  fireEvent.change(input, { target: { value: '2' } });
  expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['21']);
  fireEvent.change(input, { target: { value: '' } });
  expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['40', '10', '21']);
});

test('a written value moves to the top of the recent-values list', () => {
  localStorage.setItem('recent_val_ga_1/2/3', JSON.stringify(['40', '10']));
  function Controlled() {
    const [value, setValue] = useState('');
    return (
      <WriteControls
        dptMain={5}
        dptKey="5.001"
        address="1/2/3"
        value={value}
        onValueChange={setValue}
        onWrite={() => {}}
      />
    );
  }
  render(<Controlled />);
  const input = screen.getByLabelText('Value');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '21' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.focus(input);
  expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['21', '40', '10']);
});

test('blur saves the typed value into recent values', () => {
  localStorage.clear();
  function Controlled() {
    const [value, setValue] = useState('');
    return (
      <WriteControls
        dptMain={5}
        dptKey="5.001"
        address="1/2/3"
        value={value}
        onValueChange={setValue}
        onWrite={() => {}}
      />
    );
  }
  render(<Controlled />);
  const input = screen.getByLabelText('Value');
  fireEvent.change(input, { target: { value: '33' } });
  fireEvent.blur(input);
  expect(JSON.parse(localStorage.getItem('recent_val_ga_1/2/3')!)).toEqual(['33']);
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.focus(input);
  expect(screen.getByRole('option', { name: '33' })).toBeInTheDocument();
});

test('a click in the value field closes an open recent-values list', () => {
  localStorage.setItem('recent_val_ga_1/2/3', JSON.stringify(['40']));
  render(
    <WriteControls dptMain={5} dptKey="5.001" address="1/2/3" value="" onValueChange={() => {}} onWrite={() => {}} />,
  );
  const input = screen.getByLabelText('Value');
  const shell = input.closest('[data-value-field]') as HTMLElement;
  fireEvent.focus(input);
  expect(screen.getByText('40')).toBeInTheDocument();
  fireEvent.mouseDown(shell);
  expect(screen.queryByText('40')).not.toBeInTheDocument();
});

test('recent values stay in the document when the value cell clips overflow', () => {
  localStorage.setItem('recent_val_ga_9/9/9', JSON.stringify(['40']));
  render(
    <div style={{ overflow: 'hidden', height: 20 }}>
      <WriteControls dptMain={5} dptKey="5.001" address="9/9/9" value="" onValueChange={() => {}} onWrite={() => {}} />
    </div>,
  );
  fireEvent.focus(screen.getByLabelText('Value'));
  const menu = screen.getByText('40').closest('[data-portaled-menu]');
  expect(menu?.parentElement).toBe(document.body);
});

test('DPT 19 renders a themed datetime picker and handles write', () => {
  const onWrite = vi.fn();
  render(<WriteControls dptMain={19} dptKey="19.001" value="2026-07-18T12:30:00" onValueChange={() => {}} onWrite={onWrite} />);

  const input = screen.getByLabelText('Value');
  expect(input).toHaveAttribute('type', 'text');
  expect(input).toHaveValue('2026-07-18T12:30:00');

  fireEvent.click(screen.getByRole('button', { name: /Write/ }));
  expect(onWrite).toHaveBeenCalledWith('2026-07-18T12:30:00');
});

test('ctrl-click cycles ≤4-bit write button labels name → hex → bin without writing', () => {
  const onWrite = vi.fn();
  render(
    <WriteControls dptMain={1} dptKey="1.001" value="" onValueChange={() => {}} onWrite={onWrite} />,
  );
  const on = screen.getByRole('button', { name: /^on$/i });
  fireEvent.click(on, { ctrlKey: true });
  expect(onWrite).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /^0x1$/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^0x0$/i })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /^0x1$/i }), { ctrlKey: true });
  expect(screen.getByRole('button', { name: /^0b1$/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^0b0$/i })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /^0b1$/i }), { ctrlKey: true });
  expect(screen.getByRole('button', { name: /^on$/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^off$/i })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /^on$/i }));
  expect(onWrite).toHaveBeenCalledWith(true);
});

test('≤4-bit label mode stays when the DPT changes', () => {
  const { rerender } = render(
    <WriteControls dptMain={1} dptKey="1.001" value="" onValueChange={() => {}} onWrite={() => {}} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /^on$/i }), { ctrlKey: true });
  expect(screen.getByRole('button', { name: /^0x1$/i })).toBeInTheDocument();

  rerender(
    <WriteControls dptMain={1} dptKey="1.008" value="" onValueChange={() => {}} onWrite={() => {}} />,
  );
  // Same panel mode: up/down are shown as hex, not decoded words.
  expect(screen.getByRole('button', { name: /^0x1$/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^0x0$/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^up$/i })).not.toBeInTheDocument();
});

test('≤4-bit label mode is shared across WriteControls of different DPTs', () => {
  render(
    <>
      <WriteControls dptMain={1} dptKey="1.001" value="" onValueChange={() => {}} onWrite={() => {}} />
      <WriteControls dptMain={1} dptKey="1.008" value="" onValueChange={() => {}} onWrite={() => {}} />
    </>,
  );
  fireEvent.click(screen.getByRole('button', { name: /^on$/i }), { ctrlKey: true });
  // 1.001 on/off and 1.008 up/down follow the same panel mode.
  expect(screen.getAllByRole('button', { name: /^0x1$/i })).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: /^0x0$/i })).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /^up$/i })).not.toBeInTheDocument();
});
