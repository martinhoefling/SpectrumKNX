import { expect, test } from 'vitest';

import { boolBtn, primaryBtn, secondaryBtn } from './buttonStyles';

test('disabled write buttons dim via color-mix, not opacity', () => {
  expect(boolBtn(true).opacity).toBeUndefined();
  expect(primaryBtn(true).opacity).toBeUndefined();
  expect(secondaryBtn(true).opacity).toBeUndefined();
  expect(String(boolBtn(true).background)).toMatch(/color-mix/);
  expect(String(primaryBtn(true).background)).toMatch(/color-mix/);
  expect(String(secondaryBtn(true).color)).toMatch(/color-mix/);
  expect(String(secondaryBtn(true).border)).toMatch(/color-mix/);
  expect(boolBtn(false).background).toBe('var(--accent-primary)');
  expect(primaryBtn(false).background).toBe('var(--accent-primary)');
  expect(secondaryBtn(false).color).toBe('var(--accent-primary)');
});
