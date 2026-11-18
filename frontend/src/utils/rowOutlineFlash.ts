/** CSS class for a fading focus-ring outline on a focused/jumped row. */
export const ROW_OUTLINE_FLASH_CLASS = 'row-outline-flash';

/** Duration must match the keyframes below. */
export const ROW_OUTLINE_FLASH_MS = 1600;

/**
 * Shared keyframes + class for a fading --focus-ring outline.
 * Inject once (module-level) or include in a component `<style>` block.
 */
export const ROW_OUTLINE_FLASH_CSS = `
  .${ROW_OUTLINE_FLASH_CLASS} {
    position: relative;
  }
  .${ROW_OUTLINE_FLASH_CLASS}::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 4px;
    pointer-events: none;
    z-index: 2;
    box-shadow: inset 0 0 0 1px var(--focus-ring);
    animation: row-outline-flash-fade ${ROW_OUTLINE_FLASH_MS}ms ease-out forwards;
  }
  @keyframes row-outline-flash-fade {
    from { box-shadow: inset 0 0 0 1px var(--focus-ring); opacity: 1; }
    to { box-shadow: inset 0 0 0 1px var(--focus-ring); opacity: 0; }
  }
`;

/**
 * Apply the flash class to an element and remove it after the animation.
 * Re-applying (remove + add) restarts the animation.
 */
export function applyRowOutlineFlash(el: HTMLElement | null | undefined): void {
  if (!el) return;
  el.classList.remove(ROW_OUTLINE_FLASH_CLASS);
  // Force reflow so re-adding the class restarts the animation.
  void el.offsetWidth;
  el.classList.add(ROW_OUTLINE_FLASH_CLASS);
  window.setTimeout(() => {
    el.classList.remove(ROW_OUTLINE_FLASH_CLASS);
  }, ROW_OUTLINE_FLASH_MS);
}
