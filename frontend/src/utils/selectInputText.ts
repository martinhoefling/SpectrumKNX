/**
 * Select-all on focus that survives the Werthilfe opening.
 *
 * Chrome places the caret on mouseup after focus, and a portaled list's
 * mount/re-render can clear the selection a frame later. Hold the full
 * selection until the user types or clicks to place the caret.
 */

type Lock = { stop: () => void };
const locks = new WeakMap<HTMLInputElement, Lock>();

export function releaseSelectLock(el: HTMLInputElement | null | undefined) {
  if (!el) return;
  locks.get(el)?.stop();
  locks.delete(el);
}

function isFullSelection(el: HTMLInputElement) {
  const end = el.value.length;
  return end === 0 || (el.selectionStart === 0 && el.selectionEnd === end);
}

export function selectInputText(el: HTMLInputElement | null | undefined) {
  if (!el || el.disabled) return;
  releaseSelectLock(el);

  let applying = false;
  let stopped = false;
  const alive = () => !stopped && document.activeElement === el;

  const apply = () => {
    if (applying || !alive() || isFullSelection(el)) return;
    applying = true;
    try {
      el.setSelectionRange(0, el.value.length);
    } catch {
      // number/date inputs may reject setSelectionRange
    } finally {
      applying = false;
    }
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    document.removeEventListener('selectionchange', onSelectionChange);
    el.removeEventListener('keydown', onKeyDown);
    el.removeEventListener('blur', stop);
    locks.delete(el);
  };

  const onSelectionChange = () => apply();

  const onKeyDown = (e: KeyboardEvent) => {
    // Navigation keys must keep the selection (Werthilfe arrows). Editing keys release it.
    if (
      e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight'
      || e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab' || e.key === 'Home' || e.key === 'End'
    ) return;
    stop();
  };

  locks.set(el, { stop });
  document.addEventListener('selectionchange', onSelectionChange);
  el.addEventListener('keydown', onKeyDown);
  el.addEventListener('blur', stop);
  apply();
}

/**
 * mousedown on a text field: first press focuses and keeps select-all
 * (preventDefault so mouseup cannot drop the caret). A later press in the
 * already-focused field places the caret.
 */
export function selectAllMouseDown(e: { preventDefault(): void; currentTarget: HTMLInputElement }) {
  const el = e.currentTarget;
  if (el.disabled) return;
  if (document.activeElement === el) {
    releaseSelectLock(el);
    return;
  }
  e.preventDefault();
  el.focus();
}
