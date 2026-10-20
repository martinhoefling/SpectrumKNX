import { expect, test } from 'vitest';
import { defaultCsvDelimiter, telegramsToCsv } from './telegramCsv';
import { makeTelegram } from '../test/telegramFactory';

test('telegrams become CSV lines with the backend export columns (#522)', () => {
  const csv = telegramsToCsv([
    makeTelegram({
      timestamp: '2026-03-05T00:00:00.000Z', source_address: '1.0.18', source_name: 'Aktor; Küche',
      target_address: '2/4/61', target_name: 'Dimmwert "EG"', simplified_type: 'Write', direction: 'Incoming',
      dpt_main: 5, dpt_sub: 1, dpt_name: 'DPT 5.001', value_formatted: '78 %', value_numeric: 78, unit: '%', raw_hex: '0xc8',
    }),
  ], ';');
  const [header, row, end] = csv.split('\r\n');
  expect(header).toBe('timestamp;source;source_name;target;target_name;type;direction;dpt;dpt_name;value;value_numeric;unit;raw');
  expect(row).toBe('2026-03-05T00:00:00.000Z;1.0.18;"Aktor; Küche";2/4/61;"Dimmwert ""EG""";Write;Incoming;5.001;DPT 5.001;78 %;78;%;0xc8');
  expect(end).toBe('');
});

test('the default delimiter follows the locale decimal separator', () => {
  expect(defaultCsvDelimiter('de-DE')).toBe(';');
  expect(defaultCsvDelimiter('en-US')).toBe(',');
});
