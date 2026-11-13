import { expect, test } from 'vitest';

import { boolBtn, BTN_DISABLED_MIX, BTN_MUTED_MIX, primaryBtn, secondaryBtn } from './buttonStyles';

test('disabled write buttons dim via color-mix, not opacity', () => {
  expect(boolBtn(true).opacity).toBeUndefined();
  expect(primaryBtn(true).opacity).toBeUndefined();
  expect(secondaryBtn(true).opacity).toBeUndefined();
  expect(String(boolBtn(true).background)).toContain(`${BTN_DISABLED_MIX}%`);
  expect(String(primaryBtn(true).background)).toContain(`${BTN_DISABLED_MIX}%`);
  expect(boolBtn(true).color).toBe('white');
  expect(String(secondaryBtn(true).color)).toContain(`${BTN_DISABLED_MIX}%`);
  expect(String(secondaryBtn(true).border)).toContain(`${BTN_DISABLED_MIX}%`);
  expect(boolBtn(false).background).toBe('var(--accent-primary)');
  expect(primaryBtn(false).background).toBe('var(--accent-primary)');
  expect(secondaryBtn(false).color).toBe('var(--accent-primary)');
});

test('muted send buttons fade further than a normal disabled button', () => {
  expect(boolBtn(true, true).opacity).toBeUndefined();
  expect(String(boolBtn(true, true).background)).toContain(`${BTN_MUTED_MIX}%`);
  expect(String(boolBtn(true, true).color)).toContain(`${BTN_DISABLED_MIX}%`);
  expect(String(primaryBtn(true, true).background)).toContain(`${BTN_MUTED_MIX}%`);
  expect(String(secondaryBtn(true, true).color)).toContain(`${BTN_MUTED_MIX}%`);
  expect(String(secondaryBtn(true, true).border)).toContain(`${BTN_MUTED_MIX}%`);
  expect(BTN_MUTED_MIX).toBeLessThan(BTN_DISABLED_MIX);
});
