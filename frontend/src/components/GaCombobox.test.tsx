import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { GaCombobox } from './GaCombobox';

const OPTIONS = [
  { address: '1/2/3', name: 'Living room light' },
  { address: '4/5/6', name: 'Blinds south' },
  { address: '12/0/0', name: 'Heating mode' },
];

test('the chevron toggles the suggestion list', () => {
  render(
    <GaCombobox value="" onChange={() => {}} options={OPTIONS} recentAddresses={['12/0/0']} />,
  );
  const chevron = screen.getByRole('button', { name: 'Toggle suggestions' });
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  fireEvent.click(chevron);
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  fireEvent.click(chevron);
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

test('a click on the field shell opens the suggestion list', () => {
  render(
    <GaCombobox value="" onChange={() => {}} options={OPTIONS} recentAddresses={['12/0/0']} />,
  );
  const input = screen.getByRole('combobox');
  fireEvent.mouseDown(input.parentElement!);
  expect(screen.getByRole('listbox')).toBeInTheDocument();
});

test('focusing the combobox selects its contents and keeps it after suggestions open', async () => {
  render(
    <GaCombobox
      value="1/2/3"
      onChange={() => {}}
      options={[{ address: '1/2/3', name: 'A' }, { address: '4/5/6', name: 'B' }]}
      recentAddresses={['1/2/3', '4/5/6']}
    />,
  );
  const input = screen.getByRole('combobox') as HTMLInputElement;
  fireEvent.mouseDown(input);
  expect(input).toHaveFocus();
  expect(await screen.findByRole('listbox')).toBeInTheDocument();
  // Click-end / list mount collapses the selection the way Chrome does.
  input.setSelectionRange(5, 5);
  input.dispatchEvent(new Event('selectionchange', { bubbles: true }));
  document.dispatchEvent(new Event('selectionchange'));
  await waitFor(() => {
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
  });
});

test('shows only recent addresses, newest first, while the input is empty', () => {
  render(
    <GaCombobox value="" onChange={() => {}} options={OPTIONS} recentAddresses={['12/0/0', '4/5/6']} />
  );
  fireEvent.focus(screen.getByRole('combobox'));

  const items = screen.getAllByRole('option');
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('12/0/0');
  expect(items[1]).toHaveTextContent('4/5/6');
  expect(screen.queryByText('1/2/3')).not.toBeInTheDocument();
});

test('input size follows placeholder or value, not the browser default of 20', () => {
  const { rerender } = render(
    <GaCombobox value="" onChange={() => {}} options={OPTIONS} placeholder="GA" />,
  );
  expect(screen.getByRole('combobox')).toHaveAttribute('size', '2');

  rerender(
    <GaCombobox value="31/7/255" onChange={() => {}} options={OPTIONS} placeholder="GA" />,
  );
  expect(screen.getByRole('combobox')).toHaveAttribute('size', '8');
});

test('suggestion list is portaled to document.body so it does not expand the field wrap', () => {
  const { container } = render(
    <GaCombobox value="" onChange={() => {}} options={OPTIONS} recentAddresses={['12/0/0']} />,
  );
  fireEvent.focus(screen.getByRole('combobox'));
  const list = screen.getByRole('listbox');
  expect(list.parentElement).toBe(document.body);
  expect(container.querySelector('[role="listbox"]')).toBeNull();
  expect(list).toHaveStyle({ position: 'fixed' });
});

test('shows no dropdown on focus when there are no recents', () => {
  render(<GaCombobox value="" onChange={() => {}} options={OPTIONS} recentAddresses={[]} />);
  fireEvent.focus(screen.getByRole('combobox'));
  expect(screen.queryAllByRole('option')).toHaveLength(0);
});

test('ranks the exact address match first and preselects it, ahead of infix matches (#217)', async () => {
  const picked: string[] = [];
  render(
    <GaCombobox
      value="2/4/1"
      onChange={(addr, option) => { if (option) picked.push(addr); }}
      options={[
        { address: '12/4/1', name: 'Waldi: Präsenz in den letzten 5 Minuten' },
        { address: '12/4/10', name: 'Waldi: Präsenz HKL' },
        { address: '2/4/1', name: 'Haus: Zeit' },
        { address: '2/4/10', name: 'Haus: Datum' },
      ]}
    />
  );
  const input = screen.getByRole('combobox');
  fireEvent.focus(input);

  const items = screen.getAllByRole('option');
  expect(items[0]).toHaveTextContent('2/4/1');
  // Prefix matches ("2/4/10") rank ahead of pure infix matches ("12/4/1").
  expect(items[1]).toHaveTextContent('2/4/10');

  // Enter picks the preselected exact match without arrowing down.
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(picked).toEqual(['2/4/1']);
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Toggle suggestions' })).toHaveFocus());
});

test('ranks an exact name match first (#217)', () => {
  render(
    <GaCombobox
      value="blinds south"
      onChange={() => {}}
      options={[
        { address: '4/5/7', name: 'Blinds south west' },
        { address: '4/5/6', name: 'Blinds south' },
      ]}
    />
  );
  fireEvent.focus(screen.getByRole('combobox'));
  const items = screen.getAllByRole('option');
  expect(items[0]).toHaveTextContent('4/5/6');
});

test('name display lists the name before the address', () => {
  render(
    <GaCombobox
      display="name"
      value="blinds"
      onChange={() => {}}
      options={OPTIONS}
    />
  );
  fireEvent.focus(screen.getByRole('combobox'));
  const text = screen.getByRole('option').textContent ?? '';
  expect(text.indexOf('Blinds south')).toBeGreaterThanOrEqual(0);
  expect(text.indexOf('Blinds south')).toBeLessThan(text.indexOf('4/5/6'));
});

test('commits on blur and Enter, not on each keystroke', () => {
  const commits: string[] = [];
  function Harness() {
    const [value, setValue] = useState('');
    return (
      <GaCombobox
        value={value}
        onChange={setValue}
        onCommit={text => commits.push(text)}
        options={OPTIONS}
      />
    );
  }
  render(<Harness />);
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: '9/9/9' } });
  expect(commits).toEqual([]);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(commits).toEqual(['9/9/9']);
  fireEvent.blur(input);
  expect(commits).toEqual(['9/9/9', '9/9/9']);
});

test('arrow keys move through the suggestions and Enter selects the highlighted one', () => {
  const picks: string[] = [];
  render(
    <GaCombobox
      value="1"
      onChange={(_text, option) => { if (option) picks.push(option.address ?? ''); }}
      options={OPTIONS}
    />
  );
  const input = screen.getByRole('combobox');
  fireEvent.focus(input);
  const items = () => screen.getAllByRole('option');
  expect(items()[0]).toHaveAttribute('data-active', 'true');
  expect(items()[1]).toHaveAttribute('data-active', 'false');

  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(items()[1]).toHaveAttribute('data-active', 'true');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(items()[1]).toHaveAttribute('data-active', 'true');
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(items()[0]).toHaveAttribute('data-active', 'true');

  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(picks).toEqual(['12/0/0']);
});

test('typing clears the suggestion highlight; blur keeps free text', () => {
  const picks: string[] = [];
  const commits: string[] = [];
  function Harness() {
    const [value, setValue] = useState('');
    return (
      <GaCombobox
        value={value}
        onChange={(text, option) => { setValue(text); if (option) picks.push(option.address ?? ''); }}
        onCommit={text => commits.push(text)}
        options={OPTIONS}
      />
    );
  }
  render(<Harness />);
  const input = screen.getByRole('combobox');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '1' } });
  for (const opt of screen.getAllByRole('option')) {
    expect(opt).toHaveAttribute('data-active', 'false');
  }
  fireEvent.blur(input);
  expect(picks).toEqual([]);
  expect(commits).toEqual(['1']);
  expect(input).toHaveValue('1');
});

test('blur of an incomplete value adopts a highlighted suggestion', () => {
  const picks: string[] = [];
  const commits: string[] = [];
  function Harness() {
    const [value, setValue] = useState('');
    return (
      <GaCombobox
        value={value}
        onChange={(text, option) => { setValue(text); if (option) picks.push(option.address ?? ''); }}
        onCommit={text => commits.push(text)}
        options={OPTIONS}
      />
    );
  }
  render(<Harness />);
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: '1' } });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.blur(input);
  expect(picks).toEqual(['1/2/3']);
  expect(commits).toEqual([]);
  expect(input).toHaveValue('1/2/3');
});

test('Enter after typing commits free text instead of a suggestion', () => {
  const picks: string[] = [];
  const commits: string[] = [];
  function Harness() {
    const [value, setValue] = useState('');
    return (
      <GaCombobox
        value={value}
        onChange={(text, option) => { setValue(text); if (option) picks.push(option.address ?? ''); }}
        onCommit={text => commits.push(text)}
        options={OPTIONS}
      />
    );
  }
  render(<Harness />);
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: '9/9/9' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(picks).toEqual([]);
  expect(commits).toEqual(['9/9/9']);
});

test('filters the full project list from the first typed character', () => {
  render(<GaCombobox value="1" onChange={() => {}} options={OPTIONS} recentAddresses={['4/5/6']} />);
  fireEvent.focus(screen.getByRole('combobox'));

  const items = screen.getAllByRole('option');
  // Matches "1/2/3" and "12/0/0" by address; recents no longer pinned while typing.
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('1/2/3');
  expect(items[1]).toHaveTextContent('12/0/0');
});
