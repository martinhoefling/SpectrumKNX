import React, { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronRight, SlidersHorizontal, X, Clock } from 'lucide-react';

// ─── Shared types ────────────────────────────────────────────────────────────

export interface FilterOption {
  address?: string;
  name?: string;
  main?: number;
  sub?: number;
  label?: string;
  // For static-list items (types):
  value?: string;
}

export interface FilterOptions {
  sources: FilterOption[];
  targets: FilterOption[];
  types: string[];
  dpts: FilterOption[];
}

export interface ActiveFilters {
  sources: string[];       // source_address values
  targets: string[];       // target_address values
  types: string[];         // simplified_type values (Write/Read/Response)
  dpts: number[];          // dpt_main numbers
  /** ms before a matching telegram to also include (0 = disabled) */
  deltaBeforeMs: number;
  /** ms after a matching telegram to also include (0 = disabled) */
  deltaAfterMs: number;
}

export const DEFAULT_FILTERS: ActiveFilters = {
  sources: [],
  targets: [],
  types: [],
  dpts: [],
  deltaBeforeMs: 0,
  deltaAfterMs: 0,
};

export function hasActiveFilters(f: ActiveFilters): boolean {
  return (
    f.sources.length > 0 ||
    f.targets.length > 0 ||
    f.types.length > 0 ||
    f.dpts.length > 0
  );
}

// ─── FilterPanel component ────────────────────────────────────────────────────

interface FilterPanelProps {
  options: FilterOptions;
  activeFilters: ActiveFilters;
  onFiltersChange: (f: ActiveFilters) => void;
  /** Live-only: count of telegrams that would match each option in isolation */
  counts?: FilterCounts;
  mode: 'live' | 'history';
}

export interface FilterCounts {
  sources: Record<string, number>;
  targets: Record<string, number>;
  types: Record<string, number>;
  dpts: Record<number, number>;
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const Section: React.FC<SectionProps> = ({ title, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid var(--border-color)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.65rem 1rem', background: 'transparent', border: 'none',
          color: 'var(--text-main)', fontWeight: 600, fontSize: '0.8125rem',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        {title}
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && <div style={{ padding: '0 0.75rem 0.75rem' }}>{children}</div>}
    </div>
  );
};

interface OptionRowProps {
  label: string;
  sublabel?: string;
  checked: boolean;
  count?: number;
  onToggle: () => void;
}

export const OptionRow: React.FC<OptionRowProps> = ({ label, sublabel, checked, count, onToggle }) => (
  <label style={{
    display: 'flex', alignItems: 'center', gap: '0.6rem',
    padding: '0.35rem 0.25rem', cursor: 'pointer', borderRadius: '6px',
    transition: 'background 0.15s',
  }}
    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
  >
    {/* Custom checkbox */}
    <div
      onClick={onToggle}
      style={{
        width: 14, height: 14, flexShrink: 0, borderRadius: 3,
        border: `1.5px solid ${checked ? 'var(--accent-primary)' : 'var(--border-color)'}`,
        background: checked ? 'var(--accent-primary)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s',
      }}
    >
      {checked && (
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>

    {/* Label */}
    <div style={{ flex: 1, minWidth: 0 }} onClick={onToggle}>
      <div style={{
        fontSize: '0.8125rem', color: 'var(--text-main)', fontFamily: "'JetBrains Mono', monospace",
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{label}</div>
      {sublabel && (
        <div style={{
          fontSize: '0.65rem', color: 'var(--text-dim)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{sublabel}</div>
      )}
    </div>

    {/* Count bubble */}
    {count !== undefined && (
      <span style={{
        fontSize: '0.65rem', fontWeight: 600, minWidth: '1.8rem', textAlign: 'center',
        padding: '0.1rem 0.4rem', borderRadius: '999px',
        background: count > 0 ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.05)',
        color: count > 0 ? 'var(--accent-primary)' : 'var(--text-dim)',
        border: count > 0 ? '1px solid rgba(99,102,241,0.3)' : '1px solid var(--border-color)',
      }}>
        {count}
      </span>
    )}
  </label>
);

export const FilterPanel: React.FC<FilterPanelProps> = ({
  options,
  activeFilters,
  onFiltersChange,
  counts,
  mode,
}) => {
  const [search, setSearch] = useState('');

  const q = search.toLowerCase();

  const filteredSources = useMemo(() =>
    options.sources.filter(s =>
      !q || s.address?.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q)
    ), [options.sources, q]);

  const filteredTargets = useMemo(() =>
    options.targets.filter(s =>
      !q || s.address?.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q)
    ), [options.targets, q]);

  const filteredTypes = useMemo(() =>
    options.types.filter(t => !q || t.toLowerCase().includes(q)), [options.types, q]);

  const filteredDpts = useMemo(() =>
    options.dpts.filter(d =>
      !q || d.label?.toLowerCase().includes(q)
    ), [options.dpts, q]);

  const toggle = <T extends string | number>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter(v => v !== value) : [...list, value];

  const update = (patch: Partial<ActiveFilters>) =>
    onFiltersChange({ ...activeFilters, ...patch });

  const activeCount =
    activeFilters.sources.length +
    activeFilters.targets.length +
    activeFilters.types.length +
    activeFilters.dpts.length;

  return (
    <div style={{
      height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column',
      borderRight: '1px solid var(--border-color)',
    }}>
      {/* Header */}
      <div style={{
        padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <SlidersHorizontal size={15} style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontWeight: 700, fontSize: '0.875rem' }}>Filter</span>
          {activeCount > 0 && (
            <span style={{
              fontSize: '0.65rem', fontWeight: 700, padding: '0.1rem 0.45rem',
              borderRadius: '999px', background: 'var(--accent-primary)', color: 'white',
            }}>
              {activeCount}
            </span>
          )}
        </div>
        {activeCount > 0 && (
          <button
            onClick={() => onFiltersChange(DEFAULT_FILTERS)}
            title="Clear all filters"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-dim)', display: 'flex', alignItems: 'center',
              padding: '0.2rem', borderRadius: '4px', transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-main)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Search bar */}
      <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)',
          borderRadius: '7px', padding: '0.45rem 0.65rem',
          transition: 'border-color 0.2s',
        }}>
          <Search size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search options..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-main)', fontSize: '0.8125rem', width: '100%',
              fontFamily: 'inherit',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-dim)' }}
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable options */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* Source */}
        {filteredSources.length > 0 && (
          <Section title="Source" defaultOpen>
            {filteredSources.map(s => (
              <OptionRow
                key={s.address}
                label={s.address!}
                sublabel={s.name || undefined}
                checked={activeFilters.sources.includes(s.address!)}
                count={mode === 'live' ? (counts?.sources[s.address!] ?? 0) : undefined}
                onToggle={() => update({ sources: toggle(activeFilters.sources, s.address!) })}
              />
            ))}
          </Section>
        )}

        {/* Target */}
        {filteredTargets.length > 0 && (
          <Section title="Target" defaultOpen>
            {filteredTargets.map(s => (
              <OptionRow
                key={s.address}
                label={s.address!}
                sublabel={s.name || undefined}
                checked={activeFilters.targets.includes(s.address!)}
                count={mode === 'live' ? (counts?.targets[s.address!] ?? 0) : undefined}
                onToggle={() => update({ targets: toggle(activeFilters.targets, s.address!) })}
              />
            ))}
          </Section>
        )}

        {/* Type */}
        {filteredTypes.length > 0 && (
          <Section title="Type" defaultOpen>
            {filteredTypes.map(t => (
              <OptionRow
                key={t}
                label={t}
                checked={activeFilters.types.includes(t)}
                count={mode === 'live' ? (counts?.types[t] ?? 0) : undefined}
                onToggle={() => update({ types: toggle(activeFilters.types, t) })}
              />
            ))}
          </Section>
        )}

        {/* DPT */}
        {filteredDpts.length > 0 && (
          <Section title="DPT" defaultOpen={false}>
            {filteredDpts.map(d => (
              <OptionRow
                key={d.main}
                label={d.label!}
                checked={activeFilters.dpts.includes(d.main!)}
                count={mode === 'live' ? (counts?.dpts[d.main!] ?? 0) : undefined}
                onToggle={() => update({ dpts: toggle(activeFilters.dpts, d.main!) })}
              />
            ))}
          </Section>
        )}

        {/* Time-delta context window */}
        <Section title="Time-Delta Context" defaultOpen={false}>
          <div style={{ padding: '0.25rem 0' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
              Include telegrams within a window around any filter-matching telegram,
              even if they don't match the filter.
            </div>

            {/* −delta (before) */}
            <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem' }}>− Before (ms)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.65rem' }}>
              <Clock size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
              <input
                type="number"
                min={0}
                step={10}
                value={activeFilters.deltaBeforeMs || ''}
                placeholder="0 = off"
                onChange={e => update({ deltaBeforeMs: Math.max(0, Number(e.target.value)) })}
                style={{
                  flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)',
                  borderRadius: '6px', padding: '0.45rem 0.6rem', color: 'var(--text-main)',
                  fontSize: '0.8125rem', fontFamily: 'inherit', outline: 'none',
                }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', flexShrink: 0 }}>ms</span>
            </div>

            {/* +delta (after) */}
            <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem' }}>+ After (ms)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
              <input
                type="number"
                min={0}
                step={10}
                value={activeFilters.deltaAfterMs || ''}
                placeholder="0 = off"
                onChange={e => update({ deltaAfterMs: Math.max(0, Number(e.target.value)) })}
                style={{
                  flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)',
                  borderRadius: '6px', padding: '0.45rem 0.6rem', color: 'var(--text-main)',
                  fontSize: '0.8125rem', fontFamily: 'inherit', outline: 'none',
                }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', flexShrink: 0 }}>ms</span>
            </div>

            {(activeFilters.deltaBeforeMs > 0 || activeFilters.deltaAfterMs > 0) && (
              <div style={{ fontSize: '0.65rem', color: 'var(--accent-primary)', marginTop: '0.5rem' }}>
                {activeFilters.deltaBeforeMs > 0 && <span>−{activeFilters.deltaBeforeMs}ms </span>}
                {activeFilters.deltaAfterMs > 0 && <span>+{activeFilters.deltaAfterMs}ms </span>}
                context active
              </div>
            )}
          </div>
        </Section>

      </div>
    </div>
  );
};
