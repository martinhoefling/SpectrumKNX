import React, { useMemo, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Telegram } from '../hooks/useWebSocket';
import { ChevronUp, ChevronDown, Filter, LineChart } from 'lucide-react';

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
  onQuickFilter: (key: 'sources' | 'targets' | 'types' | 'dpts', value: string | number) => void;
  onQuickVisualize: (targetAddress: string) => void;
}

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

export const TelegramTable: React.FC<TelegramTableProps> = ({ 
  telegrams, visibleColumns, sortConfig, onSort, onQuickFilter, onQuickVisualize 
}) => {
  const parentRef = useRef<HTMLDivElement>(null);

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

  const virtualizer = useVirtualizer({
    count: telegramRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 85, // Better estimate for multi-line rows
    overscan: 10,
    getItemKey: (index) => {
      const t = telegramRows[index];
      return `${t.timestamp}-${t.source_address}-${t.target_address}-${t.raw_hex || index}`;
    },
  });

  // Track if we are at the top to handle auto-scroll
  const isAtTopRef = useRef(true);
  const handleScroll = () => {
    if (parentRef.current) {
      // Small threshold to handle precision issues
      isAtTopRef.current = parentRef.current.scrollTop < 20;
    }
  };

  // Handle auto-scroll to top when new telegrams arrive
  const lastFirstIdRef = useRef<string | null>(null);
  useEffect(() => {
    const firstId = telegrams[0]?.timestamp + telegrams[0]?.source_address;
    if (lastFirstIdRef.current && firstId !== lastFirstIdRef.current) {
      if (isAtTopRef.current) {
        // Use scrollToOffset(0) for a more reliable "jump" to top in virtualized lists
        virtualizer.scrollToOffset(0);
      }
    }
    lastFirstIdRef.current = firstId;
  }, [telegrams, virtualizer]);

  // Unified grid layout configuration - shared between header and rows
  const gridTemplate = [
    '120px', // Time (slightly more compact)
    '180px', // Source
    '220px', // Target
    visibleColumns.type ? '100px' : null,
    visibleColumns.dpt ? '130px' : null,
    'minmax(200px, 1fr)', // Value
  ].filter(Boolean).join(' ');

  const cellPadding = '0.75rem 1rem'; // Unified padding for all cells

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div 
        style={{ 
          display: 'grid', 
          gridTemplateColumns: gridTemplate,
          background: 'var(--bg-panel)',
          zIndex: 10,
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
          color: 'var(--text-dim)',
          fontSize: '0.65rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 700,
          // Account for scrollbar width to keep columns aligned with body
          paddingRight: '8px' 
        }}
      >
        <div style={{ padding: cellPadding }}>
          <button className="sort-header" onClick={() => onSort('timestamp')}>
            TIME {sortConfig.key === 'timestamp' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
          </button>
        </div>
        <div style={{ padding: cellPadding }}>
          <button className="sort-header" onClick={() => onSort('source_address')}>
            SOURCE {sortConfig.key === 'source_address' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
          </button>
        </div>
        <div style={{ padding: cellPadding }}>
          <button className="sort-header" onClick={() => onSort('target_address')}>
            TARGET {sortConfig.key === 'target_address' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
          </button>
        </div>
        {visibleColumns.type && (
          <div style={{ padding: cellPadding }}>
            <button className="sort-header" onClick={() => onSort('simplified_type')}>
              TYPE {sortConfig.key === 'simplified_type' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
            </button>
          </div>
        )}
        {visibleColumns.dpt && (
          <div style={{ padding: cellPadding }}>
            <button className="sort-header" onClick={() => onSort('dpt_name')}>
              DPT {sortConfig.key === 'dpt_name' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
            </button>
          </div>
        )}
        <div style={{ padding: cellPadding }}>
          <button className="sort-header" onClick={() => onSort('value_numeric')}>
            VALUE {sortConfig.key === 'value_numeric' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
          </button>
        </div>
      </div>

      {/* Virtualized Body */}
      <div 
        ref={parentRef} 
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', position: 'relative' }}
        className="custom-scrollbar"
      >
        {telegramRows.length === 0 ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.875rem' }}>
            No data available.
          </div>
        ) : (
          <div 
            style={{ 
              height: `${virtualizer.getTotalSize()}px`, 
              width: '100%', 
              position: 'relative' 
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const t = telegramRows[virtualRow.index];
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    display: 'grid',
                    gridTemplateColumns: gridTemplate,
                    borderBottom: '1px solid var(--border-color)',
                    fontSize: '0.8125rem',
                    background: virtualRow.index % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent',
                    alignItems: 'start',
                    minHeight: '60px' // Ensure a minimum touch/visual target
                  }}
                  className="log-row"
                >
                  {/* Time + Delta subtitle */}
                  <div style={{ padding: cellPadding }}>
                    <div className="mono-addr" style={{ color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                      {format(new Date(t.timestamp), 'HH:mm:ss.SS')}
                    </div>
                    {visibleColumns.delta && t.deltaStr && (
                      <div className="subtitle-name" style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '0.15rem' }}>
                        {t.deltaStr}
                      </div>
                    )}
                  </div>

                  {/* Source + Name subtitle */}
                  <div style={{ padding: cellPadding }} className="filterable-cell">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <div className="mono-addr highlight" style={{ color: 'var(--text-dim)', fontWeight: 400 }}>
                        {t.source_address}
                      </div>
                      <button 
                        className="quick-filter-btn" 
                        onClick={(e) => { e.stopPropagation(); onQuickFilter('sources', t.source_address); }}
                        title="Toggle source filter"
                      >
                        <Filter size={12} />
                      </button>
                    </div>
                    {visibleColumns.sourceName && (
                      <div className="subtitle-name" style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.15rem', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.source_name || '-'}
                      </div>
                    )}
                  </div>

                  {/* Target + Name subtitle */}
                  <div style={{ padding: cellPadding }} className="filterable-cell">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <div className="mono-addr highlight-target" style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>
                        {t.target_address}
                      </div>
                      <button 
                        className="quick-filter-btn" 
                        onClick={(e) => { e.stopPropagation(); onQuickFilter('targets', t.target_address); }}
                        title="Toggle target filter"
                      >
                        <Filter size={12} />
                      </button>
                    </div>
                    {visibleColumns.targetName && (
                      <div className="subtitle-name" style={{ fontSize: '0.7rem', color: 'var(--text-main)', fontWeight: 500, marginTop: '0.15rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.target_name || '-'}
                      </div>
                    )}
                  </div>

                  {/* Type */}
                  {visibleColumns.type && (
                    <div style={{ padding: cellPadding }} className="filterable-cell">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <div style={{ color: getTypeColor(t.simplified_type), fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                          {t.simplified_type || t.telegram_type}
                        </div>
                        <button 
                          className="quick-filter-btn" 
                          onClick={(e) => { e.stopPropagation(); onQuickFilter('types', t.simplified_type || t.telegram_type); }}
                          title="Toggle type filter"
                        >
                          <Filter size={12} />
                        </button>
                      </div>
                      <div style={{ fontSize: '0.65rem', color: '#10b981', marginTop: '0.1rem', opacity: 0.8 }}>Incoming</div>
                    </div>
                  )}

                  {/* DPT */}
                  {visibleColumns.dpt && (
                    <div style={{ padding: cellPadding }} className="filterable-cell">
                      {t.dpt_name && t.dpt_main != null ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: getDPTColor(t.dpt_main), flexShrink: 0 }} />
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{t.dpt_name}</span>
                          <button 
                            className="quick-filter-btn" 
                            onClick={(e) => { e.stopPropagation(); if (t.dpt_main != null) onQuickFilter('dpts', t.dpt_main); }}
                            title="Toggle DPT filter"
                          >
                            <Filter size={12} />
                          </button>
                        </div>
                      ) : '-'}
                    </div>
                  )}

                  {/* Value + Raw hex subtitle */}
                  <div style={{ padding: cellPadding }} className="filterable-cell">
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontSize: '0.9375rem', wordBreak: 'break-all', whiteSpace: 'normal', lineHeight: 1.2 }}>
                        {t.value_formatted || (t.value_numeric !== null ? String(t.value_numeric) : '-')}
                      </span>
                      {t.unit && <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontWeight: 500 }}>{t.unit}</span>}
                      
                      <button 
                        className="quick-visualize-btn" 
                        onClick={(e) => { e.stopPropagation(); onQuickVisualize(t.target_address); }}
                        title="Visualize this target"
                      >
                        <LineChart size={14} />
                      </button>
                    </div>
                    {visibleColumns.data && t.raw_hex && (
                      <div className="raw-badge" style={{ marginTop: '0.4rem', background: 'rgba(255,255,255,0.05)', padding: '0.1rem 0.3rem', borderRadius: '3px', fontSize: '0.65rem', color: 'var(--text-dim)', display: 'inline-block', fontFamily: 'var(--font-mono)' }}>
                        {t.raw_hex}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// Add styles for quick filter buttons
const style = document.createElement('style');
style.textContent = `
  .quick-filter-btn, .quick-visualize-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-dim);
    padding: 0.2rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: all 0.2s;
  }
  
  .log-row:hover .quick-filter-btn,
  .log-row:hover .quick-visualize-btn {
    opacity: 0.6;
  }
  
  .quick-filter-btn:hover, .quick-visualize-btn:hover {
    opacity: 1 !important;
    background: rgba(255, 255, 255, 0.1);
    color: var(--accent-primary);
    transform: scale(1.1);
  }

  .quick-visualize-btn:hover {
    color: #10b981;
  }
`;
document.head.appendChild(style);
