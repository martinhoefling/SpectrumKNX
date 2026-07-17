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
  fireEvent.focus(screen.getByRole('textbox'));

  const items = screen.getAllByRole('button');
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('12/0/0');
  expect(items[1]).toHaveTextContent('4/5/6');
  expect(screen.queryByText('1/2/3')).not.toBeInTheDocument();
});

test('shows no dropdown on focus when there are no recents', () => {
  render(<GaCombobox value="" onChange={() => {}} options={OPTIONS} recentAddresses={[]} />);
  fireEvent.focus(screen.getByRole('textbox'));
  expect(screen.queryAllByRole('button')).toHaveLength(0);
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
  const input = screen.getByRole('textbox');
  fireEvent.focus(input);

  const items = screen.getAllByRole('button');
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
  fireEvent.focus(screen.getByRole('textbox'));
  const items = screen.getAllByRole('button');
  expect(items[0]).toHaveTextContent('4/5/6');
});

test('filters the full project list from the first typed character', () => {
  render(<GaCombobox value="1" onChange={() => {}} options={OPTIONS} recentAddresses={['4/5/6']} />);
  fireEvent.focus(screen.getByRole('textbox'));

  const items = screen.getAllByRole('button');
  // Matches "1/2/3" and "12/0/0" by address; recents no longer pinned while typing.
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('1/2/3');
  expect(items[1]).toHaveTextContent('12/0/0');
});
