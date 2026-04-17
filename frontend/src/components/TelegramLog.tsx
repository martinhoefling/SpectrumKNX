import React, { useState, useMemo, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import type { Telegram } from '../hooks/useWebSocket';
import { Terminal, Settings, Check, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';

interface TelegramLogProps {
  telegrams: Telegram[];
  isConnected: boolean;
  onClear: () => void;
}

type SortKey = 'timestamp' | 'source_address' | 'target_address' | 'simplified_type' | 'dpt_name' | 'value_numeric';

interface SortConfig {
  key: SortKey;
  direction: 'asc' | 'desc';
}

interface SortIconProps {
  column: SortKey;
  sortConfig: SortConfig;
}

const SortIcon = ({ column, sortConfig }: SortIconProps) => {
  if (sortConfig.key !== column) return null;
  return sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
};

const getTypeColor = (type?: string | null) => {
  switch (type) {
    case 'Write': return 'var(--accent-primary)';
    case 'Read': return '#fbbf24'; // Amber
    case 'Response': return '#10b981'; // Emerald
    default: return 'var(--text-dim)';
  }
};

const getDPTColor = (dpt_main: number | null) => {
  if (dpt_main === 1) return 'var(--dpt-1)';
  if (dpt_main === 5) return 'var(--dpt-5)';
  if (dpt_main === 9) return 'var(--dpt-9)';
  return 'var(--dpt-unknown)';
};

// UI-specific extension of the Telegram type
interface LogTelegram extends Telegram {
  deltaStr?: string | null;
}

export const TelegramLog: React.FC<TelegramLogProps> = ({ telegrams, isConnected, onClear }) => {
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'timestamp', direction: 'desc' });
  const [visibleColumns, setVisibleColumns] = useState({
    time: true,
    delta: true,
    source: true,
    sourceName: true,
    target: true,
    targetName: true,
    type: true,
    dpt: true,
    data: true,
    value: true
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);

  // Detect if user is at the bottom
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isAtBottom.current = scrollHeight - scrollTop - clientHeight < 30;
  };

  // Improved Auto-scroll logic
  useEffect(() => {
    if (
      isAtBottom.current && 
      sortConfig.key === 'timestamp' && 
      sortConfig.direction === 'asc'
    ) {
      scrollAnchorRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [telegrams, sortConfig]);

  const handleSort = (key: SortKey) => {
    setSortConfig((prev) => ({
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
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      if (sortConfig.key === 'timestamp') {
        const timeA = new Date(aVal as string).getTime();
        const timeB = new Date(bVal as string).getTime();
        return sortConfig.direction === 'asc' 
          ? timeA - timeB
          : timeB - timeA;
      }

      const valA = (aVal as string | number);
      const valB = (bVal as string | number);

      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    // Calculate time deltas relative to visually previous row
    const logItems: LogTelegram[] = items.map((t, idx) => {
      let deltaStr = null;
      if (idx > 0) {
        const current = new Date(t.timestamp).getTime();
        const prev = new Date(items[idx - 1].timestamp).getTime();
        const diffMs = Math.abs(current - prev);
        
        // Format as + SS.mmm or + MM:SS.mmm
        const date = new Date(diffMs);
        const mm = String(date.getUTCMinutes()).padStart(2, '0');
        const ss = String(date.getUTCSeconds()).padStart(2, '0');
        const mmm = String(date.getUTCMilliseconds()).padStart(3, '0');
        deltaStr = `+ ${mm}:${ss}.${mmm}`;
      }
      return { ...t, deltaStr };
    });

    return logItems;
  }, [telegrams, sortConfig]);

  const toggleColumn = (col: keyof typeof visibleColumns) => {
    setVisibleColumns(prev => ({ ...prev, [col]: !prev[col] }));
  };

  return (
    <div className="glass" style={{ height: 'calc(100vh - 4rem)', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <header style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Terminal size={20} className="accent-primary" />
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Group Monitor</h2>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div className={isConnected ? 'active-dot' : 'inactive-dot'} />
            <span style={{ fontSize: '0.875rem', color: 'var(--text-dim)' }}>
              {isConnected ? 'Connected' : 'Offline'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', borderLeft: '1px solid var(--border-color)', paddingLeft: '1rem' }}>
             <button className="icon-button" onClick={onClear} title="Clear log">
              <Trash2 size={18} />
            </button>
            <button 
              className="icon-button"
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              style={{ color: isSettingsOpen ? 'var(--accent-primary)' : 'var(--text-dim)' }}
            >
              <Settings size={18} />
            </button>
          </div>
        </div>
      </header>

      {isSettingsOpen && (
        <div className="glass settings-dropdown">
          <h3 style={{ fontSize: '0.65rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>
            Toggle Columns
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {(Object.keys(visibleColumns) as Array<keyof typeof visibleColumns>).map((col) => (
              <button key={col} className="setting-item" onClick={() => toggleColumn(col)}>
                <div className={`checkbox ${visibleColumns[col] ? 'checked' : ''}`}>
                  {visibleColumns[col] && <Check size={10} />}
                </div>
                <span style={{ fontSize: '0.75rem' }}>
                  {col === 'dpt' ? 'DPT' : col.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase())}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      
      <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-panel)', zIndex: 10, backdropFilter: 'blur(8px)' }}>
            <tr style={{ textAlign: 'left', color: 'var(--text-dim)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <th style={{ padding: '0.75rem 1rem', width: '130px' }}><button className="sort-header" onClick={() => handleSort('timestamp')}>Time <SortIcon column="timestamp" sortConfig={sortConfig} /></button></th>
              <th style={{ padding: '0.75rem 1rem', width: '200px' }}><button className="sort-header" onClick={() => handleSort('source_address')}>Source <SortIcon column="source_address" sortConfig={sortConfig} /></button></th>
              <th style={{ padding: '0.75rem 1rem', width: '240px' }}><button className="sort-header" onClick={() => handleSort('target_address')}>Target <SortIcon column="target_address" sortConfig={sortConfig} /></button></th>
              {visibleColumns.type && <th style={{ padding: '0.75rem 1rem', width: '110px' }}><button className="sort-header" onClick={() => handleSort('simplified_type')}>Type <SortIcon column="simplified_type" sortConfig={sortConfig} /></button></th>}
              {visibleColumns.dpt && <th style={{ padding: '0.75rem 1rem', width: '140px' }}><button className="sort-header" onClick={() => handleSort('dpt_name')}>DPT <SortIcon column="dpt_name" sortConfig={sortConfig} /></button></th>}
              {visibleColumns.data && <th style={{ padding: '0.75rem 1rem', width: '160px' }}>Data</th>}
              <th style={{ padding: '0.75rem 1rem', minWidth: '180px' }}><button className="sort-header" onClick={() => handleSort('value_numeric')}>Value <SortIcon column="value_numeric" sortConfig={sortConfig} /></button></th>
            </tr>
          </thead>
          <tbody>
            {sortedTelegrams.length === 0 ? (
              <tr><td colSpan={20} style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.875rem' }}>Waiting for traffic...</td></tr>
            ) : sortedTelegrams.map((t, idx) => (
              <tr key={`${t.timestamp}-${idx}`} className="log-row" style={{ borderBottom: '1px solid var(--border-color)', fontSize: '0.8125rem' }}>
                {/* Time Cell */}
                <td style={{ padding: '0.75rem 1rem' }}>
                  <div className="mono-addr" style={{ color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums' }}>{format(new Date(t.timestamp), 'HH:mm:ss.SS')}</div>
                  {visibleColumns.delta && t.deltaStr && <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '0.1rem' }}>{t.deltaStr}</div>}
                </td>
                
                {/* Source Cell */}
                <td style={{ padding: '0.75rem 1rem' }}>
                  <div className="mono-addr highlight">{t.source_address}</div>
                  {visibleColumns.sourceName && <div className="subtitle-name">{t.source_name || '-'}</div>}
                </td>
                
                {/* Target Cell */}
                <td style={{ padding: '0.75rem 1rem' }}>
                  <div className="mono-addr highlight-target">{t.target_address}</div>
                  {visibleColumns.targetName && <div className="subtitle-name" style={{ fontWeight: 500, color: 'var(--text-main)' }}>{t.target_name || '-'}</div>}
                </td>

                {/* Type Cell */}
                {visibleColumns.type && (
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <div style={{ color: getTypeColor(t.simplified_type), fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                      {t.simplified_type || t.telegram_type}
                    </div>
                    <div style={{ fontSize: '0.65rem', color: '#10b981', marginTop: '0.1rem', opacity: 0.8 }}>Incoming</div>
                  </td>
                )}

                {/* DPT Cell */}
                {visibleColumns.dpt && (
                  <td style={{ padding: '0.75rem 1rem' }}>
                    {t.dpt_name ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: getDPTColor(t.dpt_main) }} />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{t.dpt_name}</span>
                      </div>
                    ) : '-'}
                  </td>
                )}

                {/* Data Cell */}
                {visibleColumns.data && (
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <div className="raw-badge" style={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
                      {t.raw_hex || '0'}
                    </div>
                  </td>
                )}

                {/* Value Cell */}
                <td style={{ padding: '0.75rem 1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontSize: '0.9375rem', wordBreak: 'break-word', whiteSpace: 'normal' }}>
                      {t.value_formatted || (t.value_numeric !== null ? t.value_numeric.toFixed(2) : '-')}
                    </span>
                    {t.unit && <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontWeight: 500 }}>{t.unit}</span>}
                  </div>
                </td>
              </tr>
            ))}
            <div ref={scrollAnchorRef} />
          </tbody>
        </table>
      </div>
      
      <style>{`
        .active-dot { width: 8px; height: 8px; background: var(--success); border-radius: 50%; box-shadow: 0 0 8px var(--success); }
        .inactive-dot { width: 8px; height: 8px; background: var(--error); border-radius: 50%; }
        .icon-button { background: transparent; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; padding: 0.35rem; color: var(--text-dim); }
        .icon-button:hover { color: var(--text-main) !important; transform: scale(1.1); background: rgba(255, 255, 255, 0.05); border-radius: 4px; }
        .icon-button:hover svg { stroke: var(--error); }
        
        .settings-dropdown {
          position: absolute;
          top: 3.5rem;
          right: 1.25rem;
          width: 180px;
          padding: 1rem;
          z-index: 100;
          animation: slide-up 0.2s ease-out;
        }
        
        .setting-item {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          background: transparent;
          border: none;
          color: var(--text-main);
          cursor: pointer;
          width: 100%;
          padding: 0.35rem 0;
          text-align: left;
        }
        
        .checkbox { width: 14px; height: 14px; border-radius: 3px; border: 1.5px solid var(--border-color); display: flex; align-items: center; justify-content: center; }
        .checkbox.checked { background: var(--accent-primary); border-color: var(--accent-primary); }
        
        .sort-header { background: transparent; border: none; color: inherit; text-transform: inherit; letter-spacing: inherit; font-size: inherit; font-weight: inherit; cursor: pointer; display: flex; align-items: center; gap: 0.25rem; padding: 0; }
        .mono-addr { font-family: 'JetBrains Mono', monospace; font-size: 0.8125rem; }
        .highlight { color: var(--text-dim); }
        .highlight-target { color: var(--accent-primary); font-weight: 500; }
        .subtitle-name { font-size: 0.7rem; color: var(--text-dim); margin-top: 0.15rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        
        .raw-badge {
          background: rgba(255, 255, 255, 0.05);
          padding: 0.15rem 0.4rem;
          border-radius: 3px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.65rem;
          color: var(--text-dim);
          display: inline-block;
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        
        .log-row:hover { background: rgba(255, 255, 255, 0.015); }
        @keyframes slide-up { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
};
