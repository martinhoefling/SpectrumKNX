import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Filter, Clock, ChevronUp, ChevronDown, Send } from 'lucide-react';
import { apiUrl } from '../utils/basePath';
import type { Telegram } from '../hooks/useWebSocket';

// Sortable table of group addresses with their last seen values (#269).
// Used by the building view for a KO's linked GAs and a function's GAs.

export interface GaTableEntry {
  address: string;
  name: string;
  role?: string;
  /** The GA this KO sends on (first ETS link of a transmitting object). */
  sending?: boolean;
}

type SortKey = 'ga' | 'name' | 'role' | 'time';

interface GaValuesTableProps {
  entries: GaTableEntry[];
  /** Indentation depth, matching the surrounding tree rows. */
  depth: number;
  /** Newest telegram from the live websocket feed; used to update values in place. */
  latestTelegram?: Telegram | null;
  onFilterGAs: (addresses: string[]) => void;
  onLastSeen: (address: string | string[], mode: 'ga' | 'pa') => void;
}

const gaSortValue = (address: string): number => {
  const parts = address.split('/').map(Number);
  if (parts.some(Number.isNaN)) return Number.MAX_SAFE_INTEGER;
  return parts.reduce((acc, p) => acc * 2048 + p, 0);
};

function ageOf(timestamp: string): string {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  if (diffMs < 60_000) return `${Math.max(0, Math.round(diffMs / 1000))}s ago`;
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)}h ago`;
  return `${Math.round(diffMs / 86_400_000)}d ago`;
}

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
  entries, depth, latestTelegram, onFilterGAs, onLastSeen,
}) => {
  const [valuesByGA, setValuesByGA] = useState<Record<string, Telegram>>({});
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);

  const addresses = useMemo(() => [...new Set(entries.map(e => e.address))], [entries]);
  const addressSet = useMemo(() => new Set(addresses), [addresses]);

  const fetchValues = useCallback(async () => {
    if (addresses.length === 0) return;
    try {
      const res = await fetch(
        apiUrl(`/api/telegrams/last?target_address=${encodeURIComponent(addresses.join(','))}`)
      );
      const json = await res.json();
      const map: Record<string, Telegram> = {};
      for (const t of (json.telegrams ?? []) as Telegram[]) map[t.target_address] = t;
      setValuesByGA(map);
    } catch {
      // network errors are non-fatal; the table just shows "never seen"
    }
  }, [addresses]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchValues();
  }, [fetchValues]);

  // Keep values current from the live feed without re-fetching.
  useEffect(() => {
    if (!latestTelegram || !addressSet.has(latestTelegram.target_address)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValuesByGA(prev => ({ ...prev, [latestTelegram.target_address]: latestTelegram }));
  }, [latestTelegram, addressSet]);

  const handleSort = (key: SortKey) =>
    setSort(prev => {
      if (prev?.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null; // third click restores ETS order
    });

  const hasRole = entries.some(e => e.role);

  const sorted = useMemo(() => {
    if (!sort) return entries;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...entries].sort((a, b) => {
      switch (sort.key) {
        case 'ga':
          return dir * (gaSortValue(a.address) - gaSortValue(b.address));
        case 'name':
          return dir * (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
        case 'role':
          return dir * (a.role || '').localeCompare(b.role || '', undefined, { sensitivity: 'base' });
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
            {hasRole && <HeaderCell label="Role" sortKey="role" sort={sort} onSort={handleSort} />}
            <HeaderCell label="Value" sort={sort} onSort={handleSort} />
            <HeaderCell label="Time" sortKey="time" sort={sort} onSort={handleSort} />
            <th style={{ ...cellStyle, borderBottom: '1px solid var(--border-subtle)', width: '1%' }} />
          </tr>
        </thead>
        <tbody>
          {sorted.map(entry => {
            const t = valuesByGA[entry.address];
            return (
              <tr
                key={entry.address}
                style={entry.sending ? { background: 'rgba(99,102,241,0.08)' } : undefined}
                title={entry.sending ? 'Sending group address' : undefined}
              >
                <td style={{ ...cellStyle, width: '1%' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      color: 'var(--accent-primary)',
                      fontWeight: entry.sending ? 700 : 400,
                    }}>{entry.address}</span>
                    {entry.sending && (
                      <Send size={10} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} aria-label="sending" />
                    )}
                  </span>
                </td>
                <td style={{ ...cellStyle, maxWidth: 0, color: 'var(--text-dim)' }} title={entry.name || undefined}>
                  {entry.name || '—'}
                </td>
                {hasRole && (
                  <td style={{ ...cellStyle, width: '1%' }}>
                    {entry.role ? (
                      <span style={{
                        fontSize: '0.62rem', fontWeight: 600, color: 'var(--text-dim)',
                        textTransform: 'uppercase', background: 'var(--bg-tag)',
                        padding: '0.05rem 0.25rem', borderRadius: '3px',
                      }}>{entry.role}</span>
                    ) : '—'}
                  </td>
                )}
                <td style={{ ...cellStyle, width: '1%', fontWeight: 600, color: t ? 'var(--text-main)' : 'var(--text-dim)' }}>
                  {t ? (
                    <>
                      {t.value_formatted ?? t.value_numeric ?? '—'}
                      {t.unit && <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}> {t.unit}</span>}
                    </>
                  ) : 'never seen'}
                </td>
                <td
                  style={{ ...cellStyle, width: '1%', color: 'var(--text-dim)' }}
                  title={t ? `Last updated: ${new Date(t.timestamp).toLocaleString()}\nby ${t.source_address}${t.source_name ? ` (${t.source_name})` : ''}` : 'Never updated'}
                >
                  {t ? ageOf(t.timestamp) : '—'}
                </td>
                <td style={{ ...cellStyle, width: '1%' }}>
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
