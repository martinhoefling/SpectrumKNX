import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, RotateCcw } from 'lucide-react';

import { COMMON_DPTS, dptDesignation, type DptChoice } from '../utils/dpt';

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

/**
 * DPT entry for one row. Editable only once that row has a group address.
 * The suggestion list is portaled and pinned under this field. Reset and the
 * chevron live inside the field so showing the reset does not shift the row.
 */
export function DptField({ value, options, disabled, overridden, title, onChange, onReset, resetTitle }: {
  value: string;
  options: DptChoice[];
  disabled: boolean;
  overridden: boolean;
  title: string;
  onChange: (next: string) => void;
  onReset: () => void;
  resetTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  // The field shows a draft. The row DPT (and the write widget) changes only
  // when a valid draft is committed: blur, Enter, or a list pick.
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const [seenValue, setSeenValue] = useState(value);
  if (value !== seenValue) {
    setSeenValue(value);
    setDraft(value);
    draftRef.current = value;
  }
  // Close the menu when the field becomes disabled (no valid GA) without an
  // effect, so re-enabling it does not pop the suggestions back open.
  const [prevDisabled, setPrevDisabled] = useState(disabled);
  if (disabled !== prevDisabled) {
    setPrevDisabled(disabled);
    if (disabled) setOpen(false);
  }
  const shellRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // A list pick commits through onChange. The blur that follows must not
  // also commit or revert the text from before the pick.
  const pickedRef = useRef(false);
  // Arrow navigation moves the highlight; Enter with an open list always
  // picks the highlighted row. Enter with the list closed commits the draft.
  const keyboardNav = useRef(false);

  const setDraftValue = (next: string) => {
    draftRef.current = next;
    setDraft(next);
  };

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    const exact = options.some(o => o.key.toLowerCase() === q);
    if (!q || exact) return options;
    return options.filter(o => o.key.toLowerCase().includes(q) || o.name.toLowerCase().includes(q));
  }, [draft, options]);

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
    setBox({ top: r.bottom + 4, left, width });
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

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (shellRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const commitDraft = () => {
    const next = resolveDptDraft(draftRef.current, options);
    if (next == null) {
      setDraftValue(value);
      return;
    }
    setDraftValue(next);
    if (next !== value) onChange(next);
  };

  const pick = (choice: DptChoice) => {
    pickedRef.current = true;
    keyboardNav.current = false;
    setDraftValue(choice.key);
    onChange(choice.key);
    setOpen(false);
    // Drop focus so the next click opens the list again instead of only
    // placing a caret in an already-focused field.
    inputRef.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      keyboardNav.current = true;
      if (!open) { setOpen(true); return; }
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      setHighlight(h => {
        const current = Math.min(h, Math.max(matches.length - 1, 0));
        return Math.max(0, Math.min(matches.length - 1, current + dir));
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
      setOpen(false);
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
          // Keep the caret when the press lands in the input; anywhere else
          // in the shell still focuses it and opens the list.
          if (e.target !== inputRef.current) e.preventDefault();
          keyboardNav.current = false;
          setHighlight(0);
          setOpen(true);
          inputRef.current?.focus();
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
          onChange={e => {
            keyboardNav.current = false;
            setDraftValue(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => { if (!disabled) { setOpen(true); setHighlight(0); } }}
          onBlur={() => {
            if (pickedRef.current) { pickedRef.current = false; setOpen(false); return; }
            commitDraft();
            setOpen(false);
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
              pointerEvents: 'none',
            }}
          >
            {designation}
          </span>
        ) : null}
        <button
          type="button"
          className="icon-button"
          data-dpt-reset
          tabIndex={overridden && !disabled ? 0 : -1}
          aria-hidden={!overridden}
          disabled={disabled || !overridden}
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
          onClick={() => { if (overridden) onReset(); }}
          title={overridden ? resetTitle : undefined}
          style={{
            color: overridden ? 'var(--warning)' : 'var(--text-dim)',
            padding: '0.05rem',
            visibility: overridden ? 'visible' : 'hidden',
            pointerEvents: overridden ? 'auto' : 'none',
            flexShrink: 0,
            marginLeft: 'auto',
          }}
        >
          <RotateCcw size={12} />
        </button>
        <button
          type="button"
          className="icon-button"
          data-dpt-chevron
          aria-label="Toggle datapoint type list"
          disabled={disabled}
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
          onClick={() => {
            if (disabled) return;
            if (open) {
              setOpen(false);
              inputRef.current?.blur();
            } else {
              inputRef.current?.focus();
            }
          }}
          style={{ color: 'var(--text-dim)', padding: '0.05rem', flexShrink: 0 }}
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
