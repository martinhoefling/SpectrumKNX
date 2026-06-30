import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { X, RefreshCw, BarChart2, ChevronDown, ChevronRight } from 'lucide-react';
import { apiUrl } from '../utils/basePath';
import type { FilterOptions } from '../types/filters';

interface StatEntry {
  address: string;
  name: string;
  count: number;
  /** GA → contributing source PAs, or PA → destination GAs (desc by count). */
  children?: StatEntry[];
}

interface StatisticsData {
  total: number;
  by_ga: StatEntry[];
  by_pa: StatEntry[];
}

interface StatisticsOverlayProps {
  filterOptions: FilterOptions;
  onClose: () => void;
}

type TabId = 'ga' | 'pa' | 'hierarchy';
type SortKey = 'address' | 'count';

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ── Flat stat table ───────────────────────────────────────────────────────────

interface StatTableProps {
  entries: StatEntry[];
  total: number;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  searchQuery: string;
  /** Kind of the top-level rows; children are the opposite dimension. */
  entryKind: 'ga' | 'pa';
}

const StatTable: React.FC<StatTableProps> = ({ entries, total, sortKey, sortDir, onSort, searchQuery, entryKind }) => {
  const q = searchQuery.toLowerCase();
  const matches = useCallback(
    (e: StatEntry) => e.address.toLowerCase().includes(q) || e.name.toLowerCase().includes(q),
    [q],
  );
  const visible = useMemo(
    () => !q ? entries : entries.filter(e => matches(e) || (e.children?.some(matches) ?? false)),
    [entries, q, matches],
  );
  const maxCount = useMemo(() => Math.max(1, ...entries.map(e => e.count)), [entries]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = useCallback((addr: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(addr)) next.delete(addr); else next.add(addr);
      return next;
    });
  }, []);

  const childTitle = entryKind === 'ga'
    ? 'Show contributing devices (sources)'
    : 'Show destination group addresses';

  const renderSortArrow = (k: SortKey) =>
    sortKey === k ? <span style={{ color: 'var(--accent-primary)', marginLeft: 2 }}>{sortDir === 'desc' ? '↓' : '↑'}</span> : null;

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-dark)', zIndex: 1 }}>
          <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
            <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
              onClick={() => onSort('address')}>
              Address {renderSortArrow('address')}
            </th>
            <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 600 }}>
              Name
            </th>
            <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: 'var(--text-dim)', fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
              onClick={() => onSort('count')}>
              Count {renderSortArrow('count')}
            </th>
            <th style={{ padding: '0.5rem 0.75rem', color: 'var(--text-dim)', fontWeight: 600, width: '30%' }}>Share</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(e => {
            const pct = total > 0 ? (e.count / total) * 100 : 0;
            const barPct = (e.count / maxCount) * 100;
            const children = e.children ?? [];
            const hasChildren = children.length > 0;
            const isOpen = expanded.has(e.address);
            return (
              <React.Fragment key={e.address}>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', cursor: hasChildren ? 'pointer' : 'default' }}
                  onClick={() => hasChildren && toggle(e.address)}
                  onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}>
                  <td style={{ padding: '0.4rem 0.75rem', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                      <span style={{ width: 12, display: 'inline-flex', color: 'var(--text-dim)' }} title={hasChildren ? childTitle : undefined}>
                        {hasChildren ? (isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
                      </span>
                      {e.address}
                    </span>
                  </td>
                  <td style={{ padding: '0.4rem 0.75rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                    {e.name}
                  </td>
                  <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-main)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {formatCount(e.count)}
                    <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: '0.7rem', marginLeft: '0.3rem' }}>
                      {pct.toFixed(1)}%
                    </span>
                  </td>
                  <td style={{ padding: '0.4rem 0.75rem' }}>
                    <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-tag)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${barPct}%`, borderRadius: 3, background: 'var(--accent-primary)', transition: 'width 0.3s' }} />
                    </div>
                  </td>
                </tr>
                {isOpen && children.map(c => {
                  // Child share is relative to its parent's traffic.
                  const cPct = e.count > 0 ? (c.count / e.count) * 100 : 0;
                  return (
                    <tr key={`${e.address}>${c.address}`} style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-inset)' }}>
                      <td style={{ padding: '0.3rem 0.75rem 0.3rem 2.1rem', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                        {c.address}
                      </td>
                      <td style={{ padding: '0.3rem 0.75rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200, fontSize: '0.75rem' }}>
                        {c.name}
                      </td>
                      <td style={{ padding: '0.3rem 0.75rem', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                        {formatCount(c.count)}
                        <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: '0.7rem', marginLeft: '0.3rem' }}>
                          {cPct.toFixed(1)}%
                        </span>
                      </td>
                      <td style={{ padding: '0.3rem 0.75rem' }}>
                        <div style={{ height: 5, borderRadius: 3, background: 'var(--bg-tag)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${cPct}%`, borderRadius: 3, background: 'var(--text-dim)' }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {visible.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '3rem', fontSize: '0.85rem' }}>
          No results
        </div>
      )}
    </div>
  );
};

// ── GA Hierarchy tree ─────────────────────────────────────────────────────────

interface HierarchyNode {
  key: string;
  label: string;
  count: number;
  children: HierarchyNode[];
}

function buildHierarchy(entries: StatEntry[], groupNames: Record<string, string>): HierarchyNode[] {
  const l1Map = new Map<string, Map<string, StatEntry[]>>();
  for (const e of entries) {
    const parts = e.address.split('/');
    const l1 = parts[0];
    const l2 = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : l1;
    if (!l1Map.has(l1)) l1Map.set(l1, new Map());
    const inner = l1Map.get(l1)!;
    if (!inner.has(l2)) inner.set(l2, []);
    inner.get(l2)!.push(e);
  }

  const result: HierarchyNode[] = [];
  for (const [l1Key, l2Map] of l1Map.entries()) {
    const l1Name = groupNames[l1Key] || '';
    const l1Label = l1Name ? `${l1Key} — ${l1Name}` : l1Key;
    const l1Count = [...l2Map.values()].flat().reduce((s, e) => s + e.count, 0);

    const children: HierarchyNode[] = [];
    for (const [l2Key, leaves] of l2Map.entries()) {
      const l2Name = groupNames[l2Key] || '';
      const l2Label = l2Name ? `${l2Key} — ${l2Name}` : l2Key;
      const l2Count = leaves.reduce((s, e) => s + e.count, 0);

      const singleGroup = l2Map.size === 1 && l2Key === l1Key;
      if (singleGroup) {
        // Flat: leaves directly under l1
        for (const leaf of leaves) {
          children.push({ key: leaf.address, label: leaf.name ? `${leaf.address} — ${leaf.name}` : leaf.address, count: leaf.count, children: [] });
        }
      } else {
        children.push({
          key: l2Key,
          label: l2Label,
          count: l2Count,
          children: leaves.map(leaf => ({
            key: leaf.address,
            label: leaf.name ? `${leaf.address} — ${leaf.name}` : leaf.address,
            count: leaf.count,
            children: [],
          })),
        });
      }
    }

    result.push({ key: l1Key, label: l1Label, count: l1Count, children });
  }

  return result.sort((a, b) => b.count - a.count);
}

interface HierarchyRowProps {
  node: HierarchyNode;
  maxCount: number;
  total: number;
  depth: number;
  searchQuery: string;
}

const HierarchyRow: React.FC<HierarchyRowProps> = ({ node, maxCount, total, depth, searchQuery }) => {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  const q = searchQuery.toLowerCase();
  const matchesSelf = !q || node.key.toLowerCase().includes(q) || node.label.toLowerCase().includes(q);
  const matchesAny = matchesSelf || node.children.some(c =>
    c.key.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)
  );
  if (!matchesAny) return null;

  const pct = total > 0 ? (node.count / total) * 100 : 0;
  const barPct = maxCount > 0 ? (node.count / maxCount) * 100 : 0;
  const isLeaf = !hasChildren;

  return (
    <div>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.75rem', paddingLeft: `${0.75 + depth * 1.25}rem`, cursor: hasChildren ? 'pointer' : 'default' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        onClick={() => hasChildren && setOpen(o => !o)}
      >
        <span style={{ width: 12, flexShrink: 0, color: 'var(--text-dim)' }}>
          {hasChildren ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
        </span>
        <span style={{
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontSize: isLeaf ? '0.8rem' : '0.825rem',
          fontWeight: isLeaf ? 400 : 600,
          color: isLeaf ? 'var(--text-dim)' : 'var(--text-main)',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {node.label}
        </span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: 'var(--text-main)', fontWeight: 600, marginLeft: '0.5rem', flexShrink: 0 }}>
          {formatCount(node.count)}
        </span>
        <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem', width: '3rem', textAlign: 'right', flexShrink: 0 }}>
          {pct.toFixed(1)}%
        </span>
        <div style={{ width: 60, height: 6, borderRadius: 3, background: 'var(--bg-tag)', overflow: 'hidden', flexShrink: 0, marginLeft: '0.5rem' }}>
          <div style={{ height: '100%', width: `${barPct}%`, borderRadius: 3, background: 'var(--accent-primary)' }} />
        </div>
      </div>
      {open && hasChildren && node.children.map(child => (
        <HierarchyRow key={child.key} node={child} maxCount={maxCount} total={total} depth={depth + 1} searchQuery={searchQuery} />
      ))}
    </div>
  );
};

// ── Main overlay ──────────────────────────────────────────────────────────────

export const StatisticsOverlay: React.FC<StatisticsOverlayProps> = ({ filterOptions, onClose }) => {
  const [tab, setTab] = useState<TabId>('ga');
  const [data, setData] = useState<StatisticsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('count');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [timeAgo, setTimeAgo] = useState<string | null>(null);

  const fetchStats = useCallback(() => {
    setIsLoading(true);
    fetch(apiUrl('/api/statistics'))
      .then(r => r.json())
      .then((d: StatisticsData) => {
        setData(d);
        setLastFetchedAt(new Date());
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    if (!lastFetchedAt) return;
    const update = () => {
      const diffSecs = Math.round((Date.now() - lastFetchedAt.getTime()) / 1000);
      setTimeAgo(`${diffSecs}s ago`);
    };
    const timeout = setTimeout(update, 0);
    const interval = setInterval(update, 1000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [lastFetchedAt]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sortedGa = useMemo(() => {
    if (!data) return [];
    return [...data.by_ga].sort((a, b) => {
      const v = sortKey === 'count' ? b.count - a.count : a.address.localeCompare(b.address);
      return sortDir === 'desc' ? v : -v;
    });
  }, [data, sortKey, sortDir]);

  const sortedPa = useMemo(() => {
    if (!data) return [];
    return [...data.by_pa].sort((a, b) => {
      const v = sortKey === 'count' ? b.count - a.count : a.address.localeCompare(b.address);
      return sortDir === 'desc' ? v : -v;
    });
  }, [data, sortKey, sortDir]);

  const hierarchy = useMemo(() => {
    if (!data) return [];
    return buildHierarchy(data.by_ga, filterOptions.ga_group_names);
  }, [data, filterOptions.ga_group_names]);

  const hierarchyMaxCount = hierarchy[0]?.count ?? 1;

  const tabs: { id: TabId; label: string }[] = [
    { id: 'ga', label: 'Group Addresses' },
    { id: 'pa', label: 'Physical Addresses' },
    { id: 'hierarchy', label: 'GA Hierarchy' },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)',
        flexShrink: 0, background: 'var(--bg-subtle)',
      }}>
        <BarChart2 size={16} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>Traffic Statistics</span>
        {data && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', background: 'var(--bg-tag)', padding: '0.15rem 0.5rem', borderRadius: '999px', border: '1px solid var(--border-color)' }}>
            {formatCount(data.total)} total
          </span>
        )}
        {timeAgo && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginLeft: 'auto' }}>
            Updated {timeAgo}
          </span>
        )}
        <button
          onClick={fetchStats}
          disabled={isLoading}
          title="Refresh"
          style={{ background: 'transparent', border: 'none', cursor: isLoading ? 'not-allowed' : 'pointer', color: 'var(--text-dim)', padding: '0.2rem', display: 'flex', marginLeft: timeAgo ? undefined : 'auto' }}
        >
          <RefreshCw size={14} style={isLoading ? { animation: 'spin 1s linear infinite' } : undefined} />
        </button>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: '0.2rem', display: 'flex' }}>
          <X size={16} />
        </button>
      </div>

      {/* Tab bar + search */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-color)', flexShrink: 0, gap: '0.25rem', padding: '0 0.5rem' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: '0.5rem 0.75rem',
            fontSize: '0.8rem', fontWeight: tab === t.id ? 600 : 400,
            color: tab === t.id ? 'var(--accent-primary)' : 'var(--text-dim)',
            borderBottom: tab === t.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
            transition: 'all 0.15s', whiteSpace: 'nowrap',
          }}>
            {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Filter…"
          className="glass-input"
          style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem', borderRadius: 6, width: 160, margin: '0.25rem 0' }}
        />
      </div>

      {/* Content */}
      {isLoading && !data ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
          Loading…
        </div>
      ) : !data ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
          No data
        </div>
      ) : tab === 'ga' ? (
        <StatTable key="ga" entries={sortedGa} total={data.total} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} searchQuery={searchQuery} entryKind="ga" />
      ) : tab === 'pa' ? (
        <StatTable key="pa" entries={sortedPa} total={data.total} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} searchQuery={searchQuery} entryKind="pa" />
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.25rem 0' }}>
          {hierarchy.map(node => (
            <HierarchyRow key={node.key} node={node} maxCount={hierarchyMaxCount} total={data.total} depth={0} searchQuery={searchQuery} />
          ))}
          {hierarchy.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '3rem', fontSize: '0.85rem' }}>No data</div>
          )}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
