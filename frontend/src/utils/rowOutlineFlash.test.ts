import { expect, test } from 'vitest';

import { ROW_OUTLINE_FLASH_CSS } from './rowOutlineFlash';

test('row outline flash uses the theme focus-ring color', () => {
  expect(ROW_OUTLINE_FLASH_CSS).toMatch(/var\(--focus-ring\)/);
  expect(ROW_OUTLINE_FLASH_CSS).not.toMatch(/var\(--accent-primary\)/);
  expect(ROW_OUTLINE_FLASH_CSS).toMatch(/inset 0 0 0 1px var\(--focus-ring\)/);
  expect(ROW_OUTLINE_FLASH_CSS).not.toMatch(/inset 0 0 0 2px/);
});
