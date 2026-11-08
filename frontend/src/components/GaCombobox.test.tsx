import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test } from 'vitest';
import { GaCombobox } from './GaCombobox';

const OPTIONS = [
  { address: '1/2/3', name: 'Living room light' },
  { address: '4/5/6', name: 'Blinds south' },
  { address: '12/0/0', name: 'Heating mode' },
];

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

test('shows no dropdown on focus when there are no recents', () => {
  render(<GaCombobox value="" onChange={() => {}} options={OPTIONS} recentAddresses={[]} />);
  fireEvent.focus(screen.getByRole('combobox'));
  expect(screen.queryAllByRole('option')).toHaveLength(0);
});

test('ranks the exact address match first and preselects it, ahead of infix matches (#217)', () => {
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

test('blur of an incomplete value adopts the highlighted suggestion, or the first', () => {
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
  const { unmount } = render(<Harness />);
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: '1' } });
  fireEvent.blur(input);
  expect(picks).toEqual(['1/2/3']);
  expect(commits).toEqual([]);
  expect(input).toHaveValue('1/2/3');

  picks.length = 0;
  unmount();
  render(<Harness />);
  const again = screen.getByRole('combobox');
  fireEvent.change(again, { target: { value: '1' } });
  fireEvent.keyDown(again, { key: 'ArrowDown' });
  fireEvent.blur(again);
  expect(picks).toEqual(['12/0/0']);
  expect(again).toHaveValue('12/0/0');
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
