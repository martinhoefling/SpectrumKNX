import React, { useState, useMemo } from 'react';
import { TelegramTable, type SortConfig, type SortKey } from './TelegramTable';
import type { Telegram } from '../hooks/useWebSocket';
import { History, Download, AlertTriangle, Trash2, SlidersHorizontal, LineChart } from 'lucide-react';
import { HistoryLoader } from './HistoryLoader';
import { Visualizer } from './Visualizer';
import {
  FilterPanel,
  hasActiveFilters,
  type ActiveFilters,
  type FilterOptions,
} from './FilterPanel';

interface HistorySearchProps {
  visibleColumns: { [key: string]: boolean };
  loadLimit: number;
  filterOptions: FilterOptions;
  activeFilters: ActiveFilters;
  onFiltersChange: (f: ActiveFilters) => void;
}

export const HistorySearch: React.FC<HistorySearchProps> = ({ visibleColumns, loadLimit, filterOptions, activeFilters, onFiltersChange }) => {
  const [telegrams, setTelegrams] = useState<Telegram[]>([]);
  const [isLoaderOpen, setIsLoaderOpen] = useState(false);
  const [metadata, setMetadata] = useState<{ total_count: number; limit_reached: boolean } | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'timestamp', direction: 'desc' });
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isVisualizerOpen, setIsVisualizerOpen] = useState(false);
  // activeFilters and onFiltersChange come from App.tsx (shared with live view)

  const handleSort = (key: SortKey) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const sortedTelegrams = useMemo(() => {
    const items = [...telegrams];
    items.sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      if (aVal === bVal) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (sortConfig.key === 'timestamp') {
        return sortConfig.direction === 'asc'
          ? new Date(aVal as string).getTime() - new Date(bVal as string).getTime()
          : new Date(bVal as string).getTime() - new Date(aVal as string).getTime();
      }
      return sortConfig.direction === 'asc'
        ? aVal < bVal ? -1 : 1
        : aVal < bVal ? 1 : -1;
    });
    return items;
  }, [telegrams, sortConfig]);

  const handleLoad = (loaded: Telegram[], meta?: { total_count: number; limit_reached: boolean }) => {
    setTelegrams(prev => {
      const existingTs = new Set(prev.map(t => t.timestamp));
      const newUnique = loaded.filter(t => !existingTs.has(t.timestamp));
      const seenNew = new Set<string>();
      const deduped = newUnique.filter(t => {
        if (seenNew.has(t.timestamp)) return false;
        seenNew.add(t.timestamp);
        return true;
      });
      return [...prev, ...deduped];
    });
    setMetadata(meta || null);
  };

  const activeFilterCount = hasActiveFilters(activeFilters)
    ? activeFilters.sources.length + activeFilters.targets.length + activeFilters.types.length + activeFilters.dpts.length
    : 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header / Sub-toolbar */}
      <div style={{
        padding: '0 1.25rem', height: '3.5rem', borderBottom: '1px solid var(--border-color)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {telegrams.length > 0 && (
            <span style={{
              fontSize: '0.75rem', color: 'var(--text-dim)', background: 'rgba(255,255,255,0.05)',
              padding: '0.2rem 0.6rem', borderRadius: '999px', border: '1px solid var(--border-color)',
            }}>
              {telegrams.length.toLocaleString()} telegrams
            </span>
          )}
          {metadata?.limit_reached && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: '#fbbf24' }}>
              <AlertTriangle size={13} /> Limit reached
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {/* Filter toggle */}
          <button
            className="icon-button"
            onClick={() => setIsFilterOpen(o => { const next = !o; if (next) setIsVisualizerOpen(false); return next; })}
            title="Toggle filter panel"
            style={{
              position: 'relative',
              color: isFilterOpen || hasActiveFilters(activeFilters) ? 'var(--accent-primary)' : 'var(--text-dim)',
            }}
          >
            <SlidersHorizontal size={18} />
            {activeFilterCount > 0 && (
              <span style={{
                position: 'absolute', top: -5, right: -5,
                fontSize: '0.55rem', fontWeight: 700, minWidth: 14, height: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--accent-primary)', color: 'white', borderRadius: '999px',
              }}>{activeFilterCount}</span>
            )}
          </button>

          {telegrams.length > 0 && (
            <button
              className="icon-button"
              onClick={() => setIsVisualizerOpen(v => { const next = !v; if (next) setIsFilterOpen(false); return next; })}
              title="Visualize data"
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.85rem',
                border: '1px solid var(--border-color)', borderRadius: '7px', fontSize: '0.8125rem',
                color: isVisualizerOpen ? 'var(--accent-primary)' : 'var(--text-dim)'
              }}
            >
              <LineChart size={16} /> Visualize
            </button>
          )}

          {telegrams.length > 0 && (
            <button
              className="icon-button"
              onClick={() => { setTelegrams([]); setMetadata(null); }}
              title="Clear results"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.85rem', border: '1px solid var(--border-color)', borderRadius: '7px', fontSize: '0.8125rem', color: 'var(--text-dim)' }}
            >
              <Trash2 size={16} /> Clear
            </button>
          )}
          <button
            className="icon-button"
            onClick={() => setIsLoaderOpen(true)}
            title="Load history"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.85rem', border: '1px solid var(--border-color)', borderRadius: '7px', fontSize: '0.8125rem', color: 'var(--text-dim)' }}
          >
            <Download size={16} />
            {telegrams.length > 0 ? 'Load more' : 'Load history'}
          </button>
        </div>
      </div>

      {/* Content row: filter panel + table */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Filter panel (slide-in) */}
        <div style={{
          width: isFilterOpen ? '240px' : '0px',
          overflow: 'hidden',
          transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
          flexShrink: 0,
        }}>
          <div style={{ width: 240, height: '100%' }}>
            <FilterPanel
              options={filterOptions}
              activeFilters={activeFilters}
              onFiltersChange={onFiltersChange}
              mode="history"
            />
          </div>
        </div>

        {/* Table/Chart area */}
        <div style={{ flex: 1, overflowY: 'auto', position: 'relative', display: 'flex', flexDirection: 'column' }}>
          {isVisualizerOpen && telegrams.length > 0 ? (
            <Visualizer telegrams={sortedTelegrams} onClose={() => setIsVisualizerOpen(false)} />
          ) : telegrams.length === 0 ? (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.5rem' }}>
              <History size={52} style={{ color: 'var(--accent-primary)', opacity: 0.35 }} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.4rem' }}>No data loaded</div>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.875rem' }}>
                  {hasActiveFilters(activeFilters)
                    ? 'Filters are set — click "Load history" to fetch matching data.'
                    : 'Select a time range to search historical bus traffic.'}
                </div>
              </div>
              <button
                onClick={() => setIsLoaderOpen(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.875rem 2rem', background: 'var(--accent-primary)',
                  border: 'none', borderRadius: '10px', color: 'white',
                  fontWeight: 600, fontSize: '1rem', cursor: 'pointer',
                  boxShadow: '0 0 24px rgba(99,102,241,0.35)', transition: 'filter 0.2s',
                }}
              >
                <Download size={20} /> Load History
              </button>
            </div>
          ) : (
            <TelegramTable
              telegrams={sortedTelegrams}
              visibleColumns={visibleColumns}
              sortConfig={sortConfig}
              onSort={handleSort}
            />
          )}
        </div>
      </div>

      {isLoaderOpen && (
        <HistoryLoader
          onClose={() => setIsLoaderOpen(false)}
          onLoad={handleLoad}
          limit={loadLimit}
          filters={activeFilters}
        />
      )}
    </div>
  );
};
