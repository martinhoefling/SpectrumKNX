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
  /** GA group names keyed by address prefix: {"0": "Zentral", "0/1": "Wetter"} */
  ga_group_names: Record<string, string>;
  /** PA area/line names keyed by address prefix: {"1": "Area 1", "1.0": "Line EG"} */
  pa_line_names: Record<string, string>;
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
  /**
   * Controls how Source and Target filters combine when both are active.
   *
   * AND (default): a telegram must match a selected source AND a selected target.
   *   Use when diagnosing traffic between specific devices and group addresses.
   *
   * OR: a telegram matches if it matches any selected source OR any selected target.
   *   Use when you want to see everything from a device alongside everything sent
   *   to a particular group address, regardless of which side triggered it.
   *
   * Within each category (multiple sources, multiple targets) the logic is always OR.
   * OR mode requires two backend queries for history (one per side) whose results are
   * merged client-side, because the knx-telegram-store library does not support
   * cross-category OR natively.
   */
  sourceTargetRelation: 'AND' | 'OR';
}

export const DEFAULT_FILTERS: ActiveFilters = {
  sources: [],
  targets: [],
  types: [],
  dpts: [],
  deltaBeforeMs: 0,
  deltaAfterMs: 0,
  sourceTargetRelation: 'AND',
};

/** Minimal telegram shape needed for in-memory filtering. */
export interface FilterableTelegram {
  source_address: string;
  target_address: string;
  simplified_type?: string | null;
  dpt_main?: number | null;
}

/**
 * Returns true if the telegram passes the active filters.
 * Used for both live in-memory filtering and history client-side filtering.
 */
export function matchesTelegram(t: FilterableTelegram, f: ActiveFilters): boolean {
  const srcMatch = f.sources.includes(t.source_address);
  const tgtMatch = f.targets.includes(t.target_address);
  const srcOk = f.sources.length === 0 || srcMatch;
  const tgtOk = f.targets.length === 0 || tgtMatch;
  const typeOk = f.types.length === 0 || f.types.includes(t.simplified_type ?? '');
  const dptOk = f.dpts.length === 0 || (t.dpt_main != null && f.dpts.includes(t.dpt_main));

  const srcTgtOk = f.sources.length > 0 && f.targets.length > 0
    ? (f.sourceTargetRelation === 'OR' ? (srcMatch || tgtMatch) : (srcOk && tgtOk))
    : (srcOk && tgtOk);

  return srcTgtOk && typeOk && dptOk;
}

export function hasActiveFilters(f: ActiveFilters): boolean {
  return (
    f.sources.length > 0 ||
    f.targets.length > 0 ||
    f.types.length > 0 ||
    f.dpts.length > 0
  );
}

export interface FilterCounts {
  sources: Record<string, number>;
  targets: Record<string, number>;
  types: Record<string, number>;
  dpts: Record<number, number>;
}
