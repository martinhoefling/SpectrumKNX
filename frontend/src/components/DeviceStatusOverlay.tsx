import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { X, RefreshCw, Activity, Layers } from 'lucide-react';
import { apiUrl } from '../utils/basePath';
import type { Telegram } from '../hooks/useWebSocket';
import type { DeviceNode, Ko } from './BuildingOverlay';

interface DeviceStatusOverlayProps {
  device: DeviceNode;
  /** Newest telegram from the live websocket feed; used to update values in place. */
  latestTelegram: Telegram | null;
  onClose: () => void;
}

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

const mono: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };

function ageOf(timestamp: string): string {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  if (diffMs < 60_000) return `${Math.max(0, Math.round(diffMs / 1000))}s ago`;
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)}h ago`;
  return `${Math.round(diffMs / 86_400_000)}d ago`;
}

/**
 * Device-centric live status view (#153): every communication object of a
 * device with the current value of its linked group address(es), regardless
 * of which device wrote it. Values load from /api/telegrams/last (latest
 * telegram per GA) and update live from the websocket feed.
 */
export const DeviceStatusOverlay: React.FC<DeviceStatusOverlayProps> = ({
  device, latestTelegram, onClose,
}) => {
  const [valuesByGA, setValuesByGA] = useState<Record<string, Telegram>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);

  const allGAs = useMemo(() => {
    const set = new Set<string>();
    for (const ch of device.channels) for (const ko of ch.kos) for (const ga of ko.group_addresses) set.add(ga.address);
    for (const ko of device.kos) for (const ga of ko.group_addresses) set.add(ga.address);
    return set;
  }, [device]);

  const fetchValues = useCallback(async () => {
    if (allGAs.size === 0) return;
    setIsLoading(true);
    try {
      const res = await fetch(
        apiUrl(`/api/telegrams/last?target_address=${encodeURIComponent([...allGAs].join(','))}`)
      );
      const json = await res.json();
      const map: Record<string, Telegram> = {};
      for (const t of (json.telegrams ?? []) as Telegram[]) map[t.target_address] = t;
      setValuesByGA(map);
      setFetchedAt(new Date());
    } catch {
      // network errors are non-fatal; the view just stays empty/stale
    } finally {
      setIsLoading(false);
    }
  }, [allGAs]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchValues();
  }, [fetchValues]);

  // Keep values current from the live feed without re-fetching.
  useEffect(() => {
    if (!latestTelegram || !allGAs.has(latestTelegram.target_address)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValuesByGA(prev => ({ ...prev, [latestTelegram.target_address]: latestTelegram }));
  }, [latestTelegram, allGAs]);

  const koCount = device.channels.reduce((s, c) => s + c.kos.length, 0) + device.kos.length;

  const renderKoRows = (kos: Ko[]) =>
    kos.flatMap((ko, koIdx) =>
      ko.group_addresses.map((ga, gaIdx) => {
        const t = valuesByGA[ga.address];
        const first = gaIdx === 0;
        return (
          <tr key={`${ko.number}-${koIdx}-${ga.address}`} style={{ borderTop: first ? '1px solid var(--border-color)' : 'none' }}>
            <td style={{ ...tdStyle, ...mono, fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              {first && ko.number != null ? ko.number : ''}
            </td>
            <td style={{ ...tdStyle, fontSize: '0.78rem', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={first ? `${ko.text}${ko.function_text ? ` — ${ko.function_text}` : ''}` : undefined}>
              {first && (
                <>
                  {ko.text || ko.name || '—'}
                  {ko.function_text && <span style={{ color: 'var(--text-dim)' }}> — {ko.function_text}</span>}
                </>
              )}
            </td>
            <td style={{ ...tdStyle, fontSize: '0.73rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
              {first ? (ko.dpts.map(d => d.name || `DPT ${d.main}`).join(', ') || '—') : ''}
            </td>
            <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
              <span style={{ ...mono, fontSize: '0.75rem' }}>{ga.address}</span>
              {ga.name && <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}> {ga.name}</span>}
            </td>
            <td style={{ ...tdStyle, fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {t ? (
                <>
                  {t.value_formatted ?? t.value_numeric ?? '—'}
                  {t.unit && <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}> {t.unit}</span>}
                </>
              ) : (
                <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>never seen</span>
              )}
            </td>
            <td style={{ ...tdStyle, fontSize: '0.73rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}
                title={t ? new Date(t.timestamp).toLocaleString() : undefined}>
              {t ? ageOf(t.timestamp) : '—'}
            </td>
            <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
              {t ? (
                <>
                  <span style={{ ...mono, fontSize: '0.73rem' }}>{t.source_address}</span>
                  {t.source_name && <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}> {t.source_name}</span>}
                </>
              ) : '—'}
            </td>
          </tr>
        );
      })
    );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '0.65rem 1rem', borderBottom: '1px solid var(--border-color)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, gap: '1rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0 }}>
          <Activity size={15} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
              Device Status — <span style={mono}>{device.address}</span> {device.name}
            </div>
            <div style={{ fontSize: '0.73rem', color: 'var(--text-dim)', marginTop: '0.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[device.manufacturer, device.hardware].filter(Boolean).join(' · ')}
              {' '}— {koCount} communication object{koCount !== 1 ? 's' : ''}, live values per group address
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          {fetchedAt && (
            <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>
              loaded {fetchedAt.toLocaleTimeString()} · live
            </span>
          )}
          <button className="icon-button" title="Reload values" onClick={() => void fetchValues()}>
            <RefreshCw size={14} style={isLoading ? { animation: 'spin 1s linear infinite' } : undefined} />
          </button>
          <button className="icon-button" title="Back to building view" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {koCount === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
            This device has no communication objects linked to group addresses.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={thStyle}>KO</th>
                <th style={thStyle}>Object</th>
                <th style={thStyle}>DPT</th>
                <th style={thStyle}>Group Address</th>
                <th style={thStyle}>Value</th>
                <th style={thStyle}>Updated</th>
                <th style={thStyle}>Source</th>
              </tr>
            </thead>
            <tbody>
              {device.channels.map(ch => (
                <React.Fragment key={ch.id}>
                  <tr>
                    <td colSpan={7} style={{
                      ...tdStyle, paddingTop: '0.7rem', fontSize: '0.7rem', fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)',
                    }}>
                      <Layers size={11} style={{ verticalAlign: '-1px', marginRight: '0.35rem' }} />
                      {ch.name || ch.id}
                    </td>
                  </tr>
                  {renderKoRows(ch.kos)}
                </React.Fragment>
              ))}
              {renderKoRows(device.kos)}
            </tbody>
          </table>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
