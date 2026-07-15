import React, { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronRight, SlidersHorizontal, X, Clock, FolderInput, AlertTriangle } from 'lucide-react';
import {
  type FilterOptions,
  type ActiveFilters,
  type FilterCounts,
  DEFAULT_FILTERS,
  DIRECTIONS,
  dptKey
} from '../types/filters';
import { compareKnxAddress } from '../utils/knxAddress';
import { KnxAddressTree } from './KnxAddressTree';

// ─── FilterPanel component ────────────────────────────────────────────────────

interface FilterPanelProps {
  options: FilterOptions;
  activeFilters: ActiveFilters;
  onFiltersChange: (f: ActiveFilters) => void;
  /** Live-only: count of telegrams that would match each option in isolation */
  counts?: FilterCounts;
  mode: 'live' | 'history';
  onQuickLastSeen?: (address: string, mode: 'ga' | 'pa') => void;
  /**
   * Whether an ETS project is loaded. Source/target/DPT options are derived from
   * the project, so when it's absent (e.g. Home Assistant companion mode without
   * an uploaded project) filtering by them is unavailable. `undefined` means the
   * status isn't known yet, in which case no notice is shown.
   */
  projectLoaded?: boolean;
  /** Opens the project upload flow (Settings). Enables the notice's CTA button. */
  onUploadProject?: () => void;
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
  onRemove?: () => void;
}

export const OptionRow: React.FC<OptionRowProps> = ({ label, sublabel, checked, count, onToggle, onRemove }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: '0.4rem',
    borderRadius: '6px', transition: 'background 0.15s',
    paddingRight: '0.25rem'
  }}
    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
  >
    <label
      onClick={(e) => { e.preventDefault(); onToggle(); }}
      style={{
      display: 'flex', alignItems: 'center', gap: '0.6rem',
      padding: '0.35rem 0.25rem', cursor: 'pointer', flex: 1, minWidth: 0,
      userSelect: 'none'
    }}>
      {/* Custom checkbox */}
      <div
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          title={label}
          style={{
            fontSize: '0.8125rem', color: 'var(--text-main)', fontFamily: "'JetBrains Mono', monospace",
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{label}</div>
        {sublabel && (
          <div
            title={sublabel}
            style={{
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
          background: count > 0 ? 'rgba(99,102,241,0.15)' : 'var(--bg-tag)',
          color: count > 0 ? 'var(--accent-primary)' : 'var(--text-dim)',
          border: count > 0 ? '1px solid rgba(99,102,241,0.3)' : '1px solid var(--border-color)',
        }}>
          {count}
        </span>
      )}
    </label>

    {onRemove && (
      <button
        onClick={onRemove}
        title="Remove filter"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text-dim)', padding: '0.2rem', borderRadius: '4px',
          display: 'flex', alignItems: 'center', transition: 'all 0.2s'
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
      >
        <X size={14} />
      </button>
    )}
  </div>
);

export const FilterPanel: React.FC<FilterPanelProps> = ({
  options,
  activeFilters,
  onFiltersChange,
  counts,
  mode,
  onQuickLastSeen,
  projectLoaded,
  onUploadProject,
}) => {
  const [search, setSearch] = useState('');

  // Source/target/DPT options come from the ETS project. Without one, those
  // filters are empty and searching them turns up nothing — surface why.
  const showNoProjectNotice = projectLoaded === false;

  const q = search.toLowerCase();

  const filteredSources = useMemo(() =>
    options.sources
      .filter(s => !q || s.address?.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q))
      .sort((a, b) => compareKnxAddress(a.address ?? '', b.address ?? '')),
    [options.sources, q]);

  const filteredTargets = useMemo(() =>
    options.targets
      .filter(s => !q || s.address?.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q))
      .sort((a, b) => compareKnxAddress(a.address ?? '', b.address ?? '')),
    [options.targets, q]);

  const filteredTypes = useMemo(() =>
    options.types.filter(t => !q || t.toLowerCase().includes(q)), [options.types, q]);

  const filteredDirections = useMemo(() =>
    DIRECTIONS.filter(d => !q || d.toLowerCase().includes(q)), [q]);

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
    activeFilters.directions.length +
    activeFilters.dpts.length;

  return (
    <div style={{
      height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column',
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

      {/* Active filters */}
      {activeCount > 0 && (
        <div style={{
          padding: '0.5rem 0.75rem',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-subtle)',
          flexShrink: 0,
          overflowY: 'auto',
          maxHeight: '40%',
        }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem', paddingLeft: '0.25rem' }}>Active Filters</div>
          {activeFilters.sources.map(s => {
            const name = options.sources.find(opt => opt.address === s)?.name;
            return (
              <OptionRow
                key={`active-s-${s}`}
                label={s}
                sublabel={name || undefined}
                checked={true}
                count={mode === 'live' ? (counts?.sources[s] ?? 0) : undefined}
                onToggle={() => update({ sources: activeFilters.sources.filter(v => v !== s) })}
                onRemove={() => update({ sources: activeFilters.sources.filter(v => v !== s) })}
              />
            );
          })}
          {activeFilters.sources.length > 0 && activeFilters.targets.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.2rem 0.25rem' }}>
              {(['AND', 'OR'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => update({ sourceTargetRelation: m })}
                  style={{
                    padding: '0.1rem 0.45rem', borderRadius: '4px', fontSize: '0.65rem',
                    fontWeight: 600, cursor: 'pointer', border: '1px solid',
                    borderColor: activeFilters.sourceTargetRelation === m ? 'var(--accent-primary)' : 'var(--border-color)',
                    background: activeFilters.sourceTargetRelation === m ? 'rgba(99,102,241,0.15)' : 'transparent',
                    color: activeFilters.sourceTargetRelation === m ? 'var(--accent-primary)' : 'var(--text-dim)',
                  }}
                >{m}</button>
              ))}
            </div>
          )}
          {activeFilters.targets.map(t => {
            const name = options.targets.find(opt => opt.address === t)?.name;
            return (
              <OptionRow
                key={`active-t-${t}`}
                label={t}
                sublabel={name || undefined}
                checked={true}
                count={mode === 'live' ? (counts?.targets[t] ?? 0) : undefined}
                onToggle={() => update({ targets: activeFilters.targets.filter(v => v !== t) })}
                onRemove={() => update({ targets: activeFilters.targets.filter(v => v !== t) })}
              />
            );
          })}
          {activeFilters.types.map(t => (
            <OptionRow
              key={`active-type-${t}`}
              label={t}
              checked={true}
              count={mode === 'live' ? (counts?.types[t] ?? 0) : undefined}
              onToggle={() => update({ types: activeFilters.types.filter(v => v !== t) })}
              onRemove={() => update({ types: activeFilters.types.filter(v => v !== t) })}
            />
          ))}
          {activeFilters.directions.map(d => (
            <OptionRow
              key={`active-dir-${d}`}
              label={d}
              checked={true}
              count={mode === 'live' ? (counts?.directions[d] ?? 0) : undefined}
              onToggle={() => update({ directions: activeFilters.directions.filter(v => v !== d) })}
              onRemove={() => update({ directions: activeFilters.directions.filter(v => v !== d) })}
            />
          ))}
          {activeFilters.dpts.map(d => {
            const label = options.dpts.find(opt => dptKey(opt.main!, opt.sub) === d)?.label;
            return (
              <OptionRow
                key={`active-dpt-${d}`}
                label={label || `DPT ${d}`}
                checked={true}
                count={mode === 'live' ? (counts?.dpts[d] ?? 0) : undefined}
                onToggle={() => update({ dpts: activeFilters.dpts.filter(v => v !== d) })}
                onRemove={() => update({ dpts: activeFilters.dpts.filter(v => v !== d) })}
              />
            );
          })}
        </div>
      )}

      {/* Search bar */}
      <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          background: 'var(--bg-tag)', border: '1px solid var(--border-color)',
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

        {/* No-project notice — source/target/DPT filters need an ETS project */}
        {showNoProjectNotice && (
          <div style={{
            margin: '0.75rem', padding: '0.85rem',
            border: '1px solid var(--border-color)', borderRadius: '8px',
            background: 'var(--bg-subtle)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
              <AlertTriangle size={14} style={{ color: 'var(--warning, #f59e0b)', flexShrink: 0 }} />
              <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-main)' }}>
                No ETS project loaded
              </span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: onUploadProject ? '0.7rem' : 0 }}>
              Filtering by source, target and DPT needs the group and device names
              from your ETS project. Upload a <code>.knxproj</code> file to enable it.
            </div>
            {onUploadProject && (
              <button
                onClick={onUploadProject}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  width: '100%', justifyContent: 'center',
                  padding: '0.5rem 0.65rem', borderRadius: '6px', cursor: 'pointer',
                  border: '1px solid var(--accent-primary)',
                  background: 'rgba(99,102,241,0.12)', color: 'var(--accent-primary)',
                  fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
                }}
              >
                <FolderInput size={14} />
                Upload ETS project
              </button>
            )}
          </div>
        )}

        {/* Source */}
        {filteredSources.length > 0 && (
          <Section title="Source" defaultOpen>
            <KnxAddressTree
              entries={filteredSources}
              selected={activeFilters.sources}
              groupNames={options.pa_line_names ?? {}}
              separator="."
              onToggle={addresses => update({ sources: addresses })}
              counts={counts?.sources}
              mode={mode}
              searchQuery={q}
              onLastSeen={onQuickLastSeen ? addr => onQuickLastSeen(addr, 'pa') : undefined}
            />
          </Section>
        )}

        {/* AND / OR relation toggle — shown only when both sides have active selections */}
        {activeFilters.sources.length > 0 && activeFilters.targets.length > 0 && (
          <div style={{ padding: '0.4rem 1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>Combine as</span>
            {(['AND', 'OR'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => update({ sourceTargetRelation: mode })}
                title={mode === 'AND'
                  ? 'Show telegrams matching a selected source AND a selected target'
                  : 'Show telegrams matching any selected source OR any selected target'}
                style={{
                  padding: '0.15rem 0.55rem', borderRadius: '4px', fontSize: '0.7rem',
                  fontWeight: 600, cursor: 'pointer', border: '1px solid',
                  borderColor: activeFilters.sourceTargetRelation === mode ? 'var(--accent-primary)' : 'var(--border-color)',
                  background: activeFilters.sourceTargetRelation === mode ? 'rgba(99,102,241,0.15)' : 'transparent',
                  color: activeFilters.sourceTargetRelation === mode ? 'var(--accent-primary)' : 'var(--text-dim)',
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        )}

        {/* Target */}
        {filteredTargets.length > 0 && (
          <Section title="Target" defaultOpen>
            <KnxAddressTree
              entries={filteredTargets}
              selected={activeFilters.targets}
              groupNames={options.ga_group_names ?? {}}
              separator="/"
              onToggle={addresses => update({ targets: addresses })}
              counts={counts?.targets}
              mode={mode}
              searchQuery={q}
              onLastSeen={onQuickLastSeen ? addr => onQuickLastSeen(addr, 'ga') : undefined}
            />
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

        {/* Direction — orthogonal to Type: incoming bus traffic vs. self-sent telegrams (#194) */}
        {filteredDirections.length > 0 && (
          <Section title="Direction" defaultOpen>
            {filteredDirections.map(d => (
              <OptionRow
                key={d}
                label={d}
                checked={activeFilters.directions.includes(d)}
                count={mode === 'live' ? (counts?.directions[d] ?? 0) : undefined}
                onToggle={() => update({ directions: toggle(activeFilters.directions, d) })}
              />
            ))}
          </Section>
        )}

        {/* DPT */}
        {filteredDpts.length > 0 && (
          <Section title="DPT" defaultOpen={false}>
            {filteredDpts.map(d => {
              const key = dptKey(d.main!, d.sub);
              return (
                <OptionRow
                  key={key}
                  label={d.label!}
                  checked={activeFilters.dpts.includes(key)}
                  count={mode === 'live' ? (counts?.dpts[key] ?? 0) : undefined}
                  onToggle={() => update({ dpts: toggle(activeFilters.dpts, key) })}
                />
              );
            })}
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
                  flex: 1, background: 'var(--bg-tag)', border: '1px solid var(--border-color)',
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
                  flex: 1, background: 'var(--bg-tag)', border: '1px solid var(--border-color)',
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

// Add styles for filter section
const style = document.createElement('style');
style.textContent = `
  .filter-chip-removed {
    /* Placeholder to remove old styles if needed, but we'll just rewrite the whole block */
  }
`;
document.head.appendChild(style);
