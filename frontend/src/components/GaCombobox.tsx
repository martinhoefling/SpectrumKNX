import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Clock } from 'lucide-react';

import type { FilterOption } from '../types/filters';

interface Props {
  value: string;
  /** Called on every change. `option` is set only when picked from the list. */
  onChange: (text: string, option?: FilterOption) => void;
  /**
   * Called when editing finishes without a list pick: Enter with the list
   * closed, or focus leaving the field. A pick reports through `onChange`
   * instead, so a following blur does not commit the pre-pick text.
   */
  onCommit?: (text: string) => void;
  options: FilterOption[];
  /** Recently used addresses, newest first — the only suggestions while the input is empty (#187, #190). */
  recentAddresses?: string[];
  placeholder?: string;
  width?: number | string;
  /**
   * Which property the input and the suggestion's first line show.
   * `name` swaps the two lines (name, then address).
   */
  display?: 'address' | 'name';
}

/**
 * Themed searchable group-address picker. Filters by address or name and still
 * allows typing an arbitrary address (free entry), unlike a native <datalist>
 * which the browser renders unthemed.
 *
 * The suggestion list is portaled to document.body so it cannot expand the
 * write-panel scroll area and shift the row grid.
 */
export function GaCombobox({ value, onChange, onCommit, options, recentAddresses, placeholder, width = 220, display = 'address' }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // A list pick commits through onChange. Blur follows the click and must not
  // also commit the text from before the pick.
  const pickedRef = useRef(false);
  // Arrow navigation must not be undone by the row currently under the pointer.
  const keyboardNav = useRef(false);

  const { matches, recentCount } = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (q !== '') {
      // Rank so the exact match is on top and preselected, ahead of prefix and
      // infix matches — typing "2/4/1" must not leave "12/4/1" as the top hit (#217).
      const rank = (o: FilterOption) => {
        const addr = (o.address ?? '').toLowerCase();
        const name = (o.name ?? '').toLowerCase();
        if (addr === q || name === q) return 0;
        if (addr.startsWith(q) || name.startsWith(q)) return 1;
        return 2;
      };
      const list = options
        .filter(o => (o.address ?? '').toLowerCase().includes(q) || (o.name ?? '').toLowerCase().includes(q))
        .sort((a, b) => rank(a) - rank(b));
      return { matches: list.slice(0, 100), recentCount: 0 };
    }
    // Empty input: only the recently used addresses, newest first (#190) —
    // the full project list appears once the user starts typing.
    const byAddress = new Map(options.filter(o => o.address).map(o => [o.address!, o]));
    const recent = (recentAddresses ?? []).map(a => byAddress.get(a) ?? ({ address: a } as FilterOption));
    return { matches: recent, recentCount: recent.length };
  }, [value, options, recentAddresses]);

  // -1 = no highlight (cleared by typing); otherwise clamp into the list.
  const activeIndex = highlight < 0 || matches.length === 0
    ? -1
    : Math.min(highlight, matches.length - 1);

  const isExact = (text: string) => {
    const q = text.trim().toLowerCase();
    if (!q) return false;
    return options.some(o => {
      const addr = (o.address ?? '').toLowerCase();
      const name = (o.name ?? '').toLowerCase();
      if (display === 'name') return name === q || addr === q;
      return addr === q;
    });
  };

  const place = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const widthPx = Math.max(r.width, 260);
    let left = r.left;
    if (left + widthPx > window.innerWidth - 8) left = Math.max(8, window.innerWidth - widthPx - 8);
    setBox({ top: r.bottom + 4, left, width: widthPx });
  };

  useLayoutEffect(() => {
    if (!open || matches.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- drop portal coords when closed/empty
      setBox(null);
      return;
    }
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, matches.length, value]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const pick = (o: FilterOption) => {
    pickedRef.current = true;
    const text = display === 'name' ? (o.name || o.address || '') : (o.address ?? '');
    onChange(text, o);
    setOpen(false);
  };

  const commitText = () => {
    setOpen(false);
    onCommit?.(value);
  };

  const moveHighlight = (dir: 1 | -1) => {
    if (matches.length === 0) return;
    keyboardNav.current = true;
    setHighlight(h => {
      if (h < 0) return dir > 0 ? 0 : matches.length - 1;
      return Math.max(0, Math.min(matches.length - 1, h + dir));
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (!open) { setOpen(true); setHighlight(0); return; }
      moveHighlight(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && activeIndex >= 0 && matches[activeIndex]) pick(matches[activeIndex]);
      else commitText();
    }
  };

  // Drive intrinsic width from visible text so column measure isn't stuck at the
  // browser's default size=20 (empty "GA" would otherwise reserve ~20ch).
  const size = Math.max(value.length, placeholder?.length ?? 0, 1);

  return (
    <div ref={wrapRef} style={{ position: 'relative', width }}>
      <div
        className="glass-input"
        onMouseDown={e => {
          if ((e.target as HTMLElement).closest('[data-ga-chevron]')) return;
          if (e.target !== inputRef.current) e.preventDefault();
          setHighlight(0);
          setOpen(true);
          inputRef.current?.focus();
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          width: '100%',
          boxSizing: 'border-box',
          padding: '0.2rem 0.3rem 0.2rem 0.35rem',
          gap: '0.25rem',
        }}
      >
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        size={size}
        onChange={e => { pickedRef.current = false; onChange(e.target.value); setOpen(true); setHighlight(-1); }}
        onFocus={() => { pickedRef.current = false; setOpen(true); setHighlight(0); }}
        onBlur={() => {
          if (pickedRef.current) { pickedRef.current = false; setOpen(false); return; }
          // Incomplete text adopts a highlighted suggestion only while one is
          // selected (arrows/hover). Typing clears the highlight so free text stays.
          const incomplete = value.trim() !== '' && !isExact(value);
          const chosen = activeIndex >= 0 ? matches[activeIndex] : undefined;
          if (open && incomplete && chosen) { pick(chosen); return; }
          setOpen(false);
          onCommit?.(value);
        }}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeIndex >= 0 && matches[activeIndex] ? `${listId}-opt-${activeIndex}` : undefined}
        onKeyDown={onKeyDown}
        style={{
          width: `${size}ch`,
          flex: 'none',
          minWidth: 0,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          padding: 0,
          color: 'inherit',
          font: 'inherit',
          fontFamily: display === 'name' ? 'inherit' : "'JetBrains Mono', monospace",
        }}
      />
      <button
        type="button"
        className="icon-button"
        data-ga-chevron
        aria-label="Toggle suggestions"
        onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
        onClick={() => {
          if (open) setOpen(false);
          else {
            setHighlight(0);
            setOpen(true);
            inputRef.current?.focus();
          }
        }}
        style={{ color: 'var(--text-dim)', padding: '0.05rem', flexShrink: 0, marginLeft: 'auto' }}
      >
        <ChevronDown size={13} />
      </button>
      </div>
      {open && matches.length > 0 && box && createPortal(
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          onMouseMove={() => { keyboardNav.current = false; }}
          style={{
            position: 'fixed', top: box.top, left: box.left, width: box.width, zIndex: 80,
            maxHeight: 280, overflowY: 'auto',
            background: 'var(--bg-panel)', backdropFilter: 'var(--glass-blur)',
            border: '1px solid var(--border-color)', borderRadius: 8, boxShadow: 'var(--shadow-lg)',
            padding: '0.25rem',
          }}
        >
          {matches.map((o, i) => {
            const nameFirst = display === 'name';
            const primary = nameFirst ? (o.name || o.address) : o.address;
            const secondary = nameFirst ? (o.name ? o.address : undefined) : o.name;
            const primaryMono = !nameFirst || !o.name;
            const active = i === activeIndex;
            return (
              <button
                type="button"
                key={o.address ?? o.name}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={active}
                data-active={active ? 'true' : 'false'}
                ref={el => { optionRefs.current[i] = el; }}
                onMouseDown={e => { e.preventDefault(); pick(o); }}
                onMouseEnter={() => { if (!keyboardNav.current) setHighlight(i); }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.1rem',
                  width: '100%', textAlign: 'left', border: 'none', borderRadius: 6, cursor: 'pointer',
                  padding: '0.35rem 0.5rem',
                  background: active ? 'rgba(99,102,241,0.18)' : 'transparent',
                  outline: active ? '1px solid var(--accent-primary)' : 'none',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontFamily: primaryMono ? "'JetBrains Mono', monospace" : 'inherit', fontSize: '0.78rem', color: 'var(--text-main)' }}>
                  {primary}
                  {i < recentCount && <Clock size={11} style={{ color: 'var(--text-dim)' }} />}
                </span>
                {secondary && (
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: nameFirst ? "'JetBrains Mono', monospace" : 'inherit' }}>
                    {secondary}
                  </span>
                )}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
