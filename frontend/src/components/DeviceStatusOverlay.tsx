import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { X, RefreshCw, Activity, Layers, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { apiUrl } from '../utils/basePath';
import type { Telegram } from '../hooks/useWebSocket';
import type { DeviceNode, Ko } from './BuildingOverlay';

interface DeviceStatusOverlayProps {
  device: DeviceNode;
  /** Newest telegram from the live websocket feed; used to update values in place. */
  latestTelegram: Telegram | null;
  onClose: () => void;
  onLastSeen?: (address: string | string[], mode: 'ga' | 'pa') => void;
}

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-dim)',
  padding: '0.2rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '4px',
  transition: 'color 0.15s, background-color 0.15s',
  flexShrink: 0,
};

const mono: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };

function ageOf(timestamp: string): string {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  if (diffMs < 60_000) return `${Math.max(0, Math.round(diffMs / 1000))}s ago`;
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)}h ago`;
  return `${Math.round(diffMs / 86_400_000)}d ago`;
}

const Caret: React.FC<{ open: boolean; hasChildren: boolean; onClick?: () => void }> = ({ open, hasChildren, onClick }) => {
  if (!hasChildren) return <div style={{ width: 14 }} />;
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 14, height: 14, cursor: 'pointer', color: 'var(--text-dim)',
      }}
    >
      <Icon size={12} />
    </div>
  );
};

const rowStyle = (depth: number): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.4rem 0.75rem',
  paddingLeft: `${0.75 + depth * 1.25}rem`,
  borderRadius: '6px',
  transition: 'background 0.15s, color 0.15s',
  fontSize: '0.8rem',
  userSelect: 'none',
  minHeight: '2rem',
});

const GaItem: React.FC<{
  ga: { address: string; name?: string | null };
  depth: number;
  valuesByGA: Record<string, Telegram>;
  onLastSeen?: (address: string | string[], mode: 'ga' | 'pa') => void;
}> = ({ ga, depth, valuesByGA, onLastSeen }) => {
  const t = valuesByGA[ga.address];
  const [hovered, setHovered] = useState(false);

  const tooltipText = t
    ? `Last updated: ${new Date(t.timestamp).toLocaleString()}\nby ${t.source_address}${t.source_name ? ` (${t.source_name})` : ''}`
    : 'Never updated';

  return (
    <div
      style={{
        ...rowStyle(depth),
        background: hovered ? 'var(--bg-hover)' : 'transparent',
        fontSize: '0.75rem',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Caret open={false} hasChildren={false} />
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--accent-primary)' }}>{ga.address}</span>
        {ga.name && (
          <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '0.05rem' }}>
            {ga.name}
          </span>
        )}
      </div>

      <div
        title={tooltipText}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          flexShrink: 0,
          cursor: 'help',
        }}
      >
        <span style={{ fontWeight: 600, color: t ? 'var(--text-main)' : 'var(--text-dim)' }}>
          {t ? (
            <>
              {t.value_formatted ?? t.value_numeric ?? '—'}
              {t.unit && <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}> {t.unit}</span>}
            </>
          ) : 'never seen'}
        </span>
        {t && (
          <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>
            ({ageOf(t.timestamp)})
          </span>
        )}
      </div>

      {onLastSeen && (
        <button
          style={{
            ...iconBtnStyle,
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.1s',
          }}
          title="Show history log"
          onClick={e => { e.stopPropagation(); onLastSeen(ga.address, 'ga'); }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
        >
          <Clock size={12} />
        </button>
      )}
    </div>
  );
};

const KoItem: React.FC<{
  ko: Ko;
  depth: number;
  valuesByGA: Record<string, Telegram>;
  onLastSeen?: (address: string | string[], mode: 'ga' | 'pa') => void;
}> = ({ ko, depth, valuesByGA, onLastSeen }) => {
  const dptText = ko.dpts.map(d => d.name || `DPT ${d.main}`).join(', ') || '—';
  const hasGAs = ko.group_addresses.length > 0;

  return (
    <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: hasGAs ? '0.25rem' : 0 }}>
      <div
        style={{
          ...rowStyle(depth),
          background: 'transparent',
          fontWeight: 500,
          color: 'var(--text-main)',
        }}
      >
        <Caret open={false} hasChildren={false} />
        {ko.number != null && (
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', fontWeight: 600,
            minWidth: '1.5rem', textAlign: 'center', padding: '0.1rem 0.35rem', borderRadius: '4px',
            background: 'var(--bg-tag)', color: 'var(--text-dim)', border: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}>{ko.number}</span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ko.text || ko.name || '—'}
            {ko.function_text && <span style={{ color: 'var(--text-dim)' }}> — {ko.function_text}</span>}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: '0.1rem' }}>
            {dptText}
          </div>
        </div>
      </div>
      {hasGAs && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
          {ko.group_addresses.map(ga => (
            <GaItem key={ga.address} ga={ga} depth={depth + 1} valuesByGA={valuesByGA} onLastSeen={onLastSeen} />
          ))}
        </div>
      )}
    </div>
  );
};

const ChannelRow: React.FC<{
  channel: any;
  depth: number;
  valuesByGA: Record<string, Telegram>;
  onLastSeen?: (address: string | string[], mode: 'ga' | 'pa') => void;
}> = ({ channel, depth, valuesByGA, onLastSeen }) => {
  const [open, setOpen] = useState(true);
  const koCount = channel.kos.length;
  if (koCount === 0) return null;

  return (
    <div>
      <div
        style={{
          ...rowStyle(depth),
          cursor: 'pointer',
          fontWeight: 600,
          background: 'var(--bg-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
          color: 'var(--text-main)',
        }}
        onClick={() => setOpen(o => !o)}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
      >
        <Caret open={open} hasChildren={true} />
        <Layers size={13} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
          {channel.name || `Channel ${channel.id}`}
        </span>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', fontWeight: 400 }}>
          {koCount} KO{koCount !== 1 ? 's' : ''}
        </span>
      </div>
      {open && (
        <div style={{ borderLeft: '1px solid var(--border-subtle)', marginLeft: `${1.1 + depth * 1.25}rem` }}>
          {channel.kos.map((ko: any, idx: number) => (
            <KoItem key={`${ko.number}-${idx}`} ko={ko} depth={0} valuesByGA={valuesByGA} onLastSeen={onLastSeen} />
          ))}
        </div>
      )}
    </div>
  );
};

export const DeviceStatusOverlay: React.FC<DeviceStatusOverlayProps> = ({
  device, latestTelegram, onClose, onLastSeen,
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
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
        {koCount === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
            This device has no communication objects linked to group addresses.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {device.channels.map(ch => (
              <ChannelRow
                key={ch.id}
                channel={ch}
                depth={0}
                valuesByGA={valuesByGA}
                onLastSeen={onLastSeen}
              />
            ))}

            {device.kos.length > 0 && (
              <div>
                <div style={{
                  ...rowStyle(0),
                  fontWeight: 600,
                  background: 'var(--bg-subtle)',
                  borderBottom: '1px solid var(--border-subtle)',
                  color: 'var(--text-dim)',
                  textTransform: 'uppercase',
                  fontSize: '0.7rem',
                  letterSpacing: '0.05em',
                }}>
                  Unassigned Objects
                </div>
                <div style={{ borderLeft: '1px solid var(--border-subtle)', marginLeft: '1.1rem' }}>
                  {device.kos.map((ko, idx) => (
                    <KoItem
                      key={`${ko.number}-${idx}`}
                      ko={ko}
                      depth={0}
                      valuesByGA={valuesByGA}
                      onLastSeen={onLastSeen}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
