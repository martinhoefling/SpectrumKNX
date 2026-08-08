import React, { useState, useMemo, useContext } from 'react';
import { format } from 'date-fns';
import { Filter, Clock, LineChart, ChevronUp, ChevronDown } from 'lucide-react';
import { GaNameWidthContext } from '../utils/gaNameWidth';
import { useLastSeenValues } from '../hooks/useLastSeenValues';
import { SendToGaPopover } from './SendToGaPopover';
import type { Telegram } from '../hooks/useWebSocket';

// Sortable table of group addresses with their last seen values (#269).
// Used by the building view for a KO's linked GAs and a function's GAs (#306).

export interface GaTableEntry {
  address: string;
  name: string;
  /** DPT of the address, resolved from the project (#295). */
  dpt?: { main: number; sub: number | null; name?: string | null };
  /** The GA this KO sends on (first ETS link of a transmitting object). */
  sending?: boolean;
}

type SortKey = 'ga' | 'name' | 'time';

interface GaValuesTableProps {
  entries: GaTableEntry[];
  /** Indentation depth, matching the surrounding tree rows. */
  depth: number;
  /** Newest telegram from the live websocket feed; used to update values in place. */
  latestTelegram?: Telegram | null;
  /** Show the per-row "send to this GA" action when the bus is writable. */
  writeEnabled?: boolean;
  onFilterGAs: (addresses: string[]) => void;
  onLastSeen: (address: string | string[], mode: 'ga' | 'pa') => void;
  /** Open the visualization panel plotting this GA (#307). */
  onVisualizeGAs: (addresses: string[]) => void;
}

const gaSortValue = (address: string): number => {
  const parts = address.split('/').map(Number);
  if (parts.some(Number.isNaN)) return Number.MAX_SAFE_INTEGER;
  return parts.reduce((acc, p) => acc * 2048 + p, 0);
};

// "1.011 - Switch" → "1.011 Switch"; falls back to the bare "main.sub" number (#295).
const formatDptLabel = (dpt?: GaTableEntry['dpt']): string | null => {
  if (!dpt || dpt.main == null) return null;
  const num = dpt.sub != null ? `${dpt.main}.${String(dpt.sub).padStart(3, '0')}` : String(dpt.main);
  let desc = '';
  if (dpt.name) {
    const sep = dpt.name.indexOf(' - ');
    desc = sep >= 0 ? dpt.name.slice(sep + 3) : dpt.name === num ? '' : dpt.name;
  }
  return desc ? `${num} ${desc}` : num;
};

const cellStyle: React.CSSProperties = {
  padding: '0.25rem 0.5rem',
  fontSize: '0.72rem',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  textAlign: 'left',
  verticalAlign: 'middle',
};

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--text-dim)', padding: '0.15rem', borderRadius: '3px',
  display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle',
};

const HeaderCell: React.FC<{
  label: string;
  sortKey?: SortKey;
  sort: { key: SortKey; dir: 'asc' | 'desc' } | null;
  onSort: (key: SortKey) => void;
}> = ({ label, sortKey, sort, onSort }) => {
  const active = sortKey != null && sort?.key === sortKey;
  return (
    <th
      style={{
        ...cellStyle,
        fontSize: '0.62rem', fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.04em', color: 'var(--text-dim)',
        cursor: sortKey ? 'pointer' : 'default', userSelect: 'none',
        borderBottom: '1px solid var(--border-subtle)',
      }}
      onClick={sortKey ? (e => { e.stopPropagation(); onSort(sortKey); }) : undefined}
      title={sortKey ? `Sort by ${label.toLowerCase()}` : undefined}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
        {label}
        {active && (sort!.dir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
      </span>
    </th>
  );
};

export const GaValuesTable: React.FC<GaValuesTableProps> = ({
  entries, depth, latestTelegram, writeEnabled, onFilterGAs, onLastSeen, onVisualizeGAs,
}) => {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
  const nameWidthCh = useContext(GaNameWidthContext);
  const nameColumnStyle: React.CSSProperties = nameWidthCh
    ? { width: `${nameWidthCh}ch`, maxWidth: `${nameWidthCh}ch` }
    : { maxWidth: 300 };

  const addresses = useMemo(() => entries.map(e => e.address), [entries]);
  const valuesByGA = useLastSeenValues(addresses, latestTelegram);

  const handleSort = (key: SortKey) =>
    setSort(prev => {
      if (prev?.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null; // third click restores ETS order
    });

  const sorted = useMemo(() => {
    if (!sort) return entries;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...entries].sort((a, b) => {
      switch (sort.key) {
        case 'ga':
          return dir * (gaSortValue(a.address) - gaSortValue(b.address));
        case 'name':
          return dir * (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
        case 'time': {
          // Never-seen entries always sort to the end.
          const ta = valuesByGA[a.address] ? new Date(valuesByGA[a.address].timestamp).getTime() : null;
          const tb = valuesByGA[b.address] ? new Date(valuesByGA[b.address].timestamp).getTime() : null;
          if (ta === null && tb === null) return 0;
          if (ta === null) return 1;
          if (tb === null) return -1;
          return dir * (ta - tb);
        }
      }
    });
  }, [entries, sort, valuesByGA]);

  return (
    <div style={{ padding: `0.15rem 0.75rem 0.4rem ${0.75 + depth * 1.1}rem` }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
        <thead>
          <tr>
            <HeaderCell label="GA" sortKey="ga" sort={sort} onSort={handleSort} />
            <HeaderCell label="Name" sortKey="name" sort={sort} onSort={handleSort} />
            <HeaderCell label="DPT" sort={sort} onSort={handleSort} />
            <HeaderCell label="Time" sortKey="time" sort={sort} onSort={handleSort} />
            <HeaderCell label="Value" sort={sort} onSort={handleSort} />
            <th style={{ ...cellStyle, borderBottom: '1px solid var(--border-subtle)', width: '1%' }} />
          </tr>
        </thead>
        <tbody>
          {sorted.map(entry => {
            const t = valuesByGA[entry.address];
            const dptLabel = formatDptLabel(entry.dpt);
            return (
              <tr
                key={entry.address}
                style={entry.sending ? { background: 'rgba(99,102,241,0.08)' } : undefined}
                title={entry.sending ? 'Sending group address' : undefined}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = entry.sending ? 'rgba(99,102,241,0.08)' : 'transparent')}
              >
                <td style={{ ...cellStyle, width: '1%' }}>
                  {/* The sending GA is framed rather than icon-tagged (#295). */}
                  <span
                    aria-label={entry.sending ? 'sending' : undefined}
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      color: 'var(--accent-primary)',
                      fontWeight: entry.sending ? 700 : 400,
                      ...(entry.sending
                        ? {
                            display: 'inline-block',
                            border: '1px solid var(--accent-primary)',
                            borderRadius: '4px',
                            padding: '0.02rem 0.3rem',
                          }
                        : {}),
                    }}
                  >{entry.address}</span>
                </td>
                <td style={{ ...cellStyle, ...nameColumnStyle, color: 'var(--text-dim)' }} title={entry.name || undefined}>
                  {entry.name || '—'}
                </td>
                <td style={{ ...cellStyle, width: '1%', color: 'var(--text-dim)' }} title={dptLabel || undefined}>
                  {dptLabel || '—'}
                </td>
                <td
                  style={{ ...cellStyle, width: '1%', color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}
                  title={t ? `by ${t.source_address}${t.source_name ? ` (${t.source_name})` : ''}` : 'Never updated'}
                >
                  {t ? format(new Date(t.timestamp), 'yyyy-MM-dd HH:mm:ss.SS') : ''}
                </td>
                <td style={{ ...cellStyle, fontWeight: 600, color: t ? 'var(--text-main)' : 'var(--text-dim)' }}>
                  {t && (
                    <>
                      {t.value_formatted ?? t.value_numeric ?? '—'}
                      {t.unit && <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}> {t.unit}</span>}
                    </>
                  )}
                </td>
                <td style={{ ...cellStyle, width: '1%' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    {writeEnabled && entry.dpt?.main != null && (
                      <SendToGaPopover
                        address={entry.address}
                        name={entry.name}
                        dptMain={entry.dpt.main}
                        dptSub={entry.dpt.sub}
                        buttonStyle={iconBtnStyle}
                      />
                    )}
                    <button
                      style={iconBtnStyle}
                      title="Visualize this group address"
                      onClick={e => { e.stopPropagation(); onVisualizeGAs([entry.address]); }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
                    >
                      <LineChart size={11} />
                    </button>
                    <button
                      style={iconBtnStyle}
                      title="Filter by this group address"
                      onClick={e => { e.stopPropagation(); onFilterGAs([entry.address]); }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
                    >
                      <Filter size={11} />
                    </button>
                    <button
                      style={iconBtnStyle}
                      title="Show last seen values"
                      onClick={e => { e.stopPropagation(); onLastSeen([entry.address], 'ga'); }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
                    >
                      <Clock size={11} />
                    </button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
