import { DEFAULT_FILTERS, type ActiveFilters } from '../types/filters';
import type { LoadedRange } from './historyLoad';
import { getBasePath } from './basePath';

/** A visualization view encoded in the URL (#150). */
export interface VizViewState {
  /** Group addresses to plot (selectedVisualizationTargets). */
  plot: string[];
  filters: ActiveFilters;
  range: LoadedRange;
  limit?: number;
  /** Render only the chart area (iframe/dashboard embedding). */
  embed: boolean;
  /** Embed only: re-fetch interval for relative windows, seconds. */
  refresh?: number;
  /** Embed only: force a theme instead of the cookie/system default. */
  theme?: 'dark' | 'light';
}

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** Parses "24h" / "90m" / "30s" / "7d" into seconds. */
function parseRel(rel: string): number | null {
  const m = rel.match(/^(\d+)([smhd])$/);
  if (!m) return null;
  const seconds = Number(m[1]) * UNIT_SECONDS[m[2]];
  return seconds > 0 ? seconds : null;
}

/** Formats seconds as the largest unit that divides evenly ("86400" → "1d"). */
export function formatRel(seconds: number): string {
  for (const [unit, secs] of [['d', 86400], ['h', 3600], ['m', 60]] as const) {
    if (seconds % secs === 0 && seconds >= secs) return `${seconds / secs}${unit}`;
  }
  return `${seconds}s`;
}

const list = (v: string | null): string[] => (v ? v.split(',').filter(Boolean) : []);

/**
 * Parses a shared-view URL query string. Returns null unless `view=viz`
 * is present with a usable time range.
 */
export function parseViewUrl(search: string): VizViewState | null {
  const p = new URLSearchParams(search);
  if (p.get('view') !== 'viz') return null;

  let range: LoadedRange | null = null;
  const rel = p.get('rel');
  if (rel) {
    const seconds = parseRel(rel);
    if (seconds) range = { kind: 'relative', seconds };
  } else if (p.get('start') || p.get('end')) {
    range = { kind: 'absolute', startTime: p.get('start') ?? '', endTime: p.get('end') ?? '' };
  }
  if (!range) return null;

  const filters: ActiveFilters = {
    ...DEFAULT_FILTERS,
    sources: list(p.get('src')),
    targets: list(p.get('tgt')),
    types: list(p.get('type')),
    dpts: list(p.get('dpt')).filter(d => /^\d+(\.\d+)?$/.test(d)),
    deltaBeforeMs: Math.max(0, Number(p.get('before')) || 0),
    deltaAfterMs: Math.max(0, Number(p.get('after')) || 0),
    sourceTargetRelation: p.get('rel_st') === 'OR' ? 'OR' : 'AND',
  };

  const limit = Number(p.get('limit'));
  const refresh = Number(p.get('refresh'));
  const theme = p.get('theme');

  return {
    plot: list(p.get('plot')),
    filters,
    range,
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    embed: p.get('embed') === '1',
    refresh: Number.isFinite(refresh) && refresh > 0 ? refresh : undefined,
    theme: theme === 'dark' || theme === 'light' ? theme : undefined,
  };
}

/** Builds a shareable URL (path + query) for a view. Omits defaults. */
export function buildViewUrl(state: {
  plot: string[];
  filters: ActiveFilters;
  range: LoadedRange;
  limit?: number;
  embed?: boolean;
}): string {
  const p = new URLSearchParams();
  p.set('view', 'viz');
  if (state.plot.length > 0) p.set('plot', state.plot.join(','));
  const f = state.filters;
  if (f.sources.length > 0) p.set('src', f.sources.join(','));
  if (f.targets.length > 0) p.set('tgt', f.targets.join(','));
  if (f.types.length > 0) p.set('type', f.types.join(','));
  if (f.dpts.length > 0) p.set('dpt', f.dpts.join(','));
  if (f.deltaBeforeMs > 0) p.set('before', String(f.deltaBeforeMs));
  if (f.deltaAfterMs > 0) p.set('after', String(f.deltaAfterMs));
  if (f.sourceTargetRelation === 'OR') p.set('rel_st', 'OR');
  if (state.range.kind === 'relative') {
    p.set('rel', formatRel(state.range.seconds));
  } else {
    if (state.range.startTime) p.set('start', state.range.startTime);
    if (state.range.endTime) p.set('end', state.range.endTime);
  }
  if (state.limit) p.set('limit', String(state.limit));
  if (state.embed) p.set('embed', '1');
  return `${getBasePath()}/?${p.toString()}`;
}
