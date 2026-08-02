import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { dptKey, type FilterOption } from '../types/filters';
import { dptWidthLabel } from '../utils/dpt';

interface DptTypeTreeProps {
  entries: FilterOption[];
  /** Active DPT filter keys: "1.001" for one subtype, bare "1" for a whole main type. */
  selected: string[];
  onChange: (keys: string[]) => void;
  counts?: Record<string, number>;
  mode: 'live' | 'history';
  searchQuery: string;
}

type CheckState = 'checked' | 'partial' | 'unchecked';

const TriCheckbox: React.FC<{ state: CheckState; onClick: () => void; label: string }> = ({ state, onClick, label }) => (
  <div
    role="checkbox"
    aria-checked={state === 'checked' ? true : state === 'partial' ? 'mixed' : false}
    aria-label={label}
    onClick={e => { e.stopPropagation(); onClick(); }}
    style={{
      width: 14, height: 14, flexShrink: 0, borderRadius: 3, cursor: 'pointer',
      border: `1.5px solid ${state !== 'unchecked' ? 'var(--accent-primary)' : 'var(--border-color)'}`,
      background: state === 'checked' ? 'var(--accent-primary)' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.15s',
    }}
  >
    {state === 'checked' && (
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )}
    {state === 'partial' && (
      <div style={{ width: 6, height: 2, background: 'var(--accent-primary)', borderRadius: 1 }} />
    )}
  </div>
);

const CountBubble: React.FC<{ count: number }> = ({ count }) => (
  <span style={{
    fontSize: '0.65rem', fontWeight: 600, minWidth: '1.8rem', textAlign: 'center',
    padding: '0.1rem 0.4rem', borderRadius: '999px', flexShrink: 0,
    background: count > 0 ? 'rgba(99,102,241,0.15)' : 'var(--bg-tag)',
    color: count > 0 ? 'var(--accent-primary)' : 'var(--text-dim)',
    border: count > 0 ? '1px solid rgba(99,102,241,0.3)' : '1px solid var(--border-color)',
  }}>
    {count}
  </span>
);

/**
 * DPT filter as a tree of main data types (grouped by bit/byte width, #273).
 * The group checkbox toggles the bare main-type key, which the filter logic
 * (`matchesDpt`) already treats as "every subtype of this main type".
 */
export const DptTypeTree: React.FC<DptTypeTreeProps> = ({
  entries, selected, onChange, counts, mode, searchQuery,
}) => {
  // Explicit user choice wins; otherwise groups with a selection (or an active
  // search, whose matches would be invisible in collapsed groups) start open.
  const [openState, setOpenState] = useState<Record<number, boolean>>({});

  const groups = useMemo(() => {
    const byMain = new Map<number, FilterOption[]>();
    for (const e of entries) {
      if (e.main == null) continue;
      const list = byMain.get(e.main) ?? [];
      list.push(e);
      byMain.set(e.main, list);
    }
    return [...byMain.entries()]
      .sort(([a], [b]) => a - b)
      .map(([main, opts]) => ({
        main,
        options: opts.sort((a, b) => (a.sub ?? 0) - (b.sub ?? 0)),
        childKeys: opts.map(o => dptKey(o.main!, o.sub)),
      }));
  }, [entries]);

  const inGroup = (main: number, key: string) => key === `${main}` || key.startsWith(`${main}.`);

  const groupState = (main: number, childKeys: string[]): CheckState => {
    if (selected.includes(`${main}`)) return 'checked';
    const picked = childKeys.filter(k => selected.includes(k)).length;
    if (picked === 0) return 'unchecked';
    return picked === childKeys.length ? 'checked' : 'partial';
  };

  const toggleGroup = (main: number, childKeys: string[]) => {
    const rest = selected.filter(k => !inGroup(main, k));
    onChange(groupState(main, childKeys) === 'checked' ? rest : [...rest, `${main}`]);
  };

  const toggleChild = (main: number, childKeys: string[], key: string) => {
    if (selected.includes(`${main}`)) {
      // The whole main type was selected — keep every other subtype selected.
      onChange([
        ...selected.filter(k => k !== `${main}`),
        ...childKeys.filter(k => k !== key && !selected.includes(k)),
      ]);
    } else {
      onChange(selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key]);
    }
  };

  const groupCount = (main: number): number =>
    Object.entries(counts ?? {})
      .filter(([k]) => inGroup(main, k))
      .reduce((sum, [, c]) => sum + c, 0);

  return (
    <div>
      {groups.map(({ main, options, childKeys }) => {
        const state = groupState(main, childKeys);
        const open = openState[main] ?? (searchQuery !== '' || state !== 'unchecked');
        const width = dptWidthLabel(main);
        return (
          <div key={main}>
            <div
              onClick={() => setOpenState(prev => ({ ...prev, [main]: !open }))}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.25rem',
                borderRadius: '5px', cursor: 'pointer', userSelect: 'none',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              {open ? (
                <ChevronDown size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
              ) : (
                <ChevronRight size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
              )}
              <TriCheckbox state={state} onClick={() => toggleGroup(main, childKeys)} label={`DPT ${main}`} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '0.8125rem', color: 'var(--text-main)', fontFamily: "'JetBrains Mono', monospace",
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{`DPT ${main}`}</div>
                {width && (
                  <div style={{
                    fontSize: '0.65rem', color: 'var(--text-dim)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{width}</div>
                )}
              </div>
              {mode === 'live' && counts && <CountBubble count={groupCount(main)} />}
            </div>

            {open && options.map(o => {
              const key = dptKey(o.main!, o.sub);
              const checked = selected.includes(`${main}`) || selected.includes(key);
              return (
                <div
                  key={key}
                  onClick={() => toggleChild(main, childKeys, key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                    padding: '0.3rem 0.25rem', paddingLeft: '1.55rem',
                    borderRadius: '5px', cursor: 'pointer', userSelect: 'none',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <TriCheckbox state={checked ? 'checked' : 'unchecked'} onClick={() => toggleChild(main, childKeys, key)} label={key} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div title={key} style={{
                      fontSize: '0.8125rem', color: 'var(--text-main)', fontFamily: "'JetBrains Mono', monospace",
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{key}</div>
                    {o.label && o.label !== key && (
                      <div title={o.label} style={{
                        fontSize: '0.65rem', color: 'var(--text-dim)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{o.label}</div>
                    )}
                  </div>
                  {mode === 'live' && counts && <CountBubble count={counts[key] ?? 0} />}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
