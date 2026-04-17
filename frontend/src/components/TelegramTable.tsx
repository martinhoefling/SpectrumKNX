import React, { useMemo } from 'react';
import { format } from 'date-fns';
import type { Telegram } from '../hooks/useWebSocket';
import { ChevronUp, ChevronDown } from 'lucide-react';

export type SortKey = 'timestamp' | 'source_address' | 'target_address' | 'simplified_type' | 'dpt_name' | 'value_numeric';

export interface SortConfig {
  key: SortKey;
  direction: 'asc' | 'desc';
}

interface TelegramTableProps {
  telegrams: Telegram[];
  visibleColumns: { [key: string]: boolean };
  sortConfig: SortConfig;
  onSort: (key: SortKey) => void;
}

interface SortIconProps {
  column: SortKey;
  sortConfig: SortConfig;
}

const SortIcon = ({ column, sortConfig }: SortIconProps) => {
  if (sortConfig.key !== column) return null;
  return sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
};

const getTypeColor = (type?: string | null) => {
  switch (type) {
    case 'Write': return 'var(--accent-primary)';
    case 'Read': return '#fbbf24';
    case 'Response': return '#10b981';
    default: return 'var(--text-dim)';
  }
};

const getDPTColor = (dpt_main: number | null) => {
  if (dpt_main === 1) return 'var(--dpt-1, #818cf8)';
  if (dpt_main === 5) return 'var(--dpt-5, #34d399)';
  if (dpt_main === 9) return 'var(--dpt-9, #fb923c)';
  return 'var(--dpt-unknown, #6b7280)';
};

export const TelegramTable: React.FC<TelegramTableProps> = ({ telegrams, visibleColumns, sortConfig, onSort }) => {

  // Compute time deltas between consecutive rows (by visual order)
  const telegramRows = useMemo(() => {
    return telegrams.map((t, idx) => {
      let deltaStr: string | null = null;
      if (idx > 0) {
        const curr = new Date(t.timestamp).getTime();
        const prev = new Date(telegrams[idx - 1].timestamp).getTime();
        const diffMs = Math.abs(curr - prev);
        const mm = String(Math.floor(diffMs / 60000)).padStart(2, '0');
        const ss = String(Math.floor((diffMs % 60000) / 1000)).padStart(2, '0');
        const ms = String(diffMs % 1000).padStart(3, '0');
        deltaStr = `+ ${mm}:${ss}.${ms}`;
      }
      return { ...t, deltaStr };
    });
  }, [telegrams]);

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-panel)', zIndex: 10, backdropFilter: 'blur(8px)' }}>
        <tr style={{ textAlign: 'left', color: 'var(--text-dim)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <th style={{ padding: '0.75rem 1rem', width: '130px' }}><button className="sort-header" onClick={() => onSort('timestamp')}>TIME <SortIcon column="timestamp" sortConfig={sortConfig} /></button></th>
          <th style={{ padding: '0.75rem 1rem', width: '200px' }}><button className="sort-header" onClick={() => onSort('source_address')}>SOURCE <SortIcon column="source_address" sortConfig={sortConfig} /></button></th>
          <th style={{ padding: '0.75rem 1rem', width: '240px' }}><button className="sort-header" onClick={() => onSort('target_address')}>TARGET <SortIcon column="target_address" sortConfig={sortConfig} /></button></th>
          {visibleColumns.type && <th style={{ padding: '0.75rem 1rem', width: '110px' }}><button className="sort-header" onClick={() => onSort('simplified_type')}>TYPE <SortIcon column="simplified_type" sortConfig={sortConfig} /></button></th>}
          {visibleColumns.dpt && <th style={{ padding: '0.75rem 1rem', width: '140px' }}><button className="sort-header" onClick={() => onSort('dpt_name')}>DPT <SortIcon column="dpt_name" sortConfig={sortConfig} /></button></th>}
          <th style={{ padding: '0.75rem 1rem', minWidth: '180px' }}><button className="sort-header" onClick={() => onSort('value_numeric')}>VALUE <SortIcon column="value_numeric" sortConfig={sortConfig} /></button></th>
        </tr>
      </thead>
      <tbody>
        {telegramRows.length === 0 ? (
          <tr><td colSpan={20} style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.875rem' }}>No data available.</td></tr>
        ) : telegramRows.map((t, idx) => (
          <tr key={`${t.timestamp}-${idx}`} className="log-row" style={{ borderBottom: '1px solid var(--border-color)', fontSize: '0.8125rem' }}>

            {/* Time + Delta subtitle */}
            <td style={{ padding: '0.75rem 1rem' }}>
              <div className="mono-addr" style={{ color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums' }}>
                {format(new Date(t.timestamp), 'HH:mm:ss.SS')}
              </div>
              {visibleColumns.delta && t.deltaStr && (
                <div className="subtitle-name">{t.deltaStr}</div>
              )}
            </td>

            {/* Source + Name subtitle */}
            <td style={{ padding: '0.75rem 1rem' }}>
              <div className="mono-addr highlight">{t.source_address}</div>
              {visibleColumns.sourceName && (
                <div className="subtitle-name">{t.source_name || '-'}</div>
              )}
            </td>

            {/* Target + Name subtitle */}
            <td style={{ padding: '0.75rem 1rem' }}>
              <div className="mono-addr highlight-target">{t.target_address}</div>
              {visibleColumns.targetName && (
                <div className="subtitle-name" style={{ color: 'var(--text-main)', fontWeight: 500 }}>{t.target_name || '-'}</div>
              )}
            </td>

            {/* Type */}
            {visibleColumns.type && (
              <td style={{ padding: '0.75rem 1rem' }}>
                <div style={{ color: getTypeColor(t.simplified_type), fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  {t.simplified_type || t.telegram_type}
                </div>
                <div style={{ fontSize: '0.65rem', color: '#10b981', marginTop: '0.1rem', opacity: 0.8 }}>Incoming</div>
              </td>
            )}

            {/* DPT */}
            {visibleColumns.dpt && (
              <td style={{ padding: '0.75rem 1rem' }}>
                {t.dpt_name ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: getDPTColor(t.dpt_main), flexShrink: 0 }} />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{t.dpt_name}</span>
                  </div>
                ) : '-'}
              </td>
            )}

            {/* Value + Raw hex subtitle */}
            <td style={{ padding: '0.75rem 1rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontSize: '0.9375rem', wordBreak: 'break-word', whiteSpace: 'normal' }}>
                  {t.value_formatted || (t.value_numeric !== null ? String(t.value_numeric) : '-')}
                </span>
                {t.unit && <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontWeight: 500 }}>{t.unit}</span>}
              </div>
              {visibleColumns.data && t.raw_hex && (
                <div className="raw-badge" style={{ marginTop: '0.2rem' }}>{t.raw_hex}</div>
              )}
            </td>

          </tr>
        ))}
      </tbody>
    </table>
  );
};
