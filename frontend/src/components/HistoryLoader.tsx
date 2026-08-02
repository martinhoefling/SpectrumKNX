import React, { useState, useCallback } from 'react';
import { X, Clock, Database, AlertCircle, CheckCircle2, Calendar, Search } from 'lucide-react';
import type { Telegram } from '../hooks/useWebSocket';
import type { ActiveFilters } from '../types/filters';
import type { LoaderTimeRange } from './HistorySearch';
import { loadHistoryTelegrams, type HistoryMetadata, type LoadedRange } from '../utils/historyLoad';

interface HistoryLoaderProps {
  onClose: () => void;
  onLoad?: (telegrams: Telegram[], metadata?: HistoryMetadata, range?: LoadedRange) => void;
  /** Fire-and-forget alternative to onLoad: the modal closes immediately and
   * the caller loads the range in the background (Group Monitor, #222). */
  onAsyncLoad?: (range: LoadedRange) => void;
  limit: number;
  /** 'monitor' = no date range pickers (Group Monitor); 'search' = full options (History Search) */
  mode?: 'monitor' | 'search';
  /** Active filter state — appended as query params for backend-side filtering (History Search) */
  filters?: ActiveFilters;
  /** Persisted time range values — retained across open/close cycles */
  timeRange?: LoaderTimeRange;
  onTimeRangeChange?: (r: LoaderTimeRange) => void;
}

type Unit = 'seconds' | 'minutes' | 'hours' | 'days';

const UNIT_TO_SECONDS: Record<Unit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
  days: 86400,
};

export const HistoryLoader: React.FC<HistoryLoaderProps> = ({ onClose, onLoad, onAsyncLoad, limit, mode = 'search', filters, timeRange, onTimeRangeChange }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [resultMeta, setResultMeta] = useState<HistoryMetadata | null>(null);

  // Custom relative — initialised from persisted timeRange if provided
  const [relValue, setRelValue] = useState<number>(timeRange?.relValue ?? 1);
  const [relUnit, setRelUnit] = useState<Unit>(timeRange?.relUnit ?? 'hours');

  // Custom absolute (history search only)
  const [startTime, setStartTime] = useState(timeRange?.startTime ?? '');
  const [endTime, setEndTime] = useState(timeRange?.endTime ?? '');

  // Persist state changes back to parent whenever values change
  const persistTimeRange = (patch: Partial<LoaderTimeRange>) => {
    onTimeRangeChange?.({ relValue, relUnit, startTime, endTime, ...patch });
  };

  // Some browsers allow typing more than 4 digits into the year segment of a
  // datetime-local input. Clamp to 4 digits to prevent e.g. "202600-01-01T00:00".
  const clampYear = (value: string) => {
    const match = value.match(/^(\d{5,})(-.+)$/);
    return match ? match[1].slice(0, 4) + match[2] : value;
  };

  const handleStartTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const clamped = clampYear(val);
    if (clamped !== val) {
      e.target.value = clamped;
    }
    setStartTime(clamped);
    persistTimeRange({ startTime: clamped });
  };

  const handleEndTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const clamped = clampYear(val);
    if (clamped !== val) {
      e.target.value = clamped;
    }
    setEndTime(clamped);
    persistTimeRange({ endTime: clamped });
  };

  const doFetch = useCallback(async (range: LoadedRange) => {
    if (onAsyncLoad) {
      // Background mode: hand the range off and close — progress is shown in
      // the caller's status area instead of blocking this modal (#222).
      onAsyncLoad(range);
      onClose();
      return;
    }
    setIsLoading(true);
    setError(null);
    setStatus('loading');
    setResultMeta(null);
    try {
      const { telegrams, metadata } = await loadHistoryTelegrams(range, limit, filters);
      setResultMeta(metadata);
      setStatus('success');
      onLoad?.(telegrams, metadata, range);
      setTimeout(onClose, 1500);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(errorMessage);
      setStatus('idle');
    } finally {
      setIsLoading(false);
    }
  }, [filters, limit, onLoad, onAsyncLoad, onClose]);

  const handleLoadRelative = useCallback((seconds: number) => {
    doFetch({ kind: 'relative', seconds });
  }, [doFetch]);

  const handleLoadCustomRelative = useCallback(() => {
    if (!relValue || relValue <= 0) { setError('Enter a positive value.'); return; }
    handleLoadRelative(relValue * UNIT_TO_SECONDS[relUnit]);
  }, [relValue, relUnit, handleLoadRelative]);

  const handleLoadCustomAbsolute = useCallback(() => {
    if (!startTime && !endTime) { setError('Enter at least a start or end time.'); return; }
    doFetch({ kind: 'absolute', startTime, endTime });
  }, [startTime, endTime, doFetch]);

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
              <span key={d} style={{ fontSize: '0.7rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'var(--bg-tag)', color: 'var(--text-dim)', border: '1px solid var(--border-color)' }}>DPT {d}</span>
            ))}
            {filters.deltaBeforeMs > 0 && (
              <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'var(--bg-tag)', color: 'var(--text-dim)', border: '1px solid var(--border-color)' }}>−{filters.deltaBeforeMs}ms before</span>
            )}
            {filters.deltaAfterMs > 0 && (
              <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'var(--bg-tag)', color: 'var(--text-dim)', border: '1px solid var(--border-color)' }}>+{filters.deltaAfterMs}ms after</span>
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
            <button key={label} className="quick-load-btn" onClick={() => handleLoadRelative(secs)} disabled={isLoading}>
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
            onChange={e => { const v = Number(e.target.value); setRelValue(v); persistTimeRange({ relValue: v }); }}
            className="glass-input"
            style={{ width: '90px', flexShrink: 0 }}
          />
          <select
            value={relUnit}
            onChange={e => { const v = e.target.value as Unit; setRelUnit(v); persistTimeRange({ relUnit: v }); }}
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
            onClick={handleLoadCustomRelative}
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
                <input
                  type="datetime-local"
                  max="9999-12-31T23:59"
                  className="glass-input"
                  style={{ width: '100%' }}
                  value={startTime}
                  onChange={handleStartTimeChange}
                  onBlur={e => {
                    const v = clampYear(e.target.value);
                    if (v !== e.target.value) { e.target.value = v; }
                    setStartTime(v);
                    persistTimeRange({ startTime: v });
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>To</label>
                <input
                  type="datetime-local"
                  max="9999-12-31T23:59"
                  className="glass-input"
                  style={{ width: '100%' }}
                  value={endTime}
                  onChange={handleEndTimeChange}
                  onBlur={e => {
                    const v = clampYear(e.target.value);
                    if (v !== e.target.value) { e.target.value = v; }
                    setEndTime(v);
                    persistTimeRange({ endTime: v });
                  }}
                />
              </div>
            </div>
            <button
              className="search-submit-btn"
              onClick={handleLoadCustomAbsolute}
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
        .quick-load-btn { display: flex; align-items: center; justify-content: center; padding: 0.65rem 0.5rem; background: var(--bg-subtle); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-main); font-size: 0.8125rem; cursor: pointer; transition: all 0.2s; }
        .quick-load-btn:hover:not(:disabled) { background: rgba(99,102,241,0.1); border-color: var(--accent-primary); color: var(--accent-primary); }
        .quick-load-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .glass-input { background: var(--bg-tag); border: 1px solid var(--border-color); border-radius: 8px; padding: 0.65rem 0.75rem; color: var(--text-main); font-family: inherit; font-size: 0.8125rem; outline: none; transition: border-color 0.2s; box-sizing: border-box; }
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
