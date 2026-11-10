import { expect, test } from 'vitest';
import { discreteDptValues, formatBusValueForDpt } from './dptValues';

test('discreteDptValues labels are lowercase', () => {
  expect(discreteDptValues('1.001')?.map(c => c.label)).toEqual(['off', 'on']);
  expect(discreteDptValues('3.007')?.[0].label).toBe('decrease 0');
  expect(discreteDptValues('2.001')?.find(c => c.label.includes('control'))?.label).toBe('off (control)');
});

test('formatBusValueForDpt maps DPT 1.001 bits to off/on', () => {
  expect(formatBusValueForDpt({ value_numeric: 0, value_formatted: '0' }, '1.001')).toEqual({
    text: 'off',
    unit: '',
  });
  expect(formatBusValueForDpt({ value_numeric: 1, value_formatted: '1' }, '1.001')).toEqual({
    text: 'on',
    unit: '',
  });
});

test('formatBusValueForDpt uses subtype words (1.008 → up/down)', () => {
  expect(formatBusValueForDpt({ value_numeric: 0 }, '1.008')).toEqual({ text: 'up', unit: '' });
  expect(formatBusValueForDpt({ value_numeric: 1 }, '1.008')).toEqual({ text: 'down', unit: '' });
});

test('formatBusValueForDpt falls back to on/off for bare DPT main 1', () => {
  expect(formatBusValueForDpt({ value_formatted: '0' }, '1')).toEqual({ text: 'off', unit: '' });
  expect(formatBusValueForDpt({ value_formatted: 'true' }, '1')).toEqual({ text: 'on', unit: '' });
});

test('formatBusValueForDpt keeps numeric values and units for non-discrete DPTs', () => {
  expect(formatBusValueForDpt(
    { value_formatted: '21.5', value_numeric: 21.5, unit: '°C' },
    '9.001',
  )).toEqual({ text: '21.5', unit: '°C' });
});

test('formatBusValueForDpt decodes DPT 3 raw nibble (decrease 0 / increase 3)', () => {
  expect(formatBusValueForDpt({ value_numeric: 0, value_formatted: '0' }, '3.007')).toEqual({
    text: 'decrease 0',
    unit: '',
  });
  expect(formatBusValueForDpt({ value_numeric: 0b1011 }, '3.007')).toEqual({
    text: 'increase 3',
    unit: '',
  });
  expect(formatBusValueForDpt(
    { value_json: { control: 'decrease', step_code: 0 } },
    '3.007',
  )).toEqual({ text: 'decrease 0', unit: '' });
});

test('formatBusValueForDpt decodes DPT 2 raw nibble', () => {
  expect(formatBusValueForDpt({ value_numeric: 0 }, '2.001')).toEqual({ text: 'off', unit: '' });
  expect(formatBusValueForDpt({ value_numeric: 3 }, '2.001')).toEqual({ text: 'on (control)', unit: '' });
});

test('formatBusValueForDpt keeps and pads spaces for fixed-width text DPTs', () => {
  expect(formatBusValueForDpt({ value_formatted: 'Hi' }, '16.000')).toEqual({
    text: 'Hi'.padEnd(14, ' '),
    unit: '',
  });
  expect(formatBusValueForDpt({ value_formatted: '  A' }, '16.001')).toEqual({
    text: '  A'.padEnd(14, ' '),
    unit: '',
  });
  expect(formatBusValueForDpt({ value_formatted: 'X' }, '4.001')).toEqual({
    text: 'X',
    unit: '',
  });
  expect(formatBusValueForDpt({ value_formatted: 'Café' }, '28.001')).toEqual({
    text: 'Café',
    unit: '',
  });
});
