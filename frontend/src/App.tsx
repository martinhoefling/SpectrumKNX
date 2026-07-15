import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useWebSocket, type Telegram, type ConnectionStateEvent } from './hooks/useWebSocket';
import { parseViewUrl } from './utils/viewUrl';
import { DeviceStatusOverlay } from './components/DeviceStatusOverlay';
import { TelegramTable, type SortConfig, type SortKey } from './components/TelegramTable';
import { readSortConfigCookie, writeSortConfigCookie } from './utils/sortConfig';
import { LayoutDashboard, History, Settings, Play, Pause, Download, Trash2, SlidersHorizontal, LineChart, BarChart2, Building2, Database, ChevronDown, AlertTriangle, Sun, Moon, Monitor, FolderInput, Send, Sparkles } from 'lucide-react';
import { getCookie, setCookie } from './utils/cookies';
import { useTheme } from './hooks/useTheme';
import { apiUrl, wsUrl } from './utils/basePath';
import { HistoryLoader } from './components/HistoryLoader';
import { HistorySearch } from './components/HistorySearch';
import { ImportExportView } from './components/ImportExportView';
import { Visualizer } from './components/Visualizer';
import { FilterPanel } from './components/FilterPanel';
import { ProjectUploadWizard } from './components/ProjectUploadWizard';
import { KeysUploadWizard } from './components/KeysUploadWizard';
import { LastSeenOverlay } from './components/LastSeenOverlay';
import { StatisticsOverlay } from './components/StatisticsOverlay';
import { BuildingOverlay, type DeviceNode } from './components/BuildingOverlay';
import { DatabaseOverlay } from './components/DatabaseOverlay';
import { SendTelegramBar } from './components/SendTelegramBar';
import { UpdateNotification } from './components/UpdateNotification';
import { useUpdateCheck } from './hooks/useUpdateCheck';
import {
  DEFAULT_FILTERS,
  dptKey,
  hasActiveFilters,
  matchesTelegram,
  type ActiveFilters,
  type FilterOptions,
  type FilterCounts,
} from './types/filters';

declare const __APP_VERSION__: string;

// Remembers the latest version the user already dismissed, so the popup shows
// once per new release rather than on every load.
const DISMISSED_UPDATE_COOKIE = 'dismissed_update_version';

const EMPTY_FILTER_OPTIONS: FilterOptions = { sources: [], targets: [], types: [], dpts: [], ga_group_names: {}, pa_line_names: {} };

const NavDropdown = ({ activeTab, isSettingsOpen, onChange }: { activeTab: string, isSettingsOpen: boolean, onChange: (id: string) => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const items = [
    { id: 'live', label: 'Group Monitor', icon: LayoutDashboard },
    { id: 'history', label: 'History Search', icon: History },
    { id: 'import', label: 'Import / Export', icon: FolderInput },
    { id: 'settings', label: 'Settings', icon: Settings }
  ];

  const currentSelection = isSettingsOpen ? 'settings' : activeTab;
  const activeItem = items.find(i => i.id === currentSelection) || items[0];
  const ActiveIcon = activeItem.icon;

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="glass-input"
        style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          fontSize: '0.95rem', fontWeight: 600, padding: '0.5rem 1rem',
          borderRadius: '8px', border: '1px solid var(--border-color)',
          background: isOpen ? 'var(--bg-hover)' : 'var(--bg-tag)',
          color: 'var(--text-main)', cursor: 'pointer', outline: 'none',
          minWidth: '220px', justifyContent: 'space-between',
          transition: 'all 0.2s ease'
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <ActiveIcon size={18} className="accent-primary" />
          {activeItem.label}
        </span>
        <ChevronDown size={18} style={{ color: 'var(--text-dim)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>

      {isOpen && (
        <div
          className="glass"
          style={{
            position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem',
            width: '100%', borderRadius: '8px',
            border: '1px solid var(--border-color)',
            padding: '0.5rem', zIndex: 100,
            display: 'flex', flexDirection: 'column', gap: '0.25rem',
            boxShadow: 'var(--shadow-lg)'
          }}
        >
          {items.map(item => {
            const Icon = item.icon;
            const isActive = item.id === currentSelection;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onChange(item.id);
                  setIsOpen(false);
                }}
                className={`nav-item ${isActive ? 'active' : ''}`}
                style={{
                   display: 'flex', alignItems: 'center', gap: '0.75rem',
                   padding: '0.75rem 1rem', borderRadius: '6px', border: 'none',
                   background: isActive ? 'rgba(99,102,241,0.1)' : 'transparent',
                   color: isActive ? 'var(--accent-primary)' : 'var(--text-main)',
                   cursor: 'pointer', fontWeight: 500, width: '100%', textAlign: 'left',
                   transition: 'all 0.2s ease', fontSize: '0.9rem'
                }}
              >
                <Icon size={18} />
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  );
};

function App() {
  const [theme, setTheme] = useTheme();
  // A view shared via URL (#150) starts on the History tab with its filters applied.
  const [initialView] = useState(() => parseViewUrl(window.location.search));
  const [activeTab, setActiveTab] = useState<'live' | 'history' | 'import'>(initialView ? 'history' : 'live');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(true);
  const [isVisualizerOpen, setIsVisualizerOpen] = useState(false);
  const [isLastSeenOpen, setIsLastSeenOpen] = useState(false);
  const [lastSeenAddresses, setLastSeenAddresses] = useState<string[]>([]);
  const [lastSeenMode, setLastSeenMode] = useState<'ga' | 'pa'>('ga');
  const [isStatisticsOpen, setIsStatisticsOpen] = useState(false);
  const [isBuildingOpen, setIsBuildingOpen] = useState(false);
  const [statusDevice, setStatusDevice] = useState<DeviceNode | null>(null);
  const [latestTelegram, setLatestTelegram] = useState<Telegram | null>(null);
  const [isDatabaseOpen, setIsDatabaseOpen] = useState(false);
  const [isSendOpen, setIsSendOpen] = useState(false);
  const [sendPrefill, setSendPrefill] = useState<{ address: string; nonce: number } | null>(null);
  const [backendVersion, setBackendVersion] = useState<string>('loading...');
  const [projectStatus, setProjectStatus] = useState<{
    upload_feature_active: boolean;
    upload_writable: boolean;
    project_loaded: boolean;
    upload_required: boolean;
  } | null>(null);
  const [isUploadWizardOpen, setIsUploadWizardOpen] = useState(false);
  const [isKeysWizardOpen, setIsKeysWizardOpen] = useState(false);
  const [knxkeysStatus, setKnxkeysStatus] = useState<{ upload_feature_active: boolean; knxkeys_found: boolean } | null>(null);
  const updateInfo = useUpdateCheck();
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);
  const [updateClosed, setUpdateClosed] = useState(false);
  // Version the user has already been shown, read once at mount. Kept in state
  // (not re-read) so persisting "seen" below doesn't retract the popup mid-view.
  const [seenUpdateVersion] = useState(() => getCookie(DISMISSED_UPDATE_COOKIE));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [serverConfig, setServerConfig] = useState<any>(null);

  // ── Settings & Persistence ──────────────────────────────────────────────────
  const [loadLimit, setLoadLimit] = useState(Number(getCookie('loadLimit') || 25000));
  const [visibleColumns, setVisibleColumns] = useState<{ [key: string]: boolean }>(() => {
    try {
      const cookie = getCookie('visibleColumns');
      if (cookie) return JSON.parse(cookie);
    } catch {
      // Ignore cookie parsing errors
    }
    return {
      time: true, delta: true, source: true, sourceName: true,
      target: true, targetName: true, type: true, dpt: true, data: true, value: true,
    };
  });
  const [rateMode, setRateMode] = useState<'s' | 'm' | 'h'>((getCookie('rateMode') as 's' | 'm' | 'h') || 's');

  const [isHistoryLoaderOpen, setIsHistoryLoaderOpen] = useState(false);
  const [selectedVisualizationTargets, setSelectedVisualizationTargets] = useState<string[]>(initialView?.plot ?? []);

  // ── Live State ──────────────────────────────────────────────────────────────
  const [liveTelegrams, setLiveTelegrams] = useState<Telegram[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const bufferRef = useRef<Telegram[]>([]);
  const [bufferedCount, setBufferedCount] = useState(0);

  // ── Rate Estimation ─────────────────────────────────────────────────────────
  const [busRate, setBusRate] = useState(0);
  const arrivalTimesRef = useRef<number[]>([]);

  // ── Filter State ────────────────────────────────────────────────────────────
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(EMPTY_FILTER_OPTIONS);
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(initialView?.filters ?? DEFAULT_FILTERS);

  const handleFiltersChange = useCallback((newFilters: ActiveFilters | ((prev: ActiveFilters) => ActiveFilters)) => {
    setActiveFilters((prevFilters) => {
      const updatedFilters = typeof newFilters === 'function' ? newFilters(prevFilters) : newFilters;

      const addedTargets = updatedFilters.targets.filter(t => !prevFilters.targets.includes(t));
      const removedTargets = prevFilters.targets.filter(t => !updatedFilters.targets.includes(t));

      const addedSources = updatedFilters.sources.filter(s => !prevFilters.sources.includes(s));
      const removedSources = prevFilters.sources.filter(s => !updatedFilters.sources.includes(s));

      const added = [...addedTargets, ...addedSources];
      const removed = [...removedTargets, ...removedSources];

      if (added.length > 0 || removed.length > 0) {
        setSelectedVisualizationTargets(prevSelected => {
          let next = [...prevSelected];
          added.forEach(a => { if (!next.includes(a)) next.push(a); });
          removed.forEach(r => { next = next.filter(t => t !== r); });
          return next;
        });
      }

      return updatedFilters;
    });
  }, []);

  const refreshServerConfig = useCallback(() => {
    fetch(apiUrl('/api/server/config'))
      .then(r => r.json())
      .then(data => setServerConfig(data))
      .catch(err => console.error("Failed to load server config", err));
  }, []);

  // Load filter options from backend on mount
  useEffect(() => {
    fetch(apiUrl('/api/filter-options'))
      .then(r => r.json())
      .then(data => setFilterOptions({
        sources: data.sources || [],
        targets: data.targets || [],
        types: data.types || ['Write', 'Read', 'Response'],
        dpts: data.dpts || [],
        ga_group_names: data.ga_group_names || {},
        pa_line_names: data.pa_line_names || {},
      }))
      .catch(() => {
        // Fallback: populate only the static types
        setFilterOptions(prev => ({ ...prev, types: ['Write', 'Read', 'Response'] }));
      });

    // Load backend version
    fetch(apiUrl('/api/version'))
      .then(r => r.json())
      .then(data => setBackendVersion(data.version || 'unknown'))
      .catch(() => setBackendVersion('error'));

    // Load project status
    fetch(apiUrl('/api/project/status'))
      .then(r => r.json())
      .then(data => {
        setProjectStatus(data);
        if (data.upload_required) {
          setIsUploadWizardOpen(true);
        }
      })
      .catch(err => console.error("Failed to check project status", err));

    // Load knxkeys status
    fetch(apiUrl('/api/knxkeys/status'))
      .then(r => r.json())
      .then(data => setKnxkeysStatus(data))
      .catch(err => console.error("Failed to check knxkeys status", err));

    // Load server config
    refreshServerConfig();
  }, [refreshServerConfig]);

  // A new release the user hasn't been shown yet (seenUpdateVersion is frozen
  // at mount, so it stays true for the session once detected). Auto-shows once;
  // updateClosed hides it after the user dismisses it, the chip can reopen it.
  const hasNewUpdate =
    !!updateInfo?.update_available && !!updateInfo.latest && updateInfo.latest !== seenUpdateVersion;
  const showUpdate = isUpdateOpen || (hasNewUpdate && !updateClosed);

  // Persist "seen" as soon as a new release is detected, so the popup appears
  // only once across reloads even if the user navigates away without closing it.
  useEffect(() => {
    if (hasNewUpdate && updateInfo?.latest) {
      setCookie(DISMISSED_UPDATE_COOKIE, updateInfo.latest);
    }
  }, [hasNewUpdate, updateInfo?.latest]);

  // ── WebSocket ───────────────────────────────────────────────────────────────
  const handleTelegram = useCallback((t: Telegram) => {
    // Track the newest telegram even while paused — the device status view (#153)
    // stays live independently of the table.
    setLatestTelegram(t);
    const now = Date.now();
    arrivalTimesRef.current.push(now);
    const oneHourAgo = now - 3_600_000;
    while (arrivalTimesRef.current.length > 0 && arrivalTimesRef.current[0] < oneHourAgo) {
      arrivalTimesRef.current.shift();
    }

    if (!isPaused) {
      setLiveTelegrams(prev => {
        const next = [t, ...prev];
        return next.length > loadLimit ? next.slice(0, loadLimit) : next;
      });
    } else {
      bufferRef.current.push(t);
      setBufferedCount(prev => prev + 1);
    }
  }, [isPaused, loadLimit]);

  const handleConnectionState = useCallback((e: ConnectionStateEvent) => {
    // Flip the badge immediately, then refetch for authoritative state
    // (write_enabled depends on the connection and is recomputed server-side).
    setServerConfig((prev: { status?: { connected?: boolean; write_enabled?: boolean } } | null) => prev
      ? {
          ...prev,
          status: {
            ...prev.status,
            connected: e.connected,
            write_enabled: prev.status?.write_enabled && e.connected,
          },
        }
      : prev);
    refreshServerConfig();
  }, [refreshServerConfig]);

  const wsEndpoint = wsUrl('/ws/telegrams');
  const { isConnected } = useWebSocket(wsEndpoint, handleTelegram, handleConnectionState);

  // ── Persist settings to cookies ─────────────────────────────────────────────
  useEffect(() => {
    setCookie('loadLimit', loadLimit.toString());
    setCookie('visibleColumns', JSON.stringify(visibleColumns));
    setCookie('rateMode', rateMode);
  }, [loadLimit, visibleColumns, rateMode]);

  // ── Rate Calculation Loop ───────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      let windowMs = 5000;
      if (rateMode === 'm') windowMs = 60_000;
      if (rateMode === 'h') windowMs = 3_600_000;
      const cutoff = now - windowMs;
      const count = arrivalTimesRef.current.filter(t => t > cutoff).length;
      if (rateMode === 's') setBusRate(count / (windowMs / 1000));
      else setBusRate(count);
    }, 1000);
    return () => clearInterval(interval);
  }, [rateMode]);

  // ── Pause / Resume ──────────────────────────────────────────────────────────
  const togglePause = () => {
    if (isPaused) {
      setLiveTelegrams(prev => {
        const next = [...bufferRef.current, ...prev];
        return next.length > loadLimit ? next.slice(0, loadLimit) : next;
      });
      bufferRef.current = [];
      setBufferedCount(0);
    }
    setIsPaused(!isPaused);
  };

  const toggleColumn = (col: string) =>
    setVisibleColumns(prev => ({ ...prev, [col]: !prev[col] }));

  const handleHistoricalLoad = (newTelegrams: Telegram[]) => {
    setLiveTelegrams(prev => {
      const existingTs = new Set(prev.map(t => t.timestamp));
      const deduped = newTelegrams.filter(t => !existingTs.has(t.timestamp));
      const next = [...deduped, ...prev];
      return next.length > loadLimit ? next.slice(0, loadLimit) : next;
    });
  };

  // ── Sorting ─────────────────────────────────────────────────────────────────
  const [sortConfig, setSortConfig] = useState<SortConfig>(readSortConfigCookie);
  const handleSort = (key: SortKey) => {
    setSortConfig(prev => {
      const next: SortConfig = {
        key,
        direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
      };
      writeSortConfigCookie(next);
      return next;
    });
  };

  const handleQuickFilter = (key: 'sources' | 'targets' | 'types' | 'dpts', value: string | number) => {
    handleFiltersChange(prev => {
      const current = prev[key] as (string | number)[];
      const isPresent = current.includes(value as never);
      return {
        ...prev,
        [key]: isPresent ? current.filter(v => v !== value) : [...current, value]
      };
    });
    setIsFilterOpen(true);
  };

  const handleQuickSend = (targetAddress: string) => {
    setSendPrefill({ address: targetAddress, nonce: Date.now() });
    setIsSendOpen(true);
  };

  const handleQuickVisualize = (targetAddress: string) => {
    setSelectedVisualizationTargets(prev =>
      prev.includes(targetAddress) ? prev : [...prev, targetAddress]
    );
    setIsVisualizerOpen(true);
    setIsLastSeenOpen(false);
    setIsStatisticsOpen(false);
    setIsBuildingOpen(false);
    setIsDatabaseOpen(false);
  };

  const handleQuickLastSeen = useCallback((address: string | string[], mode: 'ga' | 'pa') => {
    setLastSeenAddresses(Array.isArray(address) ? address : [address]);
    setLastSeenMode(mode);
    setIsLastSeenOpen(true);
    setIsVisualizerOpen(false);
    setIsStatisticsOpen(false);
    setIsBuildingOpen(false);
    setIsDatabaseOpen(false);
  }, []);

  // Add all of a KO's connected group addresses to the target filter (union).
  const handleFilterGAs = useCallback((addresses: string[]) => {
    handleFiltersChange(prev => ({
      ...prev,
      targets: [...new Set([...prev.targets, ...addresses])],
    }));
    setIsFilterOpen(true);
  }, [handleFiltersChange]);

  const sortedLiveTelegrams = useMemo(() => {
    const items = [...liveTelegrams];
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
  }, [liveTelegrams, sortConfig]);

  // ── In-memory filtering (live view) ────────────────────────────────────────
  const filteredLiveTelegrams = useMemo(() => {
    const f = activeFilters;
    const noFilter =
      f.sources.length === 0 &&
      f.targets.length === 0 &&
      f.types.length === 0 &&
      f.directions.length === 0 &&
      f.dpts.length === 0;

    // Step 1: mark each row as matching / not-matching
    const matches = sortedLiveTelegrams.map(t =>
      noFilter ? true : matchesTelegram(t, f)
    );

    const hasDelta = f.deltaBeforeMs > 0 || f.deltaAfterMs > 0;

    if (!hasDelta) {
      return sortedLiveTelegrams.filter((_, idx) => matches[idx]);
    }

    // Step 2: asymmetric time-delta expansion
    const matchingTimestamps = sortedLiveTelegrams
      .filter((_, idx) => matches[idx])
      .map(t => new Date(t.timestamp).getTime());

    if (matchingTimestamps.length === 0) return [];

    return sortedLiveTelegrams.filter((t, idx) => {
      if (matches[idx]) return true;
      const ts = new Date(t.timestamp).getTime();
      return matchingTimestamps.some(mts =>
        (ts >= mts - f.deltaBeforeMs) && (ts <= mts + f.deltaAfterMs)
      );
    });
  }, [sortedLiveTelegrams, activeFilters]);

  // ── Count bubbles (live only) ───────────────────────────────────────────────
  const filterCounts = useMemo((): FilterCounts => {
    const sources: Record<string, number> = {};
    const targets: Record<string, number> = {};
    const types: Record<string, number> = {};
    const directions: Record<string, number> = {};
    const dpts: Record<string, number> = {};

    for (const t of sortedLiveTelegrams) {
      sources[t.source_address] = (sources[t.source_address] ?? 0) + 1;
      targets[t.target_address] = (targets[t.target_address] ?? 0) + 1;
      if (t.simplified_type) types[t.simplified_type] = (types[t.simplified_type] ?? 0) + 1;
      if (t.direction) directions[t.direction] = (directions[t.direction] ?? 0) + 1;
      if (t.dpt_main != null) {
        const key = dptKey(t.dpt_main, t.dpt_sub);
        dpts[key] = (dpts[key] ?? 0) + 1;
        // A bare-main option ("all 1.x") counts every subtype
        if (t.dpt_sub != null) dpts[`${t.dpt_main}`] = (dpts[`${t.dpt_main}`] ?? 0) + 1;
      }
    }
    return { sources, targets, types, directions, dpts };
  }, [sortedLiveTelegrams]);

  const activeFilterCount = hasActiveFilters(activeFilters)
    ? activeFilters.sources.length + activeFilters.targets.length + activeFilters.types.length + activeFilters.directions.length + activeFilters.dpts.length
    : 0;

  return (
    <div className="container dashboard-grid" style={{ padding: '1.5rem', gap: '1.5rem' }}>

      {/* ── Main area (Full Width) ─── */}
      <main style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, borderRadius: '12px' }} className="glass">

        {/* === GLOBAL HEADER === */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', flexShrink: 0, background: 'rgba(0,0,0,0.2)' }}>
          {/* Left: App Section Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, zIndex: 50 }}>
            <NavDropdown
              activeTab={activeTab}
              isSettingsOpen={isSettingsOpen}
              onChange={(id) => {
                if (id === 'settings') {
                  setIsSettingsOpen(true);
                  if (activeTab !== 'live') setActiveTab('live');
                } else {
                  setIsSettingsOpen(false);
                  setActiveTab(id as 'live' | 'history' | 'import');
                }
              }}
            />
          </div>

          {/* Center: Brand — flexible middle column, clips gracefully instead of overlapping the actions */}
          <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', padding: '0 0.75rem', pointerEvents: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexShrink: 0 }}>
              <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Spectrum KNX" style={{ width: 22, height: 22 }} />
              <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>Spectrum KNX</h1>
            </div>
          </div>

          {/* Right: Actions */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexShrink: 0 }}>
            {activeTab === 'live' && !isSettingsOpen && (
              <>
                {/* Embedded Stats */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginRight: '1rem', background: 'var(--bg-subtle)', padding: '0.4rem 0.85rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-dim)' }}>
                    Rate: <span onClick={() => setRateMode(m => m === 's' ? 'm' : m === 'm' ? 'h' : 's')} style={{ color: 'var(--accent-primary)', fontWeight: 600, cursor: 'pointer' }}>{busRate.toFixed(1)}/{rateMode}</span>
                  </span>
                  <span style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-dim)' }}>
                    Buffer: <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>
                      {activeFilterCount
                        ? <>{filteredLiveTelegrams.length}<span style={{ color: 'var(--text-dim)', fontWeight: 400 }}> / {liveTelegrams.length}</span></>
                        : liveTelegrams.length}
                    </span>
                  </span>
                  {isPaused && (
                    <span style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#fbbf24' }}>
                      Paused: <span style={{ fontWeight: 600 }}>{bufferedCount}</span>
                    </span>
                  )}
                  <span style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-dim)' }}>
                    WS: <span style={{ color: isConnected ? 'var(--success)' : 'var(--error)', fontWeight: 500 }}>{isConnected ? 'Active' : 'Offline'}</span>
                  </span>
                  {filteredLiveTelegrams.length >= loadLimit && (
                    <span
                      style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#fbbf24', cursor: 'pointer' }}
                      onClick={() => setIsSettingsOpen(true)}
                      title={`Buffer full (${loadLimit.toLocaleString()}). Click to adjust in settings.`}
                    >
                      <AlertTriangle size={13} /> Limit reached
                    </span>
                  )}
                </div>

                <button
                  className="icon-button"
                  onClick={() => setIsFilterOpen(o => { const next = !o; if (next) setIsVisualizerOpen(false); return next; })}
                  title="Toggle filter panel"
                  style={{ position: 'relative', color: isFilterOpen || hasActiveFilters(activeFilters) ? 'var(--accent-primary)' : 'var(--text-dim)' }}
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

                <button
                  className="icon-button"
                  onClick={() => { setIsVisualizerOpen(v => !v); setIsLastSeenOpen(false); setIsStatisticsOpen(false); setIsBuildingOpen(false); setIsDatabaseOpen(false); }}
                  title="Visualize data"
                  style={{ color: isVisualizerOpen ? 'var(--accent-primary)' : 'var(--text-dim)' }}
                >
                  <LineChart size={18} />
                </button>
                <button
                  className="icon-button"
                  onClick={() => { setIsStatisticsOpen(v => !v); setIsVisualizerOpen(false); setIsLastSeenOpen(false); setIsBuildingOpen(false); setIsDatabaseOpen(false); }}
                  title="Traffic statistics"
                  style={{ color: isStatisticsOpen ? 'var(--accent-primary)' : 'var(--text-dim)' }}
                >
                  <BarChart2 size={18} />
                </button>
                <button
                  className="icon-button"
                  onClick={() => { setIsBuildingOpen(v => !v); setStatusDevice(null); setIsVisualizerOpen(false); setIsLastSeenOpen(false); setIsStatisticsOpen(false); setIsDatabaseOpen(false); }}
                  title="Building structure"
                  style={{ color: isBuildingOpen ? 'var(--accent-primary)' : 'var(--text-dim)' }}
                >
                  <Building2 size={18} />
                </button>
                <button
                  className="icon-button"
                  onClick={() => { setIsDatabaseOpen(v => !v); setIsVisualizerOpen(false); setIsLastSeenOpen(false); setIsStatisticsOpen(false); setIsBuildingOpen(false); }}
                  title="Database maintenance"
                  style={{ color: isDatabaseOpen ? 'var(--accent-primary)' : 'var(--text-dim)' }}
                >
                  <Database size={18} />
                </button>
                {serverConfig?.status?.write_enabled && (
                  <button
                    className="icon-button"
                    onClick={() => setIsSendOpen(o => !o)}
                    title="Send / read telegrams"
                    style={{ color: isSendOpen ? 'var(--accent-primary)' : 'var(--text-dim)' }}
                  >
                    <Send size={18} />
                  </button>
                )}
                <div style={{ width: 1, height: 18, background: 'var(--border-color)' }} />

                <button className="icon-button" onClick={togglePause} title={isPaused ? 'Resume' : 'Pause'}>
                  {isPaused ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}
                </button>
                <button className="icon-button" onClick={() => setIsHistoryLoaderOpen(true)} title="Load history">
                  <Download size={18} />
                </button>
                <div style={{ width: 1, height: 18, background: 'var(--border-color)' }} />
                <button className="icon-button" onClick={() => { setLiveTelegrams([]); bufferRef.current = []; setBufferedCount(0); }} title="Clear" style={{ color: 'var(--text-dim)' }}>
                  <Trash2 size={18} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* === MAIN CONTENT BODY === */}
        {isSettingsOpen ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '2rem' }}>
            <div className="glass-card" style={{ padding: '1.5rem', maxWidth: 600, margin: '0 auto' }}>
               <h2 style={{ marginBottom: '1.5rem', fontSize: '1.1rem' }}>Application Settings</h2>

              <h3 style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>
                Appearance
              </h3>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
                {([
                  { id: 'system', label: 'System', Icon: Monitor },
                  { id: 'light',  label: 'Light',  Icon: Sun },
                  { id: 'dark',   label: 'Dark',   Icon: Moon },
                ] as const).map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    onClick={() => setTheme(id)}
                    style={{
                      flex: 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                      padding: '0.5rem',
                      borderRadius: 6,
                      border: `1px solid ${theme === id ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                      background: theme === id ? 'rgba(99,102,241,0.15)' : 'var(--bg-subtle)',
                      color: theme === id ? 'var(--accent-primary)' : 'var(--text-dim)',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: theme === id ? 600 : 400,
                      transition: 'all 0.15s',
                    }}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>

               <h3 style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>
                Table Columns
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '2rem' }}>
                {Object.keys(visibleColumns).map(col => (
                  <button key={col} className="setting-item" onClick={() => toggleColumn(col)} style={{ padding: '0.5rem', background: 'var(--bg-subtle)', borderRadius: 6 }}>
                    <div className={`checkbox ${visibleColumns[col] ? 'checked' : ''}`} style={{ width: 14, height: 14, border: '1px solid var(--border-color)', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {visibleColumns[col] && <div style={{ width: 8, height: 8, background: 'white', borderRadius: 2 }} />}
                    </div>
                    <span style={{ fontSize: '0.85rem' }}>{col === 'dpt' ? 'DPT' : col.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</span>
                  </button>
                ))}
              </div>

              <h3 style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>
                Loading Limit
              </h3>
              <div className="input-group">
                <input
                  type="number"
                  step="1000"
                  className="glass-input"
                  style={{ width: '100%', padding: '0.75rem', fontSize: '0.85rem' }}
                  value={loadLimit}
                  onChange={e => setLoadLimit(Number(e.target.value))}
                />
              </div>

              <>
                <h3 style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.75rem', letterSpacing: '0.05em', marginTop: '1.5rem' }}>
                  Project File
                </h3>
                {projectStatus?.upload_writable === false ? (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                    Project file is not writable. Mount the project directory as a writable volume to enable browser upload.
                  </div>
                ) : (
                  <button
                    className="glass-input"
                    onClick={() => setIsUploadWizardOpen(true)}
                    style={{ width: '100%', padding: '0.75rem', textAlign: 'left', cursor: 'pointer', fontSize: '0.85rem' }}
                  >
                    Upload / Replace ETS Project File
                  </button>
                )}
              </>

              {knxkeysStatus?.upload_feature_active && (
                <>
                  <h3 style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.75rem', letterSpacing: '0.05em', marginTop: '1.5rem' }}>
                    KNX Security Keys
                  </h3>
                  <button
                    className="glass-input"
                    onClick={() => setIsKeysWizardOpen(true)}
                    style={{ width: '100%', padding: '0.75rem', textAlign: 'left', cursor: 'pointer', fontSize: '0.85rem' }}
                  >
                    Upload / Replace KNX Keys File (.knxkeys)
                  </button>
                </>
              )}

              {/* Server Configuration — always visible */}
              <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <h3 style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Server Configuration
                </h3>
                {serverConfig ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem' }}>
                    {/* Connection Status — in companion mode Home Assistant owns the
                        bus; what matters is whether our live feed from HA works (#184) */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-dim)' }}>
                        {serverConfig.mode === 'companion' ? 'Home Assistant Feed:' : 'KNX Connection:'}
                      </span>
                      <span style={{
                        color: serverConfig.status?.connected ? 'var(--success)' : 'var(--error)',
                        fontWeight: 600
                      }}>
                        {serverConfig.status?.connected ? '● Connected' : '● Disconnected'}
                      </span>
                    </div>

                    {/* Connection Settings */}
                    {Object.entries(serverConfig.connection || {}).map(([key, value]) => (
                      value != null && (
                        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: 'var(--text-dim)' }}>{key.replace(/_/g, ' ')}:</span>
                          <span style={{ fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-main)', background: 'var(--bg-tag)', padding: '0.15rem 0.4rem', borderRadius: 4, fontSize: '0.75rem' }}>
                            {String(value)}
                          </span>
                        </div>
                      )
                    ))}

                    {/* Files */}
                    <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-dim)' }}>Project file:</span>
                        <span style={{ color: serverConfig.files?.project_loaded ? 'var(--success)' : 'var(--text-dim)', fontSize: '0.75rem' }}>
                          {serverConfig.files?.project_loaded ? '● Loaded' : '○ Not loaded'}
                        </span>
                      </div>
                      {serverConfig.files?.knxkeys_found !== undefined && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem' }}>
                          <span style={{ color: 'var(--text-dim)' }}>KNX keys file:</span>
                          <span style={{ color: serverConfig.files?.knxkeys_found ? 'var(--success)' : 'var(--text-dim)', fontSize: '0.75rem' }}>
                            {serverConfig.files?.knxkeys_found ? '● Found' : '○ Not found'}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Security */}
                    {Object.entries(serverConfig.security || {}).some(([, v]) => v != null) && (
                      <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-subtle)' }}>
                        {Object.entries(serverConfig.security || {}).map(([key, value]) => (
                          value != null && (
                            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem' }}>
                              <span style={{ color: 'var(--text-dim)' }}>{key.replace(/_/g, ' ')}:</span>
                              <span style={{ fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-main)', background: 'var(--bg-tag)', padding: '0.15rem 0.4rem', borderRadius: 4, fontSize: '0.75rem' }}>
                                {String(value)}
                              </span>
                            </div>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Loading...</span>
                )}
              </div>

              <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <h3 style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  System Information
                </h3>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-dim)' }}>Frontend Version:</span>
                  <span style={{ fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-main)', background: 'var(--bg-tag)', padding: '0.2rem 0.4rem', borderRadius: 4 }}>
                    {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-dim)' }}>Backend Version:</span>
                  <span style={{ fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-main)', background: 'var(--bg-tag)', padding: '0.2rem 0.4rem', borderRadius: 4 }}>
                    {backendVersion}
                  </span>
                </div>
                {updateInfo?.enabled && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-dim)' }}>Updates:</span>
                    {updateInfo.update_available ? (
                      <button
                        onClick={() => setIsUpdateOpen(true)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer',
                          fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem', fontWeight: 600,
                          padding: '0.2rem 0.5rem', borderRadius: 4,
                          border: '1px solid var(--accent-primary)', background: 'rgba(99,102,241,0.12)',
                          color: 'var(--accent-primary)',
                        }}
                      >
                        <Sparkles size={13} /> {updateInfo.latest} available
                      </button>
                    ) : (
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                        {updateInfo.error ? 'Check failed' : 'Up to date'}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : activeTab === 'live' ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Content row: filter panel + table */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

              {/* Filter panel (slide-in) */}
              <div style={{
                width: isFilterOpen ? 'clamp(260px, 18vw, 340px)' : '0px',
                overflow: 'hidden',
                transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
                flexShrink: 0,
                borderRight: isFilterOpen ? '1px solid var(--border-color)' : 'none',
                display: 'flex',
                flexDirection: 'column'
              }}>
                <div style={{ width: 'clamp(260px, 18vw, 340px)', flex: 1, overflow: 'hidden' }}>
                  <FilterPanel
                    options={filterOptions}
                    activeFilters={activeFilters}
                    onFiltersChange={handleFiltersChange}
                    counts={filterCounts}
                    onQuickLastSeen={handleQuickLastSeen}
                    mode="live"
                    projectLoaded={projectStatus?.project_loaded}
                    onUploadProject={() => setIsSettingsOpen(true)}
                  />
                </div>
              </div>

              {/* Content body */}
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {isSendOpen && serverConfig?.status?.write_enabled && (
                  <SendTelegramBar
                    key={sendPrefill?.nonce ?? 'send-bar'}
                    targets={filterOptions.targets}
                    initialAddress={sendPrefill?.address}
                    onClose={() => setIsSendOpen(false)}
                  />
                )}
                {isVisualizerOpen ? (
                  <Visualizer
                    telegrams={filteredLiveTelegrams}
                    selectedTargets={selectedVisualizationTargets}
                    onTargetsChange={setSelectedVisualizationTargets}
                    onClose={() => setIsVisualizerOpen(false)}
                  />
                ) : isLastSeenOpen ? (
                  <LastSeenOverlay
                    filterOptions={filterOptions}
                    initialAddresses={lastSeenAddresses}
                    initialMode={lastSeenMode}
                    writeEnabled={serverConfig?.status?.write_enabled}
                    onClose={() => setIsLastSeenOpen(false)}
                  />
                ) : isStatisticsOpen ? (
                  <StatisticsOverlay
                    filterOptions={filterOptions}
                    onClose={() => setIsStatisticsOpen(false)}
                  />
                ) : isBuildingOpen && statusDevice ? (
                  <DeviceStatusOverlay
                    device={statusDevice}
                    latestTelegram={latestTelegram}
                    onClose={() => setStatusDevice(null)}
                  />
                ) : isBuildingOpen ? (
                  <BuildingOverlay
                    onClose={() => setIsBuildingOpen(false)}
                    onFilterDevice={(pa) => handleQuickFilter('sources', pa)}
                    onFilterGAs={handleFilterGAs}
                    onLastSeen={handleQuickLastSeen}
                    onDeviceStatus={setStatusDevice}
                  />
                ) : isDatabaseOpen ? (
                  <DatabaseOverlay onClose={() => setIsDatabaseOpen(false)} />
                ) : (
                  <TelegramTable
                    telegrams={filteredLiveTelegrams}
                    visibleColumns={visibleColumns}
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    activeFilters={activeFilters}
                    onQuickFilter={handleQuickFilter}
                    onQuickVisualize={handleQuickVisualize}
                    onQuickLastSeen={handleQuickLastSeen}
                    onQuickSend={serverConfig?.status?.write_enabled ? handleQuickSend : undefined}
                  />
                )}
              </div>
            </div>
          </div>
        ) : activeTab === 'import' ? (
          <ImportExportView />
        ) : (
          <HistorySearch
            visibleColumns={visibleColumns}
            loadLimit={loadLimit}
            filterOptions={filterOptions}
            activeFilters={activeFilters}
            onFiltersChange={handleFiltersChange}
            onOpenSettings={() => setIsSettingsOpen(true)}
            projectLoaded={projectStatus?.project_loaded}
            selectedVisualizationTargets={selectedVisualizationTargets}
            onVisualizationTargetsChange={setSelectedVisualizationTargets}
            initialView={initialView}
          />
        )}
      </main>

      {isHistoryLoaderOpen && (
        <HistoryLoader
          onClose={() => setIsHistoryLoaderOpen(false)}
          onLoad={handleHistoricalLoad}
          limit={loadLimit}
          mode="monitor"
        />
      )}

      {isUploadWizardOpen && (
        <ProjectUploadWizard
          isClosable={!projectStatus?.upload_required}
          onClose={() => setIsUploadWizardOpen(false)}
          onSuccess={() => {
            setIsUploadWizardOpen(false);
            window.location.reload();
          }}
        />
      )}

      {isKeysWizardOpen && (
        <KeysUploadWizard
          onClose={() => setIsKeysWizardOpen(false)}
          onSuccess={() => {
            setIsKeysWizardOpen(false);
            // Refresh server config to show updated status
            fetch(apiUrl('/api/server/config'))
              .then(r => r.json())
              .then(data => setServerConfig(data))
              .catch(() => {});
            fetch(apiUrl('/api/knxkeys/status'))
              .then(r => r.json())
              .then(data => setKnxkeysStatus(data))
              .catch(() => {});
          }}
        />
      )}

      {showUpdate && updateInfo && (
        <UpdateNotification
          info={updateInfo}
          onClose={() => {
            if (updateInfo.latest) setCookie(DISMISSED_UPDATE_COOKIE, updateInfo.latest);
            setUpdateClosed(true);
            setIsUpdateOpen(false);
          }}
        />
      )}

      <style>{`
        .nav-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; border-radius: 8px; border: none; background: transparent; color: var(--text-dim); cursor: pointer; font-weight: 500; transition: all 0.2s ease; width: 100%; text-align: left; }
        .nav-item:hover { background: var(--bg-hover); color: var(--text-main); }
        .nav-item.active { background: rgba(99,102,241,0.1); color: var(--accent-primary); }
        .icon-button { background: transparent; border: none; cursor: pointer; color: var(--text-dim); transition: all 0.2s; }
        .icon-button:hover { color: var(--text-main); transform: scale(1.1); }
        .setting-item { display: flex; align-items: center; gap: 0.6rem; background: transparent; border: none; color: var(--text-main); cursor: pointer; width: 100%; padding: 0.35rem 0; text-align: left; }
        .checkbox.checked { background: var(--accent-primary); border-color: var(--accent-primary); }
        .sort-header { background: transparent; border: none; color: inherit; text-transform: inherit; letter-spacing: inherit; font-size: inherit; font-weight: inherit; cursor: pointer; display: flex; align-items: center; gap: 0.25rem; padding: 0; }
        .mono-addr { font-family: 'JetBrains Mono', monospace; font-size: 0.8125rem; }
        .highlight { color: var(--text-dim); }
        .highlight-target { color: var(--accent-primary); font-weight: 500; }
        .subtitle-name { font-size: 0.7rem; color: var(--text-dim); margin-top: 0.15rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .raw-badge { background: var(--bg-tag); padding: 0.15rem 0.4rem; border-radius: 3px; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; color: var(--text-dim); display: inline-block; border: 1px solid var(--border-subtle); }
      `}</style>
    </div>
  );
}

export default App;
