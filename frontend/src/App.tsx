import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useWebSocket, type Telegram } from './hooks/useWebSocket';
import { TelegramTable, type SortConfig, type SortKey } from './components/TelegramTable';
import { LayoutDashboard, History, Settings, Play, Pause, Download, Trash2, SlidersHorizontal, LineChart, ChevronDown, AlertTriangle } from 'lucide-react';
import { getCookie, setCookie } from './utils/cookies';
import { apiUrl, wsUrl } from './utils/basePath';
import { HistoryLoader } from './components/HistoryLoader';
import { HistorySearch } from './components/HistorySearch';
import { Visualizer } from './components/Visualizer';
import { FilterPanel } from './components/FilterPanel';
import { ProjectUploadWizard } from './components/ProjectUploadWizard';
import {
  DEFAULT_FILTERS,
  hasActiveFilters,
  type ActiveFilters,
  type FilterOptions,
  type FilterCounts,
} from './types/filters';

declare const __APP_VERSION__: string;

const EMPTY_FILTER_OPTIONS: FilterOptions = { sources: [], targets: [], types: [], dpts: [] };

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
          background: isOpen ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)', 
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
  const [activeTab, setActiveTab] = useState<'live' | 'history'>('live');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isVisualizerOpen, setIsVisualizerOpen] = useState(false);
  const [backendVersion, setBackendVersion] = useState<string>('loading...');
  const [projectStatus, setProjectStatus] = useState<{
    upload_feature_active: boolean;
    project_loaded: boolean;
    upload_required: boolean;
  } | null>(null);
  const [isUploadWizardOpen, setIsUploadWizardOpen] = useState(false);

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
  const [selectedVisualizationTargets, setSelectedVisualizationTargets] = useState<string[]>([]);

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
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(DEFAULT_FILTERS);

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

  // Load filter options from backend on mount
  useEffect(() => {
    fetch(apiUrl('/api/filter-options'))
      .then(r => r.json())
      .then(data => setFilterOptions({
        sources: data.sources || [],
        targets: data.targets || [],
        types: data.types || ['Write', 'Read', 'Response'],
        dpts: data.dpts || [],
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
  }, []);

  // ── WebSocket ───────────────────────────────────────────────────────────────
  const handleTelegram = useCallback((t: Telegram) => {
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

  const wsEndpoint = wsUrl('/ws/telegrams');
  const { isConnected } = useWebSocket(wsEndpoint, handleTelegram);

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
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'timestamp', direction: 'desc' });
  const handleSort = (key: SortKey) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
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

  const handleQuickVisualize = (targetAddress: string) => {
    setSelectedVisualizationTargets(prev => 
      prev.includes(targetAddress) ? prev : [...prev, targetAddress]
    );
    setIsVisualizerOpen(true);
    setIsFilterOpen(false);
  };

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
      f.dpts.length === 0;

    // Step 1: mark each row as matching / not-matching
    const matches = sortedLiveTelegrams.map(t => {
      if (noFilter) return true;
      const srcOk = f.sources.length === 0 || f.sources.includes(t.source_address);
      const tgtOk = f.targets.length === 0 || f.targets.includes(t.target_address);
      const typeOk = f.types.length === 0 || f.types.includes(t.simplified_type ?? '');
      const dptOk = f.dpts.length === 0 || (t.dpt_main != null && f.dpts.includes(t.dpt_main));
      return srcOk && tgtOk && typeOk && dptOk;
    });

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
    const dpts: Record<number, number> = {};

    for (const t of sortedLiveTelegrams) {
      sources[t.source_address] = (sources[t.source_address] ?? 0) + 1;
      targets[t.target_address] = (targets[t.target_address] ?? 0) + 1;
      if (t.simplified_type) types[t.simplified_type] = (types[t.simplified_type] ?? 0) + 1;
      if (t.dpt_main != null) dpts[t.dpt_main] = (dpts[t.dpt_main] ?? 0) + 1;
    }
    return { sources, targets, types, dpts };
  }, [sortedLiveTelegrams]);

  const activeFilterCount = hasActiveFilters(activeFilters)
    ? activeFilters.sources.length + activeFilters.targets.length + activeFilters.types.length + activeFilters.dpts.length
    : 0;

  return (
    <div className="container dashboard-grid" style={{ padding: '1.5rem', gap: '1.5rem' }}>
      
      {/* ── Main area (Full Width) ─── */}
      <main style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, borderRadius: '12px' }} className="glass">
        
        {/* === GLOBAL HEADER === */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: 'rgba(0,0,0,0.2)' }}>
          {/* Left: App Section Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', zIndex: 50 }}>
            <NavDropdown
              activeTab={activeTab}
              isSettingsOpen={isSettingsOpen}
              onChange={(id) => {
                if (id === 'settings') {
                  setIsSettingsOpen(true);
                  if (activeTab === 'history') setActiveTab('live');
                } else {
                  setIsSettingsOpen(false);
                  setActiveTab(id as 'live' | 'history');
                }
              }}
            />
          </div>

          {/* Center: Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
            <img src="/logo.svg" alt="Spectrum KNX" style={{ width: 22, height: 22 }} />
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Spectrum KNX</h1>
          </div>

          {/* Right: Actions */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            {activeTab === 'live' && !isSettingsOpen && (
              <>
                {/* Embedded Stats */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginRight: '1rem', background: 'rgba(255,255,255,0.03)', padding: '0.4rem 0.85rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-dim)' }}>
                    Rate: <span onClick={() => setRateMode(m => m === 's' ? 'm' : m === 'm' ? 'h' : 's')} style={{ color: 'var(--accent-primary)', fontWeight: 600, cursor: 'pointer' }}>{busRate.toFixed(1)}/{rateMode}</span>
                  </span>
                  <span style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-dim)' }}>
                    Buffer: <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>{filteredLiveTelegrams.length}</span>
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
                  onClick={() => setIsVisualizerOpen(v => { const next = !v; if (next) setIsFilterOpen(false); return next; })}
                  title="Visualize data"
                  style={{ color: isVisualizerOpen ? 'var(--accent-primary)' : 'var(--text-dim)' }}
                >
                  <LineChart size={18} />
                </button>
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
                Table Columns
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '2rem' }}>
                {Object.keys(visibleColumns).map(col => (
                  <button key={col} className="setting-item" onClick={() => toggleColumn(col)} style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: 6 }}>
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

              {projectStatus?.upload_feature_active && (
                <>
                  <h3 style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.75rem', letterSpacing: '0.05em', marginTop: '1.5rem' }}>
                    Project File
                  </h3>
                  <button 
                    className="glass-input" 
                    onClick={() => setIsUploadWizardOpen(true)}
                    style={{ width: '100%', padding: '0.75rem', textAlign: 'left', cursor: 'pointer', fontSize: '0.85rem' }}
                  >
                    Upload / Replace ETS Project File
                  </button>
                </>
              )}

              <div style={{ marginTop: '3rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <h3 style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  System Information
                </h3>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-dim)' }}>Frontend Version:</span>
                  <span style={{ fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-main)', background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.4rem', borderRadius: 4 }}>
                    {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-dim)' }}>Backend Version:</span>
                  <span style={{ fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-main)', background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.4rem', borderRadius: 4 }}>
                    {backendVersion}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : activeTab === 'live' ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Content row: filter panel + table */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
              
              {/* Filter panel (slide-in) */}
              <div style={{
                width: isFilterOpen ? '260px' : '0px',
                overflow: 'hidden',
                transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
                flexShrink: 0,
                borderRight: isFilterOpen ? '1px solid var(--border-color)' : 'none',
                display: 'flex',
                flexDirection: 'column'
              }}>
                <div style={{ width: 260, flex: 1, overflow: 'hidden' }}>
                  <FilterPanel
                    options={filterOptions}
                    activeFilters={activeFilters}
                    onFiltersChange={handleFiltersChange}
                    counts={filterCounts}
                    mode="live"
                  />
                </div>
              </div>

              {/* Content body */}
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {isVisualizerOpen ? (
                  <Visualizer 
                    telegrams={filteredLiveTelegrams} 
                    selectedTargets={selectedVisualizationTargets}
                    onTargetsChange={setSelectedVisualizationTargets}
                    onClose={() => setIsVisualizerOpen(false)} 
                  />
                ) : (
                  <TelegramTable
                    telegrams={filteredLiveTelegrams}
                    visibleColumns={visibleColumns}
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    activeFilters={activeFilters}
                    onQuickFilter={handleQuickFilter}
                    onQuickVisualize={handleQuickVisualize}
                  />
                )}
              </div>
            </div>
          </div>
        ) : (
          <HistorySearch
            visibleColumns={visibleColumns}
            loadLimit={loadLimit}
            filterOptions={filterOptions}
            activeFilters={activeFilters}
            onFiltersChange={handleFiltersChange}
            onOpenSettings={() => setIsSettingsOpen(true)}
            selectedVisualizationTargets={selectedVisualizationTargets}
            onVisualizationTargetsChange={setSelectedVisualizationTargets}
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

      <style>{`
        .nav-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; border-radius: 8px; border: none; background: transparent; color: var(--text-dim); cursor: pointer; font-weight: 500; transition: all 0.2s ease; width: 100%; text-align: left; }
        .nav-item:hover { background: rgba(255,255,255,0.05); color: var(--text-main); }
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
        .raw-badge { background: rgba(255,255,255,0.05); padding: 0.15rem 0.4rem; border-radius: 3px; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; color: var(--text-dim); display: inline-block; border: 1px solid rgba(255,255,255,0.05); }
      `}</style>
    </div>
  );
}

export default App;
