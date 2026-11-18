import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, RotateCcw } from 'lucide-react';

import { COMMON_DPTS, dptDesignation, type DptChoice } from '../utils/dpt';
import { selectAllMouseDown, selectInputText } from '../utils/selectInputText';

export { COMMON_DPTS, type DptChoice };

/** Above the send popover (z-index 1000) so the suggestion list stays visible. */
const PORTAL_MENU_Z = 1100;

/**
 * Draft that may replace the row DPT. A bare main ("5") is enough. A subtype
 * must be a known key (suggestion list or designation), canonicalised to
 * three subtype digits. Anything else is refused so blur can keep the old DPT.
 */
function resolveDptDraft(raw: string, options: DptChoice[]): string | null {
  const text = raw.trim();
  if (/^\d+$/.test(text)) {
    const main = Number(text);
    if (!Number.isSafeInteger(main)) return null;
    return String(main);
  }
  const parts = text.match(/^(\d+)\.(\d+)$/);
  if (!parts) return null;
  const canonical = `${Number(parts[1])}.${parts[2].padStart(3, '0')}`;
  const known = (key: string) => options.some(o => o.key === key) || dptDesignation(key) !== '';
  if (known(text)) return text;
  if (canonical !== text && known(canonical)) return canonical;
  return null;
}

/** Index of the draft / closest match in a suggestion list (for open jump). */
function indexForDraft(list: DptChoice[], draftText: string) {
  const q = draftText.trim().toLowerCase();
  if (!q || list.length === 0) return 0;
  const exact = list.findIndex(o => o.key.toLowerCase() === q);
  if (exact >= 0) return exact;
  const prefix = list.findIndex(o => o.key.toLowerCase().startsWith(q));
  if (prefix >= 0) return prefix;
  return 0;
}

/**
 * DPT entry for one row. Editable only once that row has a group address.
 * The suggestion list is portaled and pinned under this field. Reset and the
 * chevron live inside the field so showing the reset does not shift the row.
 */
export function DptField({
  value, options, disabled, overridden, title, onChange, onReset, resetValue, resetTitle,
}: {
  value: string;
  options: DptChoice[];
  disabled: boolean;
  overridden: boolean;
  title: string;
  onChange: (next: string) => void;
  onReset: () => void;
  /** Project DPT restored by the reset control — applied like a committed Eingabe. */
  resetValue: string;
  resetTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  /** Filter only after the user types while the list is open. */
  const [typedWhileOpen, setTypedWhileOpen] = useState(false);
  // The field shows a draft. The row DPT (and the write widget) changes only
  // when a valid draft is committed: blur, Enter, or a list pick.
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const [seenValue, setSeenValue] = useState(value);
  if (value !== seenValue) {
    setSeenValue(value);
    setDraft(value);
    // Keep the blur handler on the value this render just adopted.
    // eslint-disable-next-line react-hooks/refs -- mirror the committed DPT into the draft ref
    draftRef.current = value;
  }
  // Close the menu when the field becomes disabled (no valid GA) without an
  // effect, so re-enabling it does not pop the suggestions back open.
  const [prevDisabled, setPrevDisabled] = useState(disabled);
  if (disabled !== prevDisabled) {
    setPrevDisabled(disabled);
    if (disabled) {
      setOpen(false);
      setTypedWhileOpen(false);
    }
  }
  const shellRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // A list pick commits through onChange. The blur that follows must not
  // also commit or revert the text from before the pick.
  const pickedRef = useRef(false);
  // After a pick that keeps DPT focus, select() may call focus() and must not reopen.
  const skipOpenOnFocusRef = useRef(false);

  const setDraftValue = (next: string) => {
    draftRef.current = next;
    setDraft(next);
  };

  const closeList = () => {
    setOpen(false);
    setTypedWhileOpen(false);
  };

  const matches = useMemo(() => {
    if (!typedWhileOpen) return options;
    const q = draft.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.key.toLowerCase().includes(q) || o.name.toLowerCase().includes(q));
  }, [draft, options, typedWhileOpen]);

  // Designation beside the key (catalog/common name); not part of the editable value.
  const designation = useMemo(() => {
    const key = draft.trim();
    if (!key) return '';
    const fromOptions = options.find(o => o.key === key)?.name;
    return fromOptions || dptDesignation(key);
  }, [draft, options]);

  const active = matches.length === 0 ? 0 : Math.min(highlight, matches.length - 1);

  const place = () => {
    const el = shellRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 240);
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    const top = r.bottom + 4;
    const menu = menuRef.current;
    // Avoid setState after mount — re-renders clear select-on-focus.
    if (menu) {
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
      menu.style.width = `${width}px`;
      return;
    }
    setBox({ top, left, width });
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, matches.length]);

  // Opening the list jumps highlight + scroll to the currently entered value.
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      const idx = indexForDraft(matches, draftRef.current);
      setHighlight(idx);
    }
    wasOpen.current = open;
  }, [open, matches]);

  // Scroll only inside the menu — scrollIntoView on the page clears input selection.
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    const menu = menuRef.current;
    const selected = menu.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
    if (!selected) return;
    const m = menu.getBoundingClientRect();
    const o = selected.getBoundingClientRect();
    if (o.bottom > m.bottom) menu.scrollTop += o.bottom - m.bottom;
    else if (o.top < m.top) menu.scrollTop -= m.top - o.top;
  }, [open, active, matches]);

  // Re-assert select-on-focus after the Werthilfe mounts / repositions.
  useLayoutEffect(() => {
    if (!open) return;
    const el = inputRef.current;
    if (el && document.activeElement === el) el.select();
  }, [open, box]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (shellRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      closeList();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selectInput = (opts?: { keepClosed?: boolean }) => {
    const el = inputRef.current;
    if (!el) return;
    if (opts?.keepClosed) skipOpenOnFocusRef.current = true;
    el.focus();
    selectInputText(el);
  };

  /** After a Werthilfe pick, land on the chevron (list stays closed). */
  const focusAfterCommit = () => {
    queueMicrotask(() => chevronRef.current?.focus());
  };

  const commitDraft = () => {
    const next = resolveDptDraft(draftRef.current, options);
    if (next == null) {
      setDraftValue(value);
      return;
    }
    setDraftValue(next);
    if (next !== value) onChange(next);
  };

  const applyChoice = (choice: DptChoice, opts?: { keepListOpen?: boolean }) => {
    pickedRef.current = true;
    setDraftValue(choice.key);
    if (choice.key !== value) onChange(choice.key);
    if (opts?.keepListOpen) {
      pickedRef.current = false;
      return;
    }
    closeList();
    focusAfterCommit();
  };

  const pick = (choice: DptChoice) => applyChoice(choice);

  /**
   * Restore the project DPT like a committed field Eingabe / Werthilfe pick:
   * apply the key, close any open list, ignore a following blur revert, land on the chevron.
   */
  const applyReset = () => {
    if (!overridden || !resetValue) return;
    pickedRef.current = true;
    setDraftValue(resetValue);
    closeList();
    onReset();
    focusAfterCommit();
  };

  /**
   * Step to the adjacent DPT and commit it.
   * - Input: current (possibly filtered) list, clamped ends, focus stays in the input.
   * - Chevron: full unfiltered options, wraps, focus stays on the chevron.
   */
  const stepDpt = (
    dir: 1 | -1,
    opts: { list: DptChoice[]; wrap: boolean; focus: 'input' | 'chevron' },
  ) => {
    const { list, wrap, focus } = opts;
    if (list.length === 0) return;
    const currentKey = (draftRef.current || value).trim();
    let idx = list.findIndex(o => o.key === currentKey);
    if (idx < 0) idx = indexForDraft(list, currentKey);
    const next = wrap
      ? (idx + dir + list.length) % list.length
      : Math.max(0, Math.min(list.length - 1, idx + dir));
    const choice = list[next];
    if (!choice) return;
    if (focus === 'chevron') setTypedWhileOpen(false);
    setOpen(true);
    setHighlight(next);
    applyChoice(choice, { keepListOpen: true });
    if (focus === 'chevron') {
      queueMicrotask(() => chevronRef.current?.focus());
    } else {
      selectInput();
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Consume Escape while the Werthilfe is open so a parent (send popover)
      // does not dismiss on the same keypress.
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        closeList();
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      stepDpt(e.key === 'ArrowDown' ? 1 : -1, {
        list: matches,
        wrap: false,
        focus: 'input',
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && matches[active]) {
        pick(matches[active]);
        return;
      }
      commitDraft();
      closeList();
      focusAfterCommit();
    }
  };

  const onChevronKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        closeList();
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      stepDpt(e.key === 'ArrowDown' ? 1 : -1, {
        list: options,
        wrap: true,
        focus: 'chevron',
      });
    }
  };

  return (
    <>
      <div
        ref={shellRef}
        className="glass-input"
        data-dpt-field
        onMouseDown={e => {
          if (disabled) return;
          const target = e.target as HTMLElement;
          if (target.closest('[data-dpt-reset], [data-dpt-chevron]')) return;
          if (e.defaultPrevented) return;
          const input = inputRef.current;
          if (e.target === input && document.activeElement === input) return;
          e.preventDefault();
          setTypedWhileOpen(false);
          setOpen(true);
          input?.focus();
        }}
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          width: '100%',
          minWidth: '5.75rem',
          maxWidth: '100%',
          boxSizing: 'border-box',
          padding: '0.2rem 0.3rem 0.2rem 0.35rem',
          gap: '0.25rem',
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <input
          ref={inputRef}
          aria-label="Datapoint type"
          value={draft}
          disabled={disabled}
          placeholder="—"
          title={title}
          onMouseDown={selectAllMouseDown}
          onChange={e => {
            if (disabled) return;
            setDraftValue(e.target.value);
            setTypedWhileOpen(true);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={e => {
            if (disabled) return;
            const el = e.currentTarget;
            if (skipOpenOnFocusRef.current) {
              skipOpenOnFocusRef.current = false;
              selectInputText(el);
              return;
            }
            setTypedWhileOpen(false);
            setOpen(true);
            selectInputText(el);
          }}
          onBlur={() => {
            if (disabled) { closeList(); return; }
            if (pickedRef.current) { pickedRef.current = false; closeList(); return; }
            commitDraft();
            closeList();
          }}
          onKeyDown={onKeyDown}
          style={{
            width: `${Math.max(draft.length, 1)}ch`,
            flex: 'none',
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            padding: 0,
            color: 'var(--text-main)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.72rem',
          }}
        />
        {designation ? (
          <span
            aria-hidden
            style={{
              fontSize: '0.72rem',
              color: 'var(--text-dim)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0,
              flex: '1 1 auto',
              textAlign: 'left',
              marginLeft: '0.35rem',
              pointerEvents: 'none',
            }}
          >
            {designation}
          </span>
        ) : (
          <span aria-hidden style={{ flex: '1 1 auto', minWidth: 0 }} />
        )}
        <button
          type="button"
          className="icon-button"
          data-dpt-reset
          tabIndex={overridden && !disabled ? 0 : -1}
          aria-hidden={!overridden}
          disabled={disabled || !overridden}
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
          onClick={applyReset}
          title={overridden ? resetTitle : undefined}
          style={{
            color: overridden ? 'var(--warning)' : 'var(--text-dim)',
            padding: '0.05rem',
            visibility: overridden ? 'visible' : 'hidden',
            pointerEvents: overridden ? 'auto' : 'none',
            flexShrink: 0,
          }}
        >
          <RotateCcw size={12} />
        </button>
        <button
          ref={chevronRef}
          type="button"
          className="icon-button"
          data-dpt-chevron
          aria-label="Toggle datapoint type list"
          disabled={disabled}
          tabIndex={disabled ? -1 : 0}
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
          onKeyDown={onChevronKeyDown}
          onClick={() => {
            if (disabled) return;
            if (open) {
              closeList();
              inputRef.current?.blur();
            } else {
              inputRef.current?.focus();
            }
          }}
          style={{
            color: 'var(--text-dim)',
            padding: '0.05rem',
            flexShrink: 0,
            pointerEvents: disabled ? 'none' : undefined,
          }}
        >
          <ChevronDown size={13} />
        </button>
      </div>
      {open && !disabled && matches.length > 0 && box && createPortal(
        <div
          ref={menuRef}
          data-portaled-menu
          role="listbox"
          aria-label="Datapoint types"
          style={{
            position: 'fixed', top: box.top, left: box.left, width: box.width, zIndex: PORTAL_MENU_Z,
            maxHeight: 240, overflowY: 'auto',
            background: 'var(--bg-panel)', border: '1px solid var(--border-color)',
            borderRadius: 8, boxShadow: 'var(--shadow-lg)', padding: '0.25rem',
          }}
        >
          {matches.map((o, i) => (
            <button
              type="button"
              key={o.key}
              role="option"
              aria-selected={i === active}
              onMouseDown={e => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                display: 'flex', alignItems: 'baseline', gap: '0.55rem',
                width: '100%', textAlign: 'left', border: 'none', borderRadius: 6, cursor: 'pointer',
                padding: '0.3rem 0.45rem',
                background: i === active ? 'rgba(99,102,241,0.18)' : 'transparent',
              }}
            >
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: 'var(--text-main)' }}>{o.key}</span>
              {o.name && <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>{o.name}</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
