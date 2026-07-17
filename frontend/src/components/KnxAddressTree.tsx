import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { SendToGaPopover } from './SendToGaPopover';
import type { FilterOption } from '../types/filters';

interface KnxAddressTreeProps {
  entries: FilterOption[];
  selected: string[];
  /** Group names keyed by address prefix (e.g. {"0": "Zentral", "0/1": "Wetter"} or {"1": "", "1.0": "EG"}) */
  groupNames: Record<string, string>;
  /** separator: '/' for GAs, '.' for PAs */
  separator: '/' | '.';
  onToggle: (addresses: string[]) => void;
  counts?: Record<string, number>;
  mode: 'live' | 'history';
  searchQuery: string;
  onLastSeen?: (address: string) => void;
  writeEnabled?: boolean;
}

type CheckState = 'checked' | 'partial' | 'unchecked';

function getCheckState(leafAddresses: string[], selected: string[]): CheckState {
  const count = leafAddresses.filter(a => selected.includes(a)).length;
  if (count === 0) return 'unchecked';
  if (count === leafAddresses.length) return 'checked';
  return 'partial';
}

interface TriCheckboxProps {
  state: CheckState;
  onClick: () => void;
}

const TriCheckbox: React.FC<TriCheckboxProps> = ({ state, onClick }) => (
  <div
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

interface LeafRowProps {
  address: string;
  name: string;
  dptMain?: number | null;
  dptSub?: number | null;
  checked: boolean;
  count?: number;
  mode: 'live' | 'history';
  onToggle: () => void;
  onLastSeen?: () => void;
  isGA?: boolean;
  writeEnabled?: boolean;
}

const LeafRow: React.FC<LeafRowProps> = ({
  address, name, dptMain, dptSub, checked, count, mode, onToggle, onLastSeen, isGA, writeEnabled,
}) => {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.25rem',
        borderRadius: '5px', cursor: 'pointer', userSelect: 'none',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; setHovered(true); }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; setHovered(false); }}
    >
      <TriCheckbox state={checked ? 'checked' : 'unchecked'} onClick={onToggle} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div title={address} style={{
          fontSize: '0.8125rem', color: 'var(--text-main)', fontFamily: "'JetBrains Mono', monospace",
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{address}</div>
        {name && (
          <div title={name} style={{
            fontSize: '0.65rem', color: 'var(--text-dim)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{name}</div>
        )}
      </div>
      {writeEnabled && isGA && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            opacity: hovered ? 0.8 : 0,
            transition: 'opacity 0.15s',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = hovered ? '0.8' : '0'; }}
        >
          <SendToGaPopover
            address={address}
            name={name}
            dptMain={dptMain}
            dptSub={dptSub}
            buttonStyle={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-dim)', padding: '0.15rem', borderRadius: '3px',
              display: 'flex', alignItems: 'center',
            }}
          />
        </div>
      )}
      {onLastSeen && (
        <button
          onClick={e => { e.stopPropagation(); onLastSeen(); }}
          title="Show last seen values"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-dim)', padding: '0.15rem', borderRadius: '3px',
            display: 'flex', alignItems: 'center',
            opacity: hovered ? 0.8 : 0,
            transition: 'opacity 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={e => { e.stopPropagation(); (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.color = 'var(--accent-primary)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = hovered ? '0.8' : '0'; (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'; }}
        >
          <Clock size={12} />
        </button>
      )}
      {mode === 'live' && count !== undefined && (
        <span style={{
          fontSize: '0.65rem', fontWeight: 600, minWidth: '1.8rem', textAlign: 'center',
          padding: '0.1rem 0.4rem', borderRadius: '999px',
          background: count > 0 ? 'rgba(99,102,241,0.15)' : 'var(--bg-tag)',
          color: count > 0 ? 'var(--accent-primary)' : 'var(--text-dim)',
          border: count > 0 ? '1px solid rgba(99,102,241,0.3)' : '1px solid var(--border-color)',
          flexShrink: 0,
        }}>{count}</span>
      )}
    </div>
  );
};

interface GroupNodeProps {
  label: string;
  sublabel?: string;
  leafAddresses: string[];
  selected: string[];
  children: React.ReactNode;
  defaultOpen?: boolean;
  onToggleAll: () => void;
}

const GroupNode: React.FC<GroupNodeProps> = ({ label, sublabel, leafAddresses, selected, children, defaultOpen = true, onToggleAll }) => {
  const [open, setOpen] = useState(defaultOpen);
  const state = getCheckState(leafAddresses, selected);

  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '0.4rem',
          padding: '0.3rem 0.25rem', borderRadius: '5px', cursor: 'pointer',
          userSelect: 'none',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <TriCheckbox state={state} onClick={onToggleAll} />
        <div style={{ flex: 1, minWidth: 0 }} onClick={() => setOpen(o => !o)}>
          <div title={label} style={{
            fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{label}</div>
          {sublabel && (
            <div title={sublabel} style={{
              fontSize: '0.65rem', color: 'var(--text-dim)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{sublabel}</div>
          )}
        </div>
        <div onClick={() => setOpen(o => !o)} style={{ color: 'var(--text-dim)', flexShrink: 0, display: 'flex' }}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
      </div>
      {open && <div style={{ paddingLeft: '1.25rem' }}>{children}</div>}
    </div>
  );
};

export const KnxAddressTree: React.FC<KnxAddressTreeProps> = ({
  entries, selected, groupNames, separator, onToggle, counts, mode, searchQuery, onLastSeen, writeEnabled,
}) => {
  const q = searchQuery.toLowerCase();

  // Build tree structure: level1 → level2 → leaves
  const tree = useMemo(() => {
    const map = new Map<string, Map<string, FilterOption[]>>();
    for (const entry of entries) {
      const parts = entry.address!.split(separator);
      const l1 = parts[0];
      const l2 = parts.length >= 2 ? `${parts[0]}${separator}${parts[1]}` : l1;
      if (!map.has(l1)) map.set(l1, new Map());
      const l1map = map.get(l1)!;
      if (!l1map.has(l2)) l1map.set(l2, []);
      l1map.get(l2)!.push(entry);
    }
    return map;
  }, [entries, separator]);

  // Filter entries by search query
  const matchesSearch = (entry: FilterOption) =>
    !q || entry.address!.toLowerCase().includes(q) || (entry.name ?? '').toLowerCase().includes(q);

  return (
    <div>
      {[...tree.entries()].map(([l1Key, l2map]) => {
        const allL1Leaves = [...l2map.values()].flat().map(e => e.address!);
        const visibleL2 = [...l2map.entries()].filter(([, leaves]) =>
          leaves.some(matchesSearch)
        );
        if (visibleL2.length === 0) return null;

        const l1Name = groupNames[l1Key] || '';
        const l1Label = l1Name ? `${l1Key} — ${l1Name}` : l1Key;

        // If all leaves are in a single l2 group with the same key as l1 (2-part address), skip l1 level
        const singleGroup = l2map.size === 1 && [...l2map.keys()][0] === l1Key;

        if (singleGroup) {
          // Only 1 level deep — render leaves directly under a single group node
          const leaves = [...l2map.values()][0].filter(matchesSearch);
          return (
            <GroupNode
              key={l1Key}
              label={l1Label}
              leafAddresses={allL1Leaves}
              selected={selected}
              onToggleAll={() => {
                const state = getCheckState(allL1Leaves, selected);
                if (state === 'checked') {
                  onToggle(selected.filter(a => !allL1Leaves.includes(a)));
                } else {
                  onToggle([...new Set([...selected, ...allL1Leaves])]);
                }
              }}
            >
              {leaves.map(e => (
                <LeafRow key={e.address} address={e.address!} name={e.name ?? ''} checked={selected.includes(e.address!)}
                  dptMain={e.main} dptSub={e.sub}
                  count={counts?.[e.address!]} mode={mode}
                  onToggle={() => onToggle(selected.includes(e.address!) ? selected.filter(a => a !== e.address) : [...selected, e.address!])}
                  onLastSeen={onLastSeen ? () => onLastSeen(e.address!) : undefined}
                  isGA={separator === '/'} writeEnabled={writeEnabled}
                />
              ))}
            </GroupNode>
          );
        }

        return (
          <GroupNode
            key={l1Key}
            label={l1Label}
            leafAddresses={allL1Leaves}
            selected={selected}
            onToggleAll={() => {
              const state = getCheckState(allL1Leaves, selected);
              if (state === 'checked') {
                onToggle(selected.filter(a => !allL1Leaves.includes(a)));
              } else {
                onToggle([...new Set([...selected, ...allL1Leaves])]);
              }
            }}
          >
            {visibleL2.map(([l2Key, leaves]) => {
              const visibleLeaves = leaves.filter(matchesSearch);
              if (visibleLeaves.length === 0) return null;
              const l2Leaves = leaves.map(e => e.address!);
              const l2Name = groupNames[l2Key] || '';
              const l2Label = l2Name ? `${l2Key} — ${l2Name}` : l2Key;

              return (
                <GroupNode
                  key={l2Key}
                  label={l2Label}
                  leafAddresses={l2Leaves}
                  selected={selected}
                  defaultOpen={false}
                  onToggleAll={() => {
                    const state = getCheckState(l2Leaves, selected);
                    if (state === 'checked') {
                      onToggle(selected.filter(a => !l2Leaves.includes(a)));
                    } else {
                      onToggle([...new Set([...selected, ...l2Leaves])]);
                    }
                  }}
                >
                  {visibleLeaves.map(e => (
                    <LeafRow key={e.address} address={e.address!} name={e.name ?? ''} checked={selected.includes(e.address!)}
                      dptMain={e.main} dptSub={e.sub}
                      count={counts?.[e.address!]} mode={mode}
                      onToggle={() => onToggle(selected.includes(e.address!) ? selected.filter(a => a !== e.address) : [...selected, e.address!])}
                      onLastSeen={onLastSeen ? () => onLastSeen(e.address!) : undefined}
                      isGA={separator === '/'} writeEnabled={writeEnabled}
                    />
                  ))}
                </GroupNode>
              );
            })}
          </GroupNode>
        );
      })}
    </div>
  );
};
