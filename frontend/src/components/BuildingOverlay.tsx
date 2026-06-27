import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X, RefreshCw, Building2, ChevronDown, ChevronRight, Cpu, Layers, Filter, Clock,
} from 'lucide-react';
import { apiUrl } from '../utils/basePath';

// ── Types (mirror /api/building response) ──────────────────────────────────────

interface GaRef {
  address: string;
  name: string;
}

interface Ko {
  number: number | null;
  name: string;
  text: string;
  function_text: string;
  dpts: { main: number; sub: number | null }[];
  group_addresses: GaRef[];
}

interface Channel {
  id: string;
  name: string;
  kos: Ko[];
}

interface DeviceNode {
  address: string;
  name: string;
  manufacturer: string;
  hardware: string;
  channels: Channel[];
  kos: Ko[];
}

interface SpaceNode {
  kind: 'space';
  type: string;
  name: string;
  spaces: SpaceNode[];
  devices: DeviceNode[];
}

interface BuildingData {
  status: string;
  tree: SpaceNode[];
  unassigned_devices: DeviceNode[];
}

interface BuildingOverlayProps {
  onClose: () => void;
  /** Add a device's individual address to the source filter. */
  onFilterDevice: (pa: string) => void;
  /** Add all of a KO's connected group addresses to the target filter. */
  onFilterGAs: (addresses: string[]) => void;
  /** Open the last-seen overlay for an address. */
  onLastSeen: (address: string, mode: 'ga' | 'pa') => void;
}

// ── Search matching helpers ─────────────────────────────────────────────────────

const gaMatches = (ga: GaRef, q: string) =>
  ga.address.toLowerCase().includes(q) || ga.name.toLowerCase().includes(q);

const koMatches = (ko: Ko, q: string) =>
  (ko.name ?? '').toLowerCase().includes(q) ||
  (ko.text ?? '').toLowerCase().includes(q) ||
  (ko.function_text ?? '').toLowerCase().includes(q) ||
  (ko.number != null && String(ko.number).includes(q)) ||
  ko.group_addresses.some(g => gaMatches(g, q));

const deviceMatches = (d: DeviceNode, q: string): boolean =>
  d.address.toLowerCase().includes(q) ||
  d.name.toLowerCase().includes(q) ||
  d.manufacturer.toLowerCase().includes(q) ||
  d.channels.some(c => c.name.toLowerCase().includes(q) || c.kos.some(k => koMatches(k, q))) ||
  d.kos.some(k => koMatches(k, q));

const spaceMatches = (s: SpaceNode, q: string): boolean =>
  s.name.toLowerCase().includes(q) ||
  s.type.toLowerCase().includes(q) ||
  s.spaces.some(sub => spaceMatches(sub, q)) ||
  s.devices.some(d => deviceMatches(d, q));

const formatDpt = (dpts: { main: number; sub: number | null }[]): string | null => {
  if (!dpts || dpts.length === 0) return null;
  const d = dpts[0];
  return d.sub != null ? `DPT ${d.main}.${String(d.sub).padStart(3, '0')}` : `DPT ${d.main}`;
};

// ── Row primitives ──────────────────────────────────────────────────────────────

const rowStyle = (depth: number): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: '0.4rem',
  padding: '0.3rem 0.75rem', paddingLeft: `${0.75 + depth * 1.1}rem`,
  userSelect: 'none',
});

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--text-dim)', padding: '0.15rem', borderRadius: '3px',
  display: 'flex', alignItems: 'center', flexShrink: 0,
};

const Caret: React.FC<{ open: boolean; hasChildren: boolean }> = ({ open, hasChildren }) => (
  <span style={{ width: 12, flexShrink: 0, color: 'var(--text-dim)', display: 'flex' }}>
    {hasChildren ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
  </span>
);

// ── KO row ──────────────────────────────────────────────────────────────────────

const KoRow: React.FC<{
  ko: Ko;
  depth: number;
  onFilterGAs: (addresses: string[]) => void;
  onLastSeen: (address: string, mode: 'ga' | 'pa') => void;
}> = ({ ko, depth, onFilterGAs, onLastSeen }) => {
  const dptLabel = formatDpt(ko.dpts);
  const gaAddresses = ko.group_addresses.map(g => g.address);
  const label = ko.text || ko.name || ko.function_text || `Object ${ko.number ?? ''}`;
  return (
    <div
      style={{ ...rowStyle(depth) }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <Caret open={false} hasChildren={false} />
      {ko.number != null && (
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', fontWeight: 600,
          minWidth: '1.6rem', textAlign: 'center', padding: '0.1rem 0.35rem', borderRadius: '4px',
          background: 'var(--bg-tag)', color: 'var(--text-dim)', border: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}>{ko.number}</span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div title={label} style={{
          fontSize: '0.8rem', color: 'var(--text-main)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{label}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.15rem' }}>
          {ko.group_addresses.map(ga => (
            <span key={ga.address} title={ga.name || ga.address} style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem',
              padding: '0.05rem 0.3rem', borderRadius: '3px',
              background: 'rgba(99,102,241,0.1)', color: 'var(--accent-primary)',
              border: '1px solid rgba(99,102,241,0.25)',
            }}>{ga.address}</span>
          ))}
        </div>
      </div>
      {dptLabel && (
        <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', flexShrink: 0, whiteSpace: 'nowrap' }}>
          {dptLabel}
        </span>
      )}
      {gaAddresses.length > 0 && (
        <>
          <button
            style={iconBtnStyle}
            title={`Filter by connected group address${gaAddresses.length > 1 ? 'es' : ''}`}
            onClick={e => { e.stopPropagation(); onFilterGAs(gaAddresses); }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
          >
            <Filter size={12} />
          </button>
          <button
            style={iconBtnStyle}
            title="Show last seen values"
            onClick={e => { e.stopPropagation(); onLastSeen(gaAddresses[0], 'ga'); }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
          >
            <Clock size={12} />
          </button>
        </>
      )}
    </div>
  );
};

// ── Device node ─────────────────────────────────────────────────────────────────

const DeviceRow: React.FC<{
  device: DeviceNode;
  depth: number;
  query: string;
  onFilterDevice: (pa: string) => void;
  onFilterGAs: (addresses: string[]) => void;
  onLastSeen: (address: string, mode: 'ga' | 'pa') => void;
}> = ({ device, depth, query, onFilterDevice, onFilterGAs, onLastSeen }) => {
  const [open, setOpen] = useState(false);
  const koCount = device.channels.reduce((s, c) => s + c.kos.length, 0) + device.kos.length;
  const hasChildren = koCount > 0;
  const effectiveOpen = open || !!query;

  return (
    <div>
      <div
        style={{ ...rowStyle(depth), cursor: hasChildren ? 'pointer' : 'default' }}
        onClick={() => hasChildren && setOpen(o => !o)}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <Caret open={effectiveOpen} hasChildren={hasChildren} />
        <Cpu size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem', fontWeight: 600,
          color: 'var(--text-main)', flexShrink: 0,
        }}>{device.address}</span>
        <span title={device.name} style={{
          flex: 1, minWidth: 0, fontSize: '0.78rem', color: 'var(--text-dim)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{device.name}</span>
        {hasChildren && (
          <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', flexShrink: 0 }}>
            {koCount} KO{koCount !== 1 ? 's' : ''}
          </span>
        )}
        <button
          style={iconBtnStyle}
          title="Filter by this device (source)"
          onClick={e => { e.stopPropagation(); onFilterDevice(device.address); }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
        >
          <Filter size={12} />
        </button>
        <button
          style={iconBtnStyle}
          title="Show last seen values"
          onClick={e => { e.stopPropagation(); onLastSeen(device.address, 'pa'); }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
        >
          <Clock size={12} />
        </button>
      </div>
      {effectiveOpen && hasChildren && (
        <div>
          {device.channels.map(ch => {
            const visibleKos = query ? ch.kos.filter(k => koMatches(k, query)) : ch.kos;
            if (visibleKos.length === 0) return null;
            return (
              <ChannelRow
                key={ch.id} channel={ch} visibleKos={visibleKos} depth={depth + 1}
                query={query} onFilterGAs={onFilterGAs} onLastSeen={onLastSeen}
              />
            );
          })}
          {(query ? device.kos.filter(k => koMatches(k, query)) : device.kos).map((ko, i) => (
            <KoRow key={`${ko.number}-${i}`} ko={ko} depth={depth + 1} onFilterGAs={onFilterGAs} onLastSeen={onLastSeen} />
          ))}
        </div>
      )}
    </div>
  );
};

const ChannelRow: React.FC<{
  channel: Channel;
  visibleKos: Ko[];
  depth: number;
  query: string;
  onFilterGAs: (addresses: string[]) => void;
  onLastSeen: (address: string, mode: 'ga' | 'pa') => void;
}> = ({ channel, visibleKos, depth, query, onFilterGAs, onLastSeen }) => {
  const [open, setOpen] = useState(false);
  const effectiveOpen = open || !!query;
  return (
    <div>
      <div
        style={{ ...rowStyle(depth), cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <Caret open={effectiveOpen} hasChildren={true} />
        <Layers size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: '0.76rem', fontWeight: 500, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {channel.name || 'Channel'}
        </span>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', flexShrink: 0 }}>
          {visibleKos.length} KO{visibleKos.length !== 1 ? 's' : ''}
        </span>
      </div>
      {effectiveOpen && visibleKos.map((ko, i) => (
        <KoRow key={`${ko.number}-${i}`} ko={ko} depth={depth + 1} onFilterGAs={onFilterGAs} onLastSeen={onLastSeen} />
      ))}
    </div>
  );
};

// ── Space node ──────────────────────────────────────────────────────────────────

const SpaceRow: React.FC<{
  space: SpaceNode;
  depth: number;
  query: string;
  onFilterDevice: (pa: string) => void;
  onFilterGAs: (addresses: string[]) => void;
  onLastSeen: (address: string, mode: 'ga' | 'pa') => void;
}> = ({ space, depth, query, onFilterDevice, onFilterGAs, onLastSeen }) => {
  const [open, setOpen] = useState(depth < 2);
  if (query && !spaceMatches(space, query)) return null;
  const effectiveOpen = open || !!query;
  const hasChildren = space.spaces.length > 0 || space.devices.length > 0;
  const visibleDevices = query ? space.devices.filter(d => deviceMatches(d, query)) : space.devices;

  return (
    <div>
      <div
        style={{ ...rowStyle(depth), cursor: hasChildren ? 'pointer' : 'default' }}
        onClick={() => hasChildren && setOpen(o => !o)}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <Caret open={effectiveOpen} hasChildren={hasChildren} />
        <Building2 size={13} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {space.name || space.type}
        </span>
        {space.type && (
          <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', flexShrink: 0 }}>
            {space.type}
          </span>
        )}
      </div>
      {effectiveOpen && (
        <div>
          {space.spaces.map((sub, i) => (
            <SpaceRow
              key={`${sub.name}-${i}`} space={sub} depth={depth + 1} query={query}
              onFilterDevice={onFilterDevice} onFilterGAs={onFilterGAs} onLastSeen={onLastSeen}
            />
          ))}
          {visibleDevices.map(device => (
            <DeviceRow
              key={device.address} device={device} depth={depth + 1} query={query}
              onFilterDevice={onFilterDevice} onFilterGAs={onFilterGAs} onLastSeen={onLastSeen}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main overlay ────────────────────────────────────────────────────────────────

export const BuildingOverlay: React.FC<BuildingOverlayProps> = ({
  onClose, onFilterDevice, onFilterGAs, onLastSeen,
}) => {
  const [data, setData] = useState<BuildingData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchBuilding = useCallback(() => {
    setIsLoading(true);
    fetch(apiUrl('/api/building'))
      .then(r => r.json())
      .then((d: BuildingData) => setData(d))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchBuilding();
  }, [fetchBuilding]);

  const query = searchQuery.trim().toLowerCase();

  const visibleUnassigned = useMemo(() => {
    if (!data) return [];
    return query ? data.unassigned_devices.filter(d => deviceMatches(d, query)) : data.unassigned_devices;
  }, [data, query]);

  const isEmpty = data && data.tree.length === 0 && data.unassigned_devices.length === 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)',
        flexShrink: 0, background: 'var(--bg-subtle)',
      }}>
        <Building2 size={16} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>Building Structure</span>
        <div style={{ flex: 1 }} />
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Filter…"
          className="glass-input"
          style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem', borderRadius: 6, width: 180 }}
        />
        <button
          onClick={fetchBuilding}
          disabled={isLoading}
          title="Refresh"
          style={{ background: 'transparent', border: 'none', cursor: isLoading ? 'not-allowed' : 'pointer', color: 'var(--text-dim)', padding: '0.2rem', display: 'flex' }}
        >
          <RefreshCw size={14} style={isLoading ? { animation: 'spin 1s linear infinite' } : undefined} />
        </button>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: '0.2rem', display: 'flex' }}>
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      {isLoading && !data ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
          Loading…
        </div>
      ) : !data || data.status === 'no_project_loaded' || isEmpty ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem' }}>
          No building structure available. Upload an ETS project file with building/location data.
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0' }}>
          {data.tree.map((space, i) => (
            <SpaceRow
              key={`${space.name}-${i}`} space={space} depth={0} query={query}
              onFilterDevice={onFilterDevice} onFilterGAs={onFilterGAs} onLastSeen={onLastSeen}
            />
          ))}

          {visibleUnassigned.length > 0 && (
            <div style={{ marginTop: data.tree.length > 0 ? '0.5rem' : 0 }}>
              <div style={{ ...rowStyle(0), color: 'var(--text-dim)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Unassigned Devices
              </div>
              {visibleUnassigned.map(device => (
                <DeviceRow
                  key={device.address} device={device} depth={1} query={query}
                  onFilterDevice={onFilterDevice} onFilterGAs={onFilterGAs} onLastSeen={onLastSeen}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
