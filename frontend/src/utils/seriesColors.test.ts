import { expect, test } from 'vitest';
import { seriesColor } from './seriesColors';

test('assigns distinct colors to different addresses', () => {
  expect(seriesColor('1/1/1')).not.toBe(seriesColor('1/1/2'));
});

test('color stays stable regardless of later assignments', () => {
  const first = seriesColor('2/0/1');
  seriesColor('2/0/2');
  seriesColor('2/0/3');
  expect(seriesColor('2/0/1')).toBe(first);
});
