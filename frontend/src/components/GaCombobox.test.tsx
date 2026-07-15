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

test('filters the full project list from the first typed character', () => {
  render(<GaCombobox value="1" onChange={() => {}} options={OPTIONS} recentAddresses={['4/5/6']} />);
  fireEvent.focus(screen.getByRole('textbox'));

  const items = screen.getAllByRole('button');
  // Matches "1/2/3" and "12/0/0" by address; recents no longer pinned while typing.
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('1/2/3');
  expect(items[1]).toHaveTextContent('12/0/0');
});
