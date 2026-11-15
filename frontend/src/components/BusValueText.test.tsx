import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test } from 'vitest';
import { BusValueText } from './BusValueText';
import { TT } from '../utils/telegramCellStyles';

test('defaults to tt-value and toggles to raw-badge on click without unmounting either layer', () => {
  render(
    <BusValueText
      value={{ value_numeric: 0, value_formatted: '0', raw_hex: '0x00' }}
      dpt="3.007"
    />,
  );
  const el = screen.getByRole('button', { name: 'decrease 0' });
  const decoded = el.querySelector(`.${TT.value}`) as HTMLElement;
  const raw = el.querySelector(`.${TT.rawBadge}`) as HTMLElement;
  expect(decoded).toHaveTextContent('decrease 0');
  expect(decoded).toHaveStyle({ visibility: 'visible' });
  expect(raw).toHaveTextContent('0x00');
  expect(raw).toHaveStyle({ visibility: 'hidden' });

  fireEvent.click(el);
  expect(screen.getByRole('button', { name: '0x00' })).toBe(el);
  expect(decoded).toHaveStyle({ visibility: 'hidden' });
  expect(raw).toHaveStyle({ visibility: 'visible' });

  fireEvent.click(el);
  expect(screen.getByRole('button', { name: 'decrease 0' })).toBe(el);
  expect(decoded).toHaveStyle({ visibility: 'visible' });
  expect(raw).toHaveStyle({ visibility: 'hidden' });
});

test('renders unit in a separate tt-value-unit span', () => {
  render(
    <BusValueText value={{ value_formatted: '21.5', unit: '°C' }} dpt="9.001" />,
  );
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  const value = screen.getByText((_, node) => node?.textContent === '21.5 °C' && node.classList.contains(TT.value));
  expect(value).toBeTruthy();
  expect(screen.getByText((content, node) => (
    node?.classList.contains(TT.valueUnit) === true && content.includes('°C')
  ))).toBeTruthy();
});

test('className / rawClassName overrides replace defaults', () => {
  render(
    <BusValueText
      value={{ value_formatted: 'On', raw_hex: '0x01' }}
      dpt="1.001"
      className="custom-value"
      rawClassName="custom-raw"
    />,
  );
  const el = screen.getByRole('button', { name: 'on' });
  expect(el.querySelector('.custom-value')).toBeTruthy();
  expect(el.querySelector(`.${TT.value}`)).toBeNull();
  fireEvent.click(el);
  expect(el.querySelector('.custom-raw')).toBeTruthy();
  expect(el.querySelector(`.${TT.rawBadge}`)).toBeNull();
});

test('defaultShowHex starts in raw-badge mode and toggles to decoded', () => {
  render(
    <BusValueText
      value={{ value_numeric: 0, value_formatted: '0', raw_hex: '0x00' }}
      dpt="3.007"
      defaultShowHex
    />,
  );
  const el = screen.getByRole('button', { name: '0x00' });
  expect(el.querySelector(`.${TT.rawBadge}`)).toHaveStyle({ visibility: 'visible' });
  expect(el.querySelector(`.${TT.value}`)).toHaveStyle({ visibility: 'hidden' });
  fireEvent.click(el);
  expect(screen.getByRole('button', { name: 'decrease 0' })).toBe(el);
  expect(el.querySelector(`.${TT.value}`)).toHaveStyle({ visibility: 'visible' });
});
