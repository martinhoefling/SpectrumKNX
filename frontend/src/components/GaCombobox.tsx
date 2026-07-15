import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock } from 'lucide-react';

import type { FilterOption } from '../types/filters';

interface Props {
  value: string;
  /** Called on every change. `option` is set only when picked from the list. */
  onChange: (address: string, option?: FilterOption) => void;
  options: FilterOption[];
  /** Recently used addresses, newest first — the only suggestions while the input is empty (#187, #190). */
  recentAddresses?: string[];
  placeholder?: string;
  width?: number | string;
}

/**
 * Themed searchable group-address picker. Filters by address or name and still
 * allows typing an arbitrary address (free entry), unlike a native <datalist>
 * which the browser renders unthemed.
 */
export function GaCombobox({ value, onChange, options, recentAddresses, placeholder, width = 220 }: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const { matches, recentCount } = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (q !== '') {
      const list = options.filter(
        o => (o.address ?? '').toLowerCase().includes(q) || (o.name ?? '').toLowerCase().includes(q)
      );
      return { matches: list.slice(0, 100), recentCount: 0 };
    }
    // Empty input: only the recently used addresses, newest first (#190) —
    // the full project list appears once the user starts typing.
    const byAddress = new Map(options.filter(o => o.address).map(o => [o.address!, o]));
    const recent = (recentAddresses ?? []).map(a => byAddress.get(a) ?? ({ address: a } as FilterOption));
    return { matches: recent, recentCount: recent.length };
  }, [value, options, recentAddresses]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const pick = (o: FilterOption) => {
    onChange(o.address ?? '', o);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && open && matches[highlight]) { e.preventDefault(); pick(matches[highlight]); }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', width }}>
      <input
        className="glass-input"
        value={value}
        placeholder={placeholder}
        onChange={e => { onChange(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        style={{ width: '100%', fontFamily: "'JetBrains Mono', monospace" }}
      />
      {open && matches.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50,
          width: 'max(100%, 260px)', maxHeight: 280, overflowY: 'auto',
          background: 'var(--bg-panel)', backdropFilter: 'var(--glass-blur)',
          border: '1px solid var(--border-color)', borderRadius: 8, boxShadow: 'var(--shadow-lg)',
          padding: '0.25rem',
        }}>
          {matches.map((o, i) => (
            <button
              key={o.address}
              onMouseDown={e => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.1rem',
                width: '100%', textAlign: 'left', border: 'none', borderRadius: 6, cursor: 'pointer',
                padding: '0.35rem 0.5rem',
                background: i === highlight ? 'var(--bg-hover)' : 'transparent',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem', color: 'var(--text-main)' }}>
                {o.address}
                {i < recentCount && <Clock size={11} style={{ color: 'var(--text-dim)' }} />}
              </span>
              {o.name && <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{o.name}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
