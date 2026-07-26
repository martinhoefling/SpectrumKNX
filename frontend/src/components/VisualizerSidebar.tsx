import React, { useMemo, useState } from 'react';
import { LineChart, X, Search } from 'lucide-react';
import type { Telegram } from '../hooks/useWebSocket';
import { OptionRow } from './FilterPanel';
import { RAW_DPT_OPTIONS } from '../utils/rawDpt';

interface TargetCount {
  address: string;
  name: string;
  count: number;
}

interface VisualizerSidebarProps {
  telegrams: Telegram[];
  selectedTargets: string[];
  onTargetsChange: (targets: string[]) => void;
  /** Selected GAs with no project DPT that need a manual datatype to plot (#315). */
  untypedTargets?: Set<string>;
  /** Chosen datatype key per address. */
  dptOverrides?: Record<string, string>;
  /** Assign (or clear, with '') the datatype for a GA. */
  onDptOverrideChange?: (address: string, key: string) => void;
}

export const VisualizerSidebar: React.FC<VisualizerSidebarProps> = ({
  telegrams, selectedTargets, onTargetsChange,
  untypedTargets, dptOverrides = {}, onDptOverrideChange,
}) => {
  const [search, setSearch] = useState('');

  // Extract unique targets and their counts from the currently plotted dataset
  const targetCounts = useMemo(() => {
    const map = new Map<string, TargetCount>();
    for (const t of telegrams) {
      if (!t.target_address) continue;
      if (!map.has(t.target_address)) {
        map.set(t.target_address, {
          address: t.target_address,
          name: t.target_name || 'Unknown Target',
          count: 0
        });
      }
      map.get(t.target_address)!.count++;
    }

    // Sort by count descending, then alphabetically
    return Array.from(map.values()).sort((a, b) => b.count - a.count || a.address.localeCompare(b.address));
  }, [telegrams]);

  const filteredTargets = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return targetCounts;
    return targetCounts.filter(t => t.address.toLowerCase().includes(q) || t.name.toLowerCase().includes(q));
  }, [targetCounts, search]);

  const toggle = (address: string) => {
    if (selectedTargets.includes(address)) {
      onTargetsChange(selectedTargets.filter(a => a !== address));
    } else {
      onTargetsChange([...selectedTargets, address]);
    }
  };

  return (
    <div style={{ width: 260, borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', background: 'var(--bg-inset)' }}>
      <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontWeight: 600, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <LineChart size={16} style={{ color: 'var(--accent-primary)' }} /> Targets
        </span>
        {/* Clears the checkmarks, like the filter panel's clear-all (#347). The
            panel itself is closed with the X in the chart-area header. */}
        <button
          onClick={() => onTargetsChange([])}
          disabled={selectedTargets.length === 0}
          className="icon-button"
          title="Clear all selected targets"
          style={{ padding: '0.2rem', opacity: selectedTargets.length === 0 ? 0.4 : 1 }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          background: 'var(--bg-tag)', border: '1px solid var(--border-color)',
          borderRadius: '7px', padding: '0.45rem 0.65rem'
        }}>
          <Search size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search targets..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-main)', fontSize: '0.8125rem', width: '100%',
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', padding: '0 0.25rem 0.75rem', lineHeight: 1.5 }}>
          Select targets from the currently active {telegrams.length.toLocaleString()} telegrams to plot their metrics over time.
        </div>

        {filteredTargets.map(t => {
          const selected = selectedTargets.includes(t.address);
          // Offer a datatype picker for a selected GA that has no project DPT,
          // so its raw payload can be decoded into a plottable value (#315).
          const needsDpt = selected && untypedTargets?.has(t.address) && onDptOverrideChange;
          return (
            <React.Fragment key={t.address}>
              <OptionRow
                label={t.address}
                sublabel={t.name}
                checked={selected}
                count={t.count}
                onToggle={() => toggle(t.address)}
              />
              {needsDpt && (
                <div style={{ padding: '0 0.25rem 0.5rem 1.75rem', marginTop: '-0.25rem' }}>
                  <select
                    value={dptOverrides[t.address] ?? ''}
                    onChange={e => onDptOverrideChange(t.address, e.target.value)}
                    title="This group address has no datatype in the project. Pick one to decode and plot its raw payload."
                    style={{
                      width: '100%', background: 'var(--bg-tag)', color: 'var(--text-main)',
                      border: '1px solid var(--border-color)', borderRadius: '6px',
                      padding: '0.35rem 0.5rem', fontSize: '0.75rem',
                    }}
                  >
                    <option value="">No datatype — pick to plot…</option>
                    {RAW_DPT_OPTIONS.map(o => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
