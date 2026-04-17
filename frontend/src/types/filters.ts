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

export interface FilterCounts {
  sources: Record<string, number>;
  targets: Record<string, number>;
  types: Record<string, number>;
  dpts: Record<number, number>;
}
