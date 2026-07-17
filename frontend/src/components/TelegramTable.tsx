import React, { useMemo, useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Telegram } from '../hooks/useWebSocket';
import { ChevronUp, ChevronDown, Filter, LineChart, X, Clock } from 'lucide-react';
import { dptKey, type ActiveFilters } from '../types/filters';
import { SendToGaPopover } from './SendToGaPopover';
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
  /** Enables the per-row "Send to this GA" quick popover; true only when the bus is writable (#214). */
  canSend?: boolean;
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

const ROW_ESTIMATE = 85; // matches the virtualizer's estimateSize

// Identity of a telegram for anchor tracking across list updates (#202).
// No index fallback here — the same telegram must map to the same key in
// consecutive lists even when its position shifts.
const anchorKey = (t: Telegram) =>
  `${t.timestamp}-${t.source_address}-${t.target_address}-${t.raw_hex ?? ''}`;

export const TelegramTable: React.FC<TelegramTableProps> = ({
  telegrams, visibleColumns, sortConfig, onSort, activeFilters, onQuickFilter, onQuickVisualize, onQuickLastSeen, canSend
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
    estimateSize: () => ROW_ESTIMATE, // Better estimate for multi-line rows
    overscan: 10,
    getItemKey: (index) => {
      const t = telegramRows[index];
      return `${t.timestamp}-${t.source_address}-${t.target_address}-${t.raw_hex || index}`;
    },
  });

  // ── ETS-style scroll anchoring (#202) ───────────────────────────────────────
  // Auto-scroll only while the scrollbar sits at the live edge (top for
  // newest-first, bottom for oldest-first). Scrolled away, the viewed rows are
  // anchored — new telegrams keep filling the list and a pill offers the way
  // back. Only meaningful for the timestamp sort, where the live edge exists.
  //
  // Rows are dynamically measured (ResizeObserver), so a new row enters the
  // layout at the 85px estimate and later shrinks to its real height. Estimate-
  // based math therefore can't keep an anchored row still. Instead we track a
  // concrete anchor row by key and, after each update, correct scrollTop by the
  // real pixel delta of that row's position — re-run on the next frame so the
  // async re-measure of prepended rows is absorbed too.
  const isTimeSort = sortConfig.key === 'timestamp';
  const liveEdge = sortConfig.direction === 'desc' ? 'top' : 'bottom';
  const atEdgeRef = useRef(true);
  const [newSinceAnchor, setNewSinceAnchor] = useState(0);
  // The row pinned to the top of the viewport while anchored, and its offset
  // from the scroll-container top. Captured from user scrolls only.
  const anchorRef = useRef<{ key: string; offset: number } | null>(null);
  const programmaticScrollRef = useRef(false);

  // Suppress edge/anchor tracking for scrolls we cause ourselves. Auto-clears on
  // the next frame so a no-op programmatic scroll can't swallow a later real one.
  const markProgrammatic = () => {
    programmaticScrollRef.current = true;
    requestAnimationFrame(() => { programmaticScrollRef.current = false; });
  };

  const rowOffset = (key: string): number | null => {
    const el = parentRef.current;
    if (!el) return null;
    const row = el.querySelector<HTMLElement>(`[data-akey="${CSS.escape(key)}"]`);
    if (!row) return null;
    return row.getBoundingClientRect().top - el.getBoundingClientRect().top;
  };

  const checkAtEdge = () => {
    const el = parentRef.current;
    if (!el) return true;
    // Small threshold to handle precision issues
    return liveEdge === 'top'
      ? el.scrollTop < 20
      : el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
  };

  // Record the top-most visible row so we can pin it across list updates.
  const captureAnchor = () => {
    const el = parentRef.current;
    if (!el) return;
    const cTop = el.getBoundingClientRect().top;
    for (const row of el.querySelectorAll<HTMLElement>('.log-row')) {
      const rr = row.getBoundingClientRect();
      if (rr.bottom - cTop > 0) {
        const key = row.getAttribute('data-akey');
        if (key) anchorRef.current = { key, offset: rr.top - cTop };
        return;
      }
    }
  };

  const handleScroll = () => {
    // Ignore the scrolls our own compensation triggers.
    if (programmaticScrollRef.current) return;
    const atEdge = checkAtEdge();
    atEdgeRef.current = atEdge;
    if (atEdge) {
      setNewSinceAnchor(0);
      anchorRef.current = null;
    } else {
      captureAnchor();
    }
  };

  const scrollToEdge = () => {
    markProgrammatic();
    virtualizer.scrollToOffset(liveEdge === 'top' ? 0 : virtualizer.getTotalSize());
  };

  const jumpToLive = () => {
    atEdgeRef.current = true;
    anchorRef.current = null;
    setNewSinceAnchor(0);
    scrollToEdge();
  };

  // Correct scrollTop so the anchored row keeps its recorded viewport offset.
  // Only the top (newest-first) edge needs this — bottom-appends don't move the
  // content above the viewport.
  const pinAnchor = () => {
    const el = parentRef.current;
    const anchor = anchorRef.current;
    if (!el || !anchor || atEdgeRef.current || liveEdge !== 'top') return;
    const now = rowOffset(anchor.key);
    if (now == null) return;
    const delta = now - anchor.offset;
    if (Math.abs(delta) > 0.5) {
      markProgrammatic();
      el.scrollTop += delta;
    }
  };

  // Changing sort moves (or removes) the live edge — drop the anchor state.
  useEffect(() => {
    setNewSinceAnchor(0);
    anchorRef.current = null;
    atEdgeRef.current = checkAtEdge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortConfig]);

  // React to list updates before paint: follow the live edge, or pin the
  // anchored row by correcting scrollTop by its real pixel shift.
  const prevRowsRef = useRef<{ firstKey: string | null; lastKey: string | null; len: number }>({
    firstKey: null, lastKey: null, len: 0,
  });
  useLayoutEffect(() => {
    const rows = telegramRows;
    const prev = prevRowsRef.current;
    const firstKey = rows.length > 0 ? anchorKey(rows[0]) : null;
    const lastKey = rows.length > 0 ? anchorKey(rows[rows.length - 1]) : null;
    prevRowsRef.current = { firstKey, lastKey, len: rows.length };

    if (!isTimeSort || prev.len === 0 || rows.length === 0) return;

    const edgeKey = liveEdge === 'top' ? firstKey : lastKey;
    const prevEdgeKey = liveEdge === 'top' ? prev.firstKey : prev.lastKey;
    if (!prevEdgeKey || edgeKey === prevEdgeKey) return; // nothing new at the live edge

    // How many rows appeared at the live edge (for the pill count).
    let added = -1;
    if (liveEdge === 'top') {
      for (let i = 0; i < rows.length; i++) if (anchorKey(rows[i]) === prevEdgeKey) { added = i; break; }
    } else {
      for (let i = rows.length - 1; i >= 0; i--) if (anchorKey(rows[i]) === prevEdgeKey) { added = rows.length - 1 - i; break; }
    }

    if (added <= 0) {
      // Previous edge vanished: list replaced (clear / filter / history load).
      anchorRef.current = null;
      setNewSinceAnchor(0);
      return;
    }

    if (atEdgeRef.current) {
      scrollToEdge();
      return;
    }

    setNewSinceAnchor(n => n + added);
    pinAnchor(); // pre-paint; the total-size effect re-pins after re-measure
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegramRows]);

  // Re-pin whenever the measured content size changes. Prepended rows enter at
  // the 85px estimate and shrink to their real height a frame later (async
  // ResizeObserver), shifting everything below; this fires on that re-measure
  // and cancels the shift, so the anchored row stays put across variable heights.
  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    pinAnchor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalSize]);

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
              {canSend && (
                <SendToGaPopover
                  address={t.target_address}
                  name={t.target_name}
                  dptMain={t.dpt_main}
                  dptSub={t.dpt_sub}
                  buttonClassName="quick-send-btn"
                />
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

      {/* Body area — relative wrapper so the jump-to-live pill (#202) anchors
          below the header, not over it. */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Jump-to-live pill — shown while anchored away from the edge (#202) */}
      {isTimeSort && newSinceAnchor > 0 && (
        <button
          onClick={jumpToLive}
          className="jump-to-live-pill"
          style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            [liveEdge]: '1rem', zIndex: 20,
          }}
          title="Jump back to the live edge"
        >
          {liveEdge === 'top' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {newSinceAnchor.toLocaleString()} new telegram{newSinceAnchor === 1 ? '' : 's'}
        </button>
      )}

      {/* Virtualized Body */}
      <div
        ref={parentRef}
        onScroll={handleScroll}
        // overflow-anchor off: we compensate scrollTop manually on prepend (#202),
        // so the browser's native anchoring must not also move the viewport.
        style={{ flex: 1, overflowY: 'auto', position: 'relative', overflowAnchor: 'none' }}
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
                  data-akey={anchorKey(t)}
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

  .jump-to-live-pill {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.85rem;
    border: 1px solid var(--accent-primary);
    border-radius: 999px;
    background: var(--accent-primary);
    color: white;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    box-shadow: var(--shadow-lg);
    transition: transform 0.15s, filter 0.15s;
  }

  .jump-to-live-pill:hover {
    filter: brightness(1.08);
    transform: translateX(-50%) scale(1.03);
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
