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
  directions: string[];    // telegram direction values (Incoming/Outgoing), orthogonal to types (#194)
  dpts: string[];          // DPT keys: "1.001" for one subtype, bare "1" for all subtypes of a major DPT
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

/** The two telegram direction values, as set by the backend daemon. */
export const DIRECTIONS = ['Incoming', 'Outgoing'];

export const DEFAULT_FILTERS: ActiveFilters = {
  sources: [],
  targets: [],
  types: [],
  directions: [],
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
  direction?: string | null;
  dpt_main?: number | null;
  dpt_sub?: number | null;
}

/**
 * Canonical DPT filter key: "1.001" with the sub, bare "1" without.
 * Matches the grammar of the backend's dpt_main query parameter.
 */
export function dptKey(main: number, sub?: number | null): string {
  return sub != null ? `${main}.${String(sub).padStart(3, '0')}` : `${main}`;
}

/** True if the telegram's DPT matches any key ("1" matches every 1.x). */
export function matchesDpt(keys: string[], main?: number | null, sub?: number | null): boolean {
  if (main == null) return false;
  return keys.some(k => k === `${main}` || k === dptKey(main, sub));
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
  // Telegrams without a direction (older stored data) only pass when unfiltered.
  const dirOk = f.directions.length === 0 || f.directions.includes(t.direction ?? '');
  const dptOk = f.dpts.length === 0 || matchesDpt(f.dpts, t.dpt_main, t.dpt_sub);

  const srcTgtOk = f.sources.length > 0 && f.targets.length > 0
    ? (f.sourceTargetRelation === 'OR' ? (srcMatch || tgtMatch) : (srcOk && tgtOk))
    : (srcOk && tgtOk);

  return srcTgtOk && typeOk && dirOk && dptOk;
}

export function hasActiveFilters(f: ActiveFilters): boolean {
  return (
    f.sources.length > 0 ||
    f.targets.length > 0 ||
    f.types.length > 0 ||
    f.directions.length > 0 ||
    f.dpts.length > 0
  );
}

export interface FilterCounts {
  sources: Record<string, number>;
  targets: Record<string, number>;
  types: Record<string, number>;
  directions: Record<string, number>;
  dpts: Record<string, number>;
}
