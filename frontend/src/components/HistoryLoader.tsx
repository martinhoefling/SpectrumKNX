import React, { useState } from 'react';
import { X, Clock, Database, AlertCircle, CheckCircle2, Calendar, Search } from 'lucide-react';
import type { Telegram } from '../hooks/useWebSocket';
import type { ActiveFilters } from './FilterPanel';

interface Metadata {
  total_count: number;
  limit_reached: boolean;
}

interface HistoryLoaderProps {
  onClose: () => void;
  onLoad: (telegrams: Telegram[], metadata?: Metadata) => void;
  limit: number;
  /** 'monitor' = no date range pickers (Group Monitor); 'search' = full options (History Search) */
  mode?: 'monitor' | 'search';
  /** Active filter state — appended as query params for backend-side filtering (History Search) */
  filters?: ActiveFilters;
}

type Unit = 'seconds' | 'minutes' | 'hours' | 'days';

const UNIT_TO_SECONDS: Record<Unit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
  days: 86400,
};

/** Appends active filter state as query params to a base URL string. */
function applyFilterParams(url: string, filters?: ActiveFilters): string {
  if (!filters) return url;
  const params: string[] = [];
  if (filters.sources.length > 0) params.push(`source_address=${encodeURIComponent(filters.sources.join(','))}`);
  if (filters.targets.length > 0) params.push(`target_address=${encodeURIComponent(filters.targets.join(','))}`);
  if (filters.types.length > 0) params.push(`telegram_type=${encodeURIComponent(filters.types.join(','))}`);
  if (filters.dpts.length > 0) params.push(`dpt_main=${encodeURIComponent(filters.dpts.join(','))}`);
  if (filters.deltaBeforeMs > 0) params.push(`delta_before_ms=${filters.deltaBeforeMs}`);
  if (filters.deltaAfterMs > 0) params.push(`delta_after_ms=${filters.deltaAfterMs}`);
  if (params.length === 0) return url;
  return url + (url.includes('?') ? '&' : '?') + params.join('&');
}

export const HistoryLoader: React.FC<HistoryLoaderProps> = ({ onClose, onLoad, limit, mode = 'search', filters }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [resultMeta, setResultMeta] = useState<Metadata | null>(null);

  // Custom relative
  const [relValue, setRelValue] = useState<number>(1);
  const [relUnit, setRelUnit] = useState<Unit>('hours');

  // Custom absolute (history search only)
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  const doFetch = async (url: string) => {
    setIsLoading(true);
    setError(null);
    setStatus('loading');
    setResultMeta(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      const meta: Metadata = data.metadata || { total_count: 0, limit_reached: false };
      setResultMeta(meta);
      setStatus('success');
      onLoad(data.telegrams || [], meta);
      setTimeout(onClose, 1500);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
      setStatus('idle');
    } finally {
      setIsLoading(false);
    }
  };

  const loadRelative = (seconds: number) => {
    const start = new Date(Date.now() - seconds * 1000).toISOString();
    const base = `/api/telegrams?limit=${limit}&start_time=${encodeURIComponent(start)}`;
    doFetch(applyFilterParams(base, filters));
  };

  const loadCustomRelative = () => {
    if (!relValue || relValue <= 0) { setError('Enter a positive value.'); return; }
    loadRelative(relValue * UNIT_TO_SECONDS[relUnit]);
  };

  const loadCustomAbsolute = () => {
    if (!startTime && !endTime) { setError('Enter at least a start or end time.'); return; }
    let url = `/api/telegrams?limit=${limit}`;
    if (startTime) url += `&start_time=${encodeURIComponent(startTime + ':00Z')}`;
    if (endTime) url += `&end_time=${encodeURIComponent(endTime + ':00Z')}`;
    doFetch(applyFilterParams(url, filters));
  };

  return (
    <div className="modal-overlay">
      <div className="glass modal-content">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Database size={20} className="accent-primary" />
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Load History</h3>
          </div>
          <button className="icon-button" onClick={onClose} style={{ color: 'var(--text-dim)' }}><X size={20} /></button>
        </div>

        <p style={{ color: 'var(--text-dim)', fontSize: '0.875rem', marginBottom: filters && (filters.sources.length + filters.targets.length + filters.types.length + filters.dpts.length) > 0 ? '0.75rem' : '1.5rem', lineHeight: 1.6 }}>
          Loads newest-first, up to <strong style={{ color: 'var(--text-main)' }}>{limit.toLocaleString()}</strong> telegrams.
          Duplicates (same timestamp) are skipped.
        </p>

        {/* Active filter summary */}
        {filters && (filters.sources.length + filters.targets.length + filters.types.length + filters.dpts.length) > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1.25rem' }}>
            {filters.sources.map(s => (
              <span key={s} style={{ fontSize: '0.7rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'rgba(99,102,241,0.12)', color: 'var(--accent-primary)', border: '1px solid rgba(99,102,241,0.3)' }}>src: {s}</span>
            ))}
            {filters.targets.map(t => (
              <span key={t} style={{ fontSize: '0.7rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>tgt: {t}</span>
            ))}
            {filters.types.map(t => (
              <span key={t} style={{ fontSize: '0.7rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}>{t}</span>
            ))}
            {filters.dpts.map(d => (
              <span key={d} style={{ fontSize: '0.7rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-dim)', border: '1px solid var(--border-color)' }}>DPT {d}</span>
            ))}
            {filters.deltaBeforeMs > 0 && (
              <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-dim)', border: '1px solid var(--border-color)' }}>−{filters.deltaBeforeMs}ms before</span>
            )}
            {filters.deltaAfterMs > 0 && (
              <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-dim)', border: '1px solid var(--border-color)' }}>+{filters.deltaAfterMs}ms after</span>
            )}
          </div>
        )}

        {/* ── Quick presets ── */}
        <div className="section-label"><Clock size={12} /> Quick Range</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '1.25rem' }}>
          {([
            ['5 min',  5 * 60],
            ['15 min', 15 * 60],
            ['1 h',    3600],
            ['6 h',    6 * 3600],
            ['24 h',   24 * 3600],
            ['7 d',    7 * 86400],
          ] as [string, number][]).map(([label, secs]) => (
            <button key={label} className="quick-load-btn" onClick={() => loadRelative(secs)} disabled={isLoading}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Custom relative ── */}
        <div className="section-label"><Clock size={12} /> Custom Relative</div>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: mode === 'search' ? '1.5rem' : '1.25rem' }}>
          <input
            type="number"
            min={1}
            value={relValue}
            onChange={e => setRelValue(Number(e.target.value))}
            className="glass-input"
            style={{ width: '90px', flexShrink: 0 }}
          />
          <select
            value={relUnit}
            onChange={e => setRelUnit(e.target.value as Unit)}
            className="glass-input"
            style={{ flex: 1 }}
          >
            <option value="seconds">Seconds</option>
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
            <option value="days">Days</option>
          </select>
          <button
            className="quick-load-btn"
            onClick={loadCustomRelative}
            disabled={isLoading}
            style={{ flexShrink: 0, whiteSpace: 'nowrap', padding: '0 1rem' }}
          >
            Load
          </button>
        </div>

        {/* ── Custom absolute — History Search only ── */}
        {mode === 'search' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
              <span className="section-label" style={{ marginBottom: 0 }}><Calendar size={12} /> Date Range</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>From</label>
                <input type="datetime-local" className="glass-input" style={{ width: '100%' }} value={startTime} onChange={e => setStartTime(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>To</label>
                <input type="datetime-local" className="glass-input" style={{ width: '100%' }} value={endTime} onChange={e => setEndTime(e.target.value)} />
              </div>
            </div>
            <button
              className="search-submit-btn"
              onClick={loadCustomAbsolute}
              disabled={isLoading}
              style={{ width: '100%', marginBottom: '1.25rem' }}
            >
              {isLoading ? 'Searching...' : <><Search size={16} /> Search Range</>}
            </button>
          </>
        )}

        {/* Status */}
        {status === 'loading' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', color: 'var(--text-dim)' }}>
            <div className="spinner" /> <span style={{ fontSize: '0.875rem' }}>Fetching from database...</span>
          </div>
        )}
        {status === 'success' && resultMeta && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: 'rgba(16,185,129,0.08)', borderRadius: '8px', border: '1px solid rgba(16,185,129,0.2)' }}>
            <CheckCircle2 size={18} style={{ color: '#10b981', flexShrink: 0 }} />
            <span style={{ fontSize: '0.875rem' }}>
              Loaded <strong>{resultMeta.total_count.toLocaleString()}</strong> telegrams
              {resultMeta.limit_reached && <span style={{ color: '#fbbf24', marginLeft: '0.5rem' }}>(limit reached)</span>}
            </span>
          </div>
        )}
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: 'rgba(239,68,68,0.08)', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.2)' }}>
            <AlertCircle size={18} style={{ color: 'var(--error)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.875rem', color: 'var(--error)' }}>{error}</span>
          </div>
        )}
      </div>

      <style>{`
        .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.45); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; z-index: 1000; animation: fade-in 0.15s ease-out; }
        .modal-content { width: 480px; max-height: 90vh; overflow-y: auto; padding: 2rem; border-radius: 14px; animation: scale-in 0.2s cubic-bezier(0.16,1,0.3,1); }
        .section-label { display: flex; align-items: center; gap: 0.4rem; font-size: 0.65rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.65rem; }
        .quick-load-btn { display: flex; align-items: center; justify-content: center; padding: 0.65rem 0.5rem; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-main); font-size: 0.8125rem; cursor: pointer; transition: all 0.2s; }
        .quick-load-btn:hover:not(:disabled) { background: rgba(99,102,241,0.1); border-color: var(--accent-primary); color: var(--accent-primary); }
        .quick-load-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .glass-input { background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); border-radius: 8px; padding: 0.65rem 0.75rem; color: var(--text-main); font-family: inherit; font-size: 0.8125rem; outline: none; transition: border-color 0.2s; box-sizing: border-box; }
        .glass-input:focus { border-color: var(--accent-primary); }
        .glass-input::-webkit-calendar-picker-indicator { filter: invert(0.8); cursor: pointer; }
        .search-submit-btn { display: flex; align-items: center; justify-content: center; gap: 0.6rem; padding: 0.8rem; background: rgba(99,102,241,0.12); border: 1px solid var(--accent-primary); border-radius: 8px; color: var(--accent-primary); font-weight: 600; font-size: 0.875rem; cursor: pointer; transition: all 0.2s; }
        .search-submit-btn:hover:not(:disabled) { background: var(--accent-primary); color: white; }
        .search-submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .spinner { width: 18px; height: 18px; border: 2px solid rgba(99,102,241,0.15); border-top-color: var(--accent-primary); border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  );
};
