import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { DptTypeTree } from './DptTypeTree';
import type { FilterOption } from '../types/filters';

const ENTRIES: FilterOption[] = [
  { main: 1, sub: 1, label: 'Switch' },
  { main: 1, sub: 2, label: 'Boolean' },
  { main: 9, sub: 1, label: 'Temperature (°C)' },
  { main: 5, sub: 1, label: 'Percentage (0..100%)' },
];

const renderTree = (selected: string[], onChange = vi.fn(), searchQuery = '') => {
  render(
    <DptTypeTree
      entries={ENTRIES}
      selected={selected}
      onChange={onChange}
      mode="history"
      searchQuery={searchQuery}
    />,
  );
  return onChange;
};

test('groups DPTs by main type with width labels, sorted and collapsed (#273)', () => {
  renderTree([]);

  const groups = screen.getAllByText(/^DPT \d+$/).map(el => el.textContent);
  expect(groups).toEqual(['DPT 1', 'DPT 5', 'DPT 9']);
  expect(screen.getByText('1-bit')).toBeInTheDocument();
  expect(screen.getByText('8-bit unsigned')).toBeInTheDocument();
  expect(screen.getByText('2-byte float')).toBeInTheDocument();

  // Collapsed by default: no subtype rows visible.
  expect(screen.queryByText('Switch')).not.toBeInTheDocument();

  // Expanding a group reveals its subtypes.
  fireEvent.click(screen.getByText('DPT 1'));
  expect(screen.getByText('Switch')).toBeInTheDocument();
  expect(screen.getByText('Boolean')).toBeInTheDocument();
  expect(screen.queryByText('Temperature (°C)')).not.toBeInTheDocument();
});

test('an active search expands the groups', () => {
  renderTree([], vi.fn(), 'switch');
  expect(screen.getByText('Switch')).toBeInTheDocument();
});

test('the group checkbox selects the bare main-type key', () => {
  const onChange = vi.fn();
  renderTree(['9.001'], onChange);

  fireEvent.click(screen.getByRole('checkbox', { name: 'DPT 1' }));
  expect(onChange).toHaveBeenCalledWith(['9.001', '1']);
});

test('a fully selected group shows a checked checkbox, a partial one mixed', () => {
  renderTree(['1', '9.001']);
  expect(screen.getByRole('checkbox', { name: 'DPT 1' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('checkbox', { name: 'DPT 9' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('checkbox', { name: 'DPT 5' })).toHaveAttribute('aria-checked', 'false');
});

test('a partially selected group shows a mixed checkbox', () => {
  renderTree(['1.001']);
  expect(screen.getByRole('checkbox', { name: 'DPT 1' })).toHaveAttribute('aria-checked', 'mixed');
});

test('unchecking a group removes its bare key and subtype keys', () => {
  const onChange = vi.fn();
  renderTree(['1', '1.002', '9.001'], onChange);
  fireEvent.click(screen.getByRole('checkbox', { name: 'DPT 1' }));
  expect(onChange).toHaveBeenCalledWith(['9.001']);
});

test('unchecking one subtype of a fully selected main type keeps the others', () => {
  const onChange = vi.fn();
  renderTree(['1'], onChange);

  // Group is selected → it renders expanded; uncheck the "Switch" subtype.
  fireEvent.click(screen.getByText('Switch'));
  expect(onChange).toHaveBeenCalledWith(['1.002']);
});

test('toggling a subtype adds and removes its exact key', () => {
  const onChange = vi.fn();
  renderTree(['1.001'], onChange);

  fireEvent.click(screen.getByText('Boolean'));
  expect(onChange).toHaveBeenCalledWith(['1.001', '1.002']);
});
