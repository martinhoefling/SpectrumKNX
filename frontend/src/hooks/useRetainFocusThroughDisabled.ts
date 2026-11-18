import { useCallback, useLayoutEffect, useRef } from 'react';

/** Programmatic focus that shows the same ring as Tab (`:focus-visible`). */
export function focusVisible(el: HTMLElement | null | undefined) {
  if (!el) return;
  try {
    el.focus({ focusVisible: true });
  } catch {
    el.focus();
  }
}

/**
 * Remembers a control across a parent busy→disabled cycle and restores
 * visible focus when the control is re-enabled.
 */
export function useRetainFocusThroughDisabled(disabled: boolean) {
  const retainFocusTargetRef = useRef<HTMLElement | null>(null);
  const wasDisabledRef = useRef(disabled);
  const beforeRestoreRef = useRef<((el: HTMLElement) => void) | null>(null);

  const retainFocusOn = useCallback((el: HTMLElement | null | undefined) => {
    if (!el) return;
    retainFocusTargetRef.current = el;
    beforeRestoreRef.current?.(el);
    focusVisible(el);
  }, []);

  const retainClickFocus = useCallback((e: { currentTarget: HTMLElement }) => {
    const el = e.currentTarget;
    retainFocusTargetRef.current = el;
    queueMicrotask(() => retainFocusOn(el));
  }, [retainFocusOn]);

  /** Optional prep before restore (e.g. skip opening recents on value re-focus). */
  const setBeforeRestore = useCallback((fn: ((el: HTMLElement) => void) | null) => {
    beforeRestoreRef.current = fn;
  }, []);

  useLayoutEffect(() => {
    const wasDisabled = wasDisabledRef.current;
    wasDisabledRef.current = disabled;
    if (!wasDisabled || disabled) return;
    const el = retainFocusTargetRef.current;
    if (!el || !el.isConnected) return;
    if ('disabled' in el && (el as HTMLButtonElement | HTMLInputElement).disabled) return;
    retainFocusOn(el);
  }, [disabled, retainFocusOn]);

  return { retainFocusOn, retainClickFocus, setBeforeRestore, retainFocusTargetRef };
}
