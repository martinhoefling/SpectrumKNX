import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Clock, RefreshCw, Search, ToggleLeft, ToggleRight, Radio, Send } from 'lucide-react';
import { format, formatDistanceToNowStrict } from 'date-fns';
import type { Telegram } from '../hooks/useWebSocket';
import type { FilterOptions } from '../types/filters';
import { apiUrl } from '../utils/basePath';
import { formatDpt, readTelegram, sendTelegram } from '../utils/knxSend';
import { WriteControls } from './WriteControls';
import { SendToGaPopover } from './SendToGaPopover';
import { secondaryBtn } from '../utils/buttonStyles';

const LIMITS = [10, 20, 50, 100] as const;

interface LastSeenOverlayProps {
  filterOptions: FilterOptions;
  /** One or more addresses to show on open. Multiple are merged (e.g. all GAs of a KO). */
  initialAddresses: string[];
  initialMode: 'ga' | 'pa';
  /** When true, offer GroupValueRead/Write controls (standalone mode with a live bus). */
  writeEnabled?: boolean;
  latestTelegram?: Telegram | null;
  onClose: () => void;
}

const getTypeColor = (type?: string | null) => {
  switch (type) {
    case 'Write': return 'var(--accent-primary)';
    case 'Read': return '#fbbf24';
    case 'Response': return '#10b981';
    default: return 'var(--text-dim)';
  }
};

const thStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-dim)',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '0.45rem 0.75rem',
  verticalAlign: 'middle',
};

export const LastSeenOverlay: React.FC<LastSeenOverlayProps> = ({
  filterOptions,
  initialAddresses,
  initialMode,
  writeEnabled = false,
  latestTelegram,
  onClose,
}) => {
  const [mode, setMode] = useState<'ga' | 'pa'>(initialMode);
  const [selectedAddresses, setSelectedAddresses] = useState<string[]>(initialAddresses);
  const [limit, setLimit] = useState<number>(20);
  const [search, setSearch] = useState('');
  const [telegrams, setTelegrams] = useState<Telegram[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [writeValue, setWriteValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addressList = mode === 'ga' ? filterOptions.targets : filterOptions.sources;
  const multi = selectedAddresses.length > 1;

  const fetchData = useCallback(async () => {
    if (selectedAddresses.length === 0) return;
    setIsLoading(true);
    try {
      // The backend treats a comma-separated value as an OR filter, so a KO's
      // multiple group addresses are merged into one most-recent-first list.
      const param = mode === 'ga' ? 'target_address' : 'source_address';
      const res = await fetch(
        apiUrl(`/api/telegrams?${param}=${encodeURIComponent(selectedAddresses.join(','))}&limit=${limit}`)
      );
      const json = await res.json();
      setTelegrams(json.telegrams ?? []);
      setLastFetchedAt(new Date());
    } catch {
      // network errors are non-fatal
    } finally {
      setIsLoading(false);
    }
  }, [selectedAddresses, mode, limit]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchData, 10_000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, fetchData]);

  useEffect(() => {
    if (!latestTelegram) return;
    const match = mode === 'ga'
      ? selectedAddresses.includes(latestTelegram.target_address)
      : selectedAddresses.includes(latestTelegram.source_address);
    if (match) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTelegrams(prev => {
        const exists = prev.some(
          t => {
            const tTime = new Date(t.timestamp.endsWith('Z') || t.timestamp.includes('+') ? t.timestamp : t.timestamp + 'Z').getTime();
            const ltTime = new Date(latestTelegram.timestamp.endsWith('Z') || latestTelegram.timestamp.includes('+') ? latestTelegram.timestamp : latestTelegram.timestamp + 'Z').getTime();
            return Math.abs(tTime - ltTime) < 1000 &&
                   t.source_address === latestTelegram.source_address &&
                   t.target_address === latestTelegram.target_address;
          }
        );
        if (exists) return prev;
        return [latestTelegram, ...prev].slice(0, limit);
      });
      setLastFetchedAt(new Date());
    }
  }, [latestTelegram, selectedAddresses, mode, limit]);

  // After sending, the response/echo lands as a telegram shortly after; refresh to reflect it.
  const refreshSoon = useCallback(() => {
    setTimeout(fetchData, 700);
  }, [fetchData]);

  const handleRead = async () => {
    setBusy(true);
    setSendError(null);
    try {
      await Promise.all(selectedAddresses.map(a => readTelegram(a)));
      refreshSoon();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Read failed');
    } finally {
      setBusy(false);
    }
  };

  const handleWrite = async (payload: boolean | number | string, dpt: string) => {
    setBusy(true);
    setSendError(null);
    try {
      await sendTelegram(selectedAddresses[0], payload, dpt || undefined);
      refreshSoon();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Write failed');
    } finally {
      setBusy(false);
    }
  };

  const handleModeChange = (newMode: 'ga' | 'pa') => {
    setMode(newMode);
    const list = newMode === 'ga' ? filterOptions.targets : filterOptions.sources;
    // Addresses are kind-specific, so switching GA/PA resets the selection.
    if (!selectedAddresses.every(a => list.find(x => x.address === a))) {
      setSelectedAddresses(list.length > 0 ? [list[0].address ?? ''] : []);
    }
    setSearch('');
  };

  const filteredAddresses = addressList.filter(a => {
    const q = search.toLowerCase();
    return (a.address ?? '').toLowerCase().includes(q) || (a.name ?? '').toLowerCase().includes(q);
  });

  const selectedInfo = !multi
    ? addressList.find(a => a.address === selectedAddresses[0])
    : undefined;

  const getDelta = (idx: number): string | null => {
    if (idx >= telegrams.length - 1) return null;
    const diffMs =
      new Date(telegrams[idx].timestamp).getTime() -
      new Date(telegrams[idx + 1].timestamp).getTime();
    if (diffMs < 60_000) return `+${(diffMs / 1000).toFixed(1)}s`;
    if (diffMs < 3_600_000) return `+${(diffMs / 60_000).toFixed(1)}m`;
    return `+${(diffMs / 3_600_000).toFixed(1)}h`;
  };

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <div style={{
        width: 250, flexShrink: 0,
        borderRight: '1px solid var(--border-color)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-inset)',
      }}>
        {/* Mode tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
          {(['ga', 'pa'] as const).map(m => (
            <button key={m} onClick={() => handleModeChange(m)} style={{
              flex: 1, padding: '0.55rem 0.25rem', border: 'none', cursor: 'pointer',
              fontSize: '0.73rem', fontWeight: mode === m ? 600 : 400,
              background: mode === m ? 'rgba(99,102,241,0.12)' : 'transparent',
              color: mode === m ? 'var(--accent-primary)' : 'var(--text-dim)',
              borderBottom: `2px solid ${mode === m ? 'var(--accent-primary)' : 'transparent'}`,
              transition: 'all 0.15s',
            }}>
              {m === 'ga' ? 'Group Addresses' : 'Devices'}
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ padding: '0.55rem', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            background: 'var(--bg-tag)', border: '1px solid var(--border-color)',
            borderRadius: '6px', padding: '0.3rem 0.55rem',
          }}>
            <Search size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
            <input
              type="text" placeholder="Filter…" value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                fontSize: '0.8rem', color: 'var(--text-main)',
              }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-dim)' }}>
                <X size={10} />
              </button>
            )}
          </div>
        </div>

        {/* Address list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredAddresses.length === 0 ? (
            <div style={{ padding: '1.5rem 1rem', fontSize: '0.8rem', color: 'var(--text-dim)', textAlign: 'center' }}>
              {addressList.length === 0 ? 'No addresses seen yet.' : 'No matches.'}
            </div>
          ) : filteredAddresses.map(addr => {
            const isSelected = selectedAddresses.includes(addr.address ?? '');
            return (
              <div
                key={addr.address}
                className="last-seen-addr-row"
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.35rem',
                  background: isSelected ? 'rgba(99,102,241,0.15)' : 'transparent',
                  borderLeft: `2px solid ${isSelected ? 'var(--accent-primary)' : 'transparent'}`,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <button
                  onClick={() => setSelectedAddresses([addr.address ?? ''])}
                  style={{
                    flex: 1, minWidth: 0, textAlign: 'left', padding: '0.45rem 0.75rem',
                    border: 'none', background: 'transparent', cursor: 'pointer',
                  }}
                >
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem',
                    color: isSelected ? 'var(--accent-primary)' : 'var(--text-main)',
                  }}>
                    {addr.address}
                  </div>
                  {addr.name && (
                    <div style={{
                      fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '0.1rem',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {addr.name}
                    </div>
                  )}
                </button>
                {writeEnabled && mode === 'ga' && addr.address && (
                  <div style={{ paddingRight: '0.5rem', flexShrink: 0 }}>
                    <SendToGaPopover
                      address={addr.address}
                      name={addr.name}
                      dptMain={addr.main}
                      dptSub={addr.sub}
                      buttonClassName="quick-send-btn"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{
          padding: '0.65rem 1rem', borderBottom: '1px solid var(--border-color)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, gap: '1rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0 }}>
            <Clock size={15} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Last Seen Values</div>
              {multi ? (
                <div style={{ fontSize: '0.73rem', color: 'var(--text-dim)', marginTop: '0.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{selectedAddresses.join(', ')}</span>
                  {' '}— {selectedAddresses.length} {mode === 'ga' ? 'group addresses' : 'devices'}
                </div>
              ) : selectedInfo && (
                <div style={{ fontSize: '0.73rem', color: 'var(--text-dim)', marginTop: '0.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{selectedInfo.address}</span>
                  {selectedInfo.name && <> — {selectedInfo.name}</>}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
            {/* Limit selector */}
            <div style={{ display: 'flex', gap: '0.2rem' }}>
              {LIMITS.map(l => (
                <button key={l} onClick={() => setLimit(l)} style={{
                  padding: '0.2rem 0.45rem', fontSize: '0.72rem', borderRadius: 4, cursor: 'pointer',
                  border: `1px solid ${limit === l ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                  background: limit === l ? 'rgba(99,102,241,0.15)' : 'var(--bg-subtle)',
                  color: limit === l ? 'var(--accent-primary)' : 'var(--text-dim)',
                }}>
                  {l}
                </button>
              ))}
            </div>

            {/* Auto-refresh toggle */}
            <button
              onClick={() => setAutoRefresh(r => !r)}
              title={autoRefresh ? 'Disable auto-refresh (10s)' : 'Enable auto-refresh (10s)'}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.25rem',
                padding: '0.2rem 0.45rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.72rem',
                border: `1px solid ${autoRefresh ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                background: autoRefresh ? 'rgba(99,102,241,0.15)' : 'var(--bg-subtle)',
                color: autoRefresh ? 'var(--accent-primary)' : 'var(--text-dim)',
              }}
            >
              {autoRefresh ? <ToggleRight size={13} /> : <ToggleLeft size={13} />}
              Live
            </button>

            {/* Read from bus (GroupValueRead) */}
            {writeEnabled && mode === 'ga' && selectedAddresses.length > 0 && (
              <button
                onClick={handleRead} disabled={busy}
                title="Send a GroupValueRead; the response updates the last value"
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.25rem',
                  padding: '0.2rem 0.5rem', borderRadius: 4, cursor: busy ? 'wait' : 'pointer', fontSize: '0.72rem',
                  border: '1px solid var(--accent-primary)', background: 'var(--bg-subtle)', color: 'var(--accent-primary)',
                }}
              >
                <Radio size={13} /> Read
              </button>
            )}

            {/* Manual refresh */}
            <button
              onClick={fetchData} disabled={isLoading} title="Refresh now"
              style={{ background: 'transparent', border: 'none', cursor: isLoading ? 'wait' : 'pointer', color: 'var(--text-dim)', padding: '0.2rem', display: 'flex' }}
            >
              <RefreshCw size={15} style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none', color: isLoading ? 'var(--accent-primary)' : undefined }} />
            </button>

            {lastFetchedAt && (
              <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                {format(lastFetchedAt, 'HH:mm:ss')}
              </span>
            )}

            <button onClick={onClose} className="icon-button" title="Close" style={{ padding: '0.2rem' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Write to bus (GroupValueWrite) — single group address only */}
        {writeEnabled && mode === 'ga' && !multi && selectedAddresses.length === 1 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0,
            padding: '0.5rem 0.85rem', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-subtle)',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-primary)' }}>
              <Send size={14} /> Write
            </span>
            <WriteControls
              dptMain={selectedInfo?.main}
              dptKey={formatDpt(selectedInfo?.main, selectedInfo?.sub)}
              address={selectedAddresses[0]}
              value={writeValue}
              onValueChange={v => { setWriteValue(v); setSendError(null); }}
              onWrite={payload => void handleWrite(payload, formatDpt(selectedInfo?.main, selectedInfo?.sub))}
              disabled={busy}
            />
            <button
              onClick={() => void handleRead()}
              disabled={busy}
              style={secondaryBtn(busy)}
              title="Send a GroupValueRead; the response updates the last value"
            >
              <Radio size={13} /> Read
            </button>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontFamily: "'JetBrains Mono', monospace" }}>
              DPT {formatDpt(selectedInfo?.main, selectedInfo?.sub) || '—'}
            </span>
            {sendError && <span style={{ fontSize: '0.72rem', color: 'var(--error)' }}>{sendError}</span>}
          </div>
        )}

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {selectedAddresses.length === 0 ? (
            <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.875rem' }}>
              Select one or more addresses on the left sidebar to view their last seen values.
            </div>
          ) : !isLoading && telegrams.length === 0 ? (
            <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.875rem' }}>
              No telegrams found for <span style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-main)' }}>{selectedAddresses.join(', ')}</span>.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{
                  borderBottom: '1px solid var(--border-color)',
                  position: 'sticky', top: 0,
                  background: 'var(--bg-panel)', zIndex: 1,
                }}>
                  <th style={thStyle}>Time</th>
                  <th style={thStyle}>∆t</th>
                  {multi && <th style={thStyle}>{mode === 'ga' ? 'GA' : 'PA'}</th>}
                  <th style={thStyle}>{mode === 'ga' ? 'Source' : 'Target'}</th>
                  <th style={thStyle}>{mode === 'ga' ? 'Source Name' : 'Target Name'}</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Value</th>
                  <th style={thStyle}>DPT</th>
                </tr>
              </thead>
              <tbody>
                {telegrams.map((t, idx) => (
                  <tr
                    key={`${t.timestamp}-${idx}`}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      background: idx % 2 === 0 ? 'var(--bg-subtle)' : 'transparent',
                    }}
                  >
                    <td style={tdStyle}>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                        {format(new Date(t.timestamp), 'HH:mm:ss.SSS')}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '0.1rem' }}>
                        {formatDistanceToNowStrict(new Date(t.timestamp), { addSuffix: true })}
                      </div>
                    </td>
                    <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                      {getDelta(idx) ?? '—'}
                    </td>
                    {multi && (
                      <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem', color: 'var(--accent-primary)', whiteSpace: 'nowrap' }}>
                        {mode === 'ga' ? t.target_address : t.source_address}
                      </td>
                    )}
                    <td style={tdStyle}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                        {mode === 'ga' ? t.source_address : t.target_address}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--text-dim)', fontSize: '0.78rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(mode === 'ga' ? t.source_name : t.target_name) || '—'}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ color: getTypeColor(t.simplified_type), fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase' }}>
                        {t.simplified_type || t.telegram_type}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>
                        {t.value_formatted || (t.value_numeric !== null ? String(t.value_numeric) : '—')}
                      </span>
                      {t.unit && (
                        <span style={{ marginLeft: '0.3rem', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                          {t.unit}
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                      {t.dpt_name || (t.dpt_main != null ? `DPT ${t.dpt_main}` : '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
