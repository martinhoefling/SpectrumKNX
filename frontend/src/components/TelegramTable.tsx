import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Telegram } from '../hooks/useWebSocket';
import { ChevronUp, ChevronDown, Filter, LineChart, X, Clock, Send } from 'lucide-react';
import { dptKey, type ActiveFilters } from '../types/filters';
import { getCookie, setCookie } from '../utils/cookies';

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
  activeFilters: ActiveFilters;
  onQuickFilter: (key: 'sources' | 'targets' | 'types' | 'dpts', value: string | number) => void;
  onQuickVisualize: (targetAddress: string) => void;
  onQuickLastSeen?: (address: string, mode: 'ga' | 'pa') => void;
  /** Copies the row's GA into the send bar; only passed when the bus is writable (#187). */
  onQuickSend?: (targetAddress: string) => void;
}

type ColId = 'time' | 'delta' | 'source' | 'target' | 'type' | 'dpt' | 'value';

interface ColumnDef {
  id: ColId;
  label: string;
  sortKey?: SortKey;
  defaultWidth: number;
  minWidth: number;
  /** key in visibleColumns that toggles this column (undefined = always visible) */
  visibleKey?: string;
}

// Ordered column definitions — drives both header and body so they cannot drift.
const COLUMNS: ColumnDef[] = [
  { id: 'time', label: 'TIME', sortKey: 'timestamp', defaultWidth: 120, minWidth: 90 },
  { id: 'delta', label: 'Δt', defaultWidth: 100, minWidth: 60, visibleKey: 'delta' },
  { id: 'source', label: 'SOURCE', sortKey: 'source_address', defaultWidth: 190, minWidth: 90 },
  { id: 'target', label: 'TARGET', sortKey: 'target_address', defaultWidth: 230, minWidth: 90 },
  { id: 'type', label: 'TYPE', sortKey: 'simplified_type', defaultWidth: 95, minWidth: 70, visibleKey: 'type' },
  { id: 'dpt', label: 'DPT', sortKey: 'dpt_name', defaultWidth: 150, minWidth: 80, visibleKey: 'dpt' },
  { id: 'value', label: 'VALUE', sortKey: 'value_numeric', defaultWidth: 220, minWidth: 120 },
];

const COLUMN_WIDTHS_COOKIE = 'columnWidths';

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

const getDPTLabel = (dpt_main: number | null) => {
  if (dpt_main === 1) return 'DPT 1.x – Binary / Switch';
  if (dpt_main === 5) return 'DPT 5.x – 8-bit unsigned';
  if (dpt_main === 9) return 'DPT 9.x – 2-byte float';
  if (dpt_main != null) return `DPT ${dpt_main}.x`;
  return 'Unknown DPT';
};

type TelegramRow = Telegram & { deltaStr: string | null };

const cellPadding = '0.75rem 1rem'; // Unified padding for all cells

export const TelegramTable: React.FC<TelegramTableProps> = ({
  telegrams, visibleColumns, sortConfig, onSort, activeFilters, onQuickFilter, onQuickVisualize, onQuickLastSeen, onQuickSend
}) => {
  const parentRef = useRef<HTMLDivElement>(null);

  // ── Column widths (persisted to a cookie, shared across live & history views) ──
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const defaults: Record<string, number> = {};
    for (const c of COLUMNS) defaults[c.id] = c.defaultWidth;
    try {
      const saved = getCookie(COLUMN_WIDTHS_COOKIE);
      if (saved) return { ...defaults, ...JSON.parse(saved) };
    } catch {
      // Ignore malformed cookie
    }
    return defaults;
  });

  const widthFor = useCallback(
    (id: ColId) => columnWidths[id] ?? COLUMNS.find(c => c.id === id)!.defaultWidth,
    [columnWidths],
  );

  const persistWidths = useCallback((widths: Record<string, number>) => {
    setCookie(COLUMN_WIDTHS_COOKIE, JSON.stringify(widths));
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent, col: ColumnDef) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widthFor(col.id);
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(col.minWidth, Math.round(startWidth + (ev.clientX - startX)));
      setColumnWidths(prev => ({ ...prev, [col.id]: next }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setColumnWidths(prev => { persistWidths(prev); return prev; });
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [widthFor, persistWidths]);

  // Double-click a handle to reset that column to its default width.
  const handleResetWidth = useCallback((col: ColumnDef) => {
    setColumnWidths(prev => {
      const next = { ...prev, [col.id]: col.defaultWidth };
      persistWidths(next);
      return next;
    });
  }, [persistWidths]);

  // Compute time deltas between consecutive rows (by visual order)
  const telegramRows = useMemo<TelegramRow[]>(() => {
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

  // Visible columns in order, and the matching CSS grid template.
  // The delta column is only meaningful when sorting by time, so hide it otherwise.
  const visibleCols = useMemo(
    () => COLUMNS.filter(c => {
      if (c.id === 'delta') return visibleColumns.delta && sortConfig.key === 'timestamp';
      return !c.visibleKey || visibleColumns[c.visibleKey];
    }),
    [visibleColumns, sortConfig.key],
  );

  const gridTemplate = useMemo(
    () => visibleCols
      .map((c, i) => {
        const w = widthFor(c.id);
        // Final column absorbs remaining horizontal space.
        return i === visibleCols.length - 1 ? `minmax(${w}px, 1fr)` : `${w}px`;
      })
      .join(' '),
    [visibleCols, widthFor],
  );

  const renderSortArrow = (key: SortKey) =>
    sortConfig.key === key && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />);

  // ── Per-cell body content (keyed switch keeps body aligned with header order) ──
  const renderCell = (id: ColId, t: TelegramRow): React.ReactNode => {
    switch (id) {
      case 'time':
        return (
          <div style={{ padding: cellPadding }}>
            <div className="mono-addr" style={{ color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
              {format(new Date(t.timestamp), 'HH:mm:ss.SS')}
            </div>
            <div className="subtitle-name" style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '0.15rem', fontVariantNumeric: 'tabular-nums' }}>
              {format(new Date(t.timestamp), 'yyyy-MM-dd')}
            </div>
          </div>
        );

      case 'delta':
        return (
          <div style={{ padding: cellPadding }}>
            {t.deltaStr && (
              <div className="mono-addr" style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
                {t.deltaStr}
              </div>
            )}
          </div>
        );

      case 'source':
        return (
          <div style={{ padding: cellPadding, minWidth: 0, overflow: 'hidden' }} className="filterable-cell">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
              <div className="mono-addr highlight" style={{ color: 'var(--text-dim)', fontWeight: 400 }}>
                {t.source_address}
              </div>
              <button
                className={`quick-filter-btn ${activeFilters.sources.includes(t.source_address) ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); onQuickFilter('sources', t.source_address); }}
                title="Toggle source filter"
              >
                <Filter className="filter-icon" size={12} />
                <X className="cancel-icon" size={12} />
              </button>
              {onQuickLastSeen && (
                <button
                  className="quick-last-seen-btn"
                  onClick={(e) => { e.stopPropagation(); onQuickLastSeen(t.source_address, 'pa'); }}
                  title="Show last seen values for this device"
                >
                  <Clock size={12} />
                </button>
              )}
            </div>
            {visibleColumns.sourceName && (
              <div className="subtitle-name" title={t.source_name || undefined} style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.source_name || '-'}
              </div>
            )}
          </div>
        );

      case 'target':
        return (
          <div style={{ padding: cellPadding, minWidth: 0, overflow: 'hidden' }} className="filterable-cell">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
              <div className="mono-addr highlight-target" style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>
                {t.target_address}
              </div>
              <button
                className={`quick-filter-btn ${activeFilters.targets.includes(t.target_address) ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); onQuickFilter('targets', t.target_address); }}
                title="Toggle target filter"
              >
                <Filter className="filter-icon" size={12} />
                <X className="cancel-icon" size={12} />
              </button>
              {onQuickLastSeen && (
                <button
                  className="quick-last-seen-btn"
                  onClick={(e) => { e.stopPropagation(); onQuickLastSeen(t.target_address, 'ga'); }}
                  title="Show last seen values for this GA"
                >
                  <Clock size={12} />
                </button>
              )}
              {onQuickSend && (
                <button
                  className="quick-send-btn"
                  onClick={(e) => { e.stopPropagation(); onQuickSend(t.target_address); }}
                  title="Send to this GA"
                >
                  <Send size={12} />
                </button>
              )}
            </div>
            {visibleColumns.targetName && (
              <div className="subtitle-name" title={t.target_name || undefined} style={{ fontSize: '0.7rem', color: 'var(--text-main)', fontWeight: 500, marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.target_name || '-'}
              </div>
            )}
          </div>
        );

      case 'type':
        return (
          <div style={{ padding: cellPadding, minWidth: 0, overflow: 'hidden' }} className="filterable-cell">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
              <div style={{ color: getTypeColor(t.simplified_type), fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                {t.simplified_type || t.telegram_type}
              </div>
              <button
                className={`quick-filter-btn ${activeFilters.types.includes(t.simplified_type || t.telegram_type) ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); onQuickFilter('types', t.simplified_type || t.telegram_type); }}
                title="Toggle type filter"
              >
                <Filter className="filter-icon" size={12} />
                <X className="cancel-icon" size={12} />
              </button>
            </div>
            <div style={{ fontSize: '0.65rem', color: t.direction === 'Outgoing' ? '#f59e0b' : '#10b981', marginTop: '0.1rem', opacity: 0.8 }}>{t.direction === 'Outgoing' ? 'Outgoing' : 'Incoming'}</div>
          </div>
        );

      case 'dpt':
        return (
          <div style={{ padding: cellPadding, minWidth: 0, overflow: 'hidden' }} className="filterable-cell">
            {t.dpt_name && t.dpt_main != null ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                <div title={getDPTLabel(t.dpt_main)} style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: getDPTColor(t.dpt_main), flexShrink: 0 }} />
                <span title={t.dpt_name ?? undefined} style={{ fontSize: '0.75rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{t.dpt_name}</span>
                <button
                  className={`quick-filter-btn ${activeFilters.dpts.includes(dptKey(t.dpt_main, t.dpt_sub)) ? 'active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); if (t.dpt_main != null) onQuickFilter('dpts', dptKey(t.dpt_main, t.dpt_sub)); }}
                  title="Toggle DPT filter"
                >
                  <Filter className="filter-icon" size={12} />
                  <X className="cancel-icon" size={12} />
                </button>
              </div>
            ) : '-'}
          </div>
        );

      case 'value':
        return (
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
              <div className="raw-badge" style={{ marginTop: '0.4rem', background: 'var(--bg-tag)', padding: '0.1rem 0.3rem', borderRadius: '3px', fontSize: '0.65rem', color: 'var(--text-dim)', display: 'inline-block', fontFamily: 'var(--font-mono)' }}>
                {t.raw_hex}
              </div>
            )}
          </div>
        );
    }
  };

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
        {visibleCols.map((c, i) => (
          <div key={c.id} style={{ padding: cellPadding, position: 'relative' }}>
            {c.sortKey ? (
              <button className="sort-header" onClick={() => onSort(c.sortKey!)}>
                {c.label} {renderSortArrow(c.sortKey)}
              </button>
            ) : (
              <span>{c.label}</span>
            )}
            {i < visibleCols.length - 1 && (
              <div
                className="col-resize-handle"
                onMouseDown={(e) => handleResizeStart(e, c)}
                onDoubleClick={() => handleResetWidth(c)}
                title="Drag to resize · double-click to reset"
              />
            )}
          </div>
        ))}
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
                    background: virtualRow.index % 2 === 0 ? 'var(--bg-subtle)' : 'transparent',
                    alignItems: 'start',
                    minHeight: '60px' // Ensure a minimum touch/visual target
                  }}
                  className="log-row"
                >
                  {visibleCols.map(c => (
                    <React.Fragment key={c.id}>{renderCell(c.id, t)}</React.Fragment>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// Add styles for quick filter buttons and resize handles
const style = document.createElement('style');
style.textContent = `
  .quick-filter-btn, .quick-visualize-btn, .quick-last-seen-btn, .quick-send-btn {
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
    position: relative;
  }

  .quick-filter-btn.active {
    opacity: 1;
    color: var(--accent-primary);
  }

  .quick-filter-btn .cancel-icon {
    display: none;
  }

  .quick-filter-btn.active:hover .filter-icon {
    display: none;
  }

  .quick-filter-btn.active:hover .cancel-icon {
    display: block;
    color: #ef4444; /* red for cancel */
  }

  .log-row:hover .quick-filter-btn:not(.active),
  .log-row:hover .quick-visualize-btn,
  .log-row:hover .quick-last-seen-btn,
  .log-row:hover .quick-send-btn {
    opacity: 0.6;
  }

  .quick-filter-btn:hover, .quick-visualize-btn:hover, .quick-last-seen-btn:hover, .quick-send-btn:hover {
    opacity: 1 !important;
    background: var(--bg-hover);
    color: var(--accent-primary);
    transform: scale(1.1);
  }

  .quick-visualize-btn:hover {
    color: #10b981;
  }

  .quick-last-seen-btn:hover {
    color: var(--accent-primary);
  }

  .col-resize-handle {
    position: absolute;
    top: 0;
    right: -4px;
    width: 8px;
    height: 100%;
    cursor: col-resize;
    z-index: 2;
    user-select: none;
  }

  .col-resize-handle::after {
    content: '';
    position: absolute;
    top: 20%;
    right: 3px;
    width: 2px;
    height: 60%;
    background: transparent;
    border-radius: 1px;
    transition: background 0.15s;
  }

  .col-resize-handle:hover::after {
    background: var(--accent-primary);
  }
`;
document.head.appendChild(style);
