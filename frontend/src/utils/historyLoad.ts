import type { Telegram } from '../hooks/useWebSocket';
import type { ActiveFilters } from '../types/filters';
import { apiUrl } from './basePath';

export interface HistoryMetadata {
  total_count: number;
  limit_reached: boolean;
}

/** The time window a history load was made with — kept for share links (#150). */
export type LoadedRange =
  | { kind: 'relative'; seconds: number }
  | { kind: 'absolute'; startTime: string; endTime: string };

/** Appends active filter state as query params to a base URL string. */
export function applyFilterParams(url: string, filters?: ActiveFilters): string {
  if (!filters) return url;
  const params: string[] = [];
  if (filters.sources.length > 0) params.push(`source_address=${encodeURIComponent(filters.sources.join(','))}`);
  if (filters.targets.length > 0) params.push(`target_address=${encodeURIComponent(filters.targets.join(','))}`);
  if (filters.types.length > 0) params.push(`telegram_type=${encodeURIComponent(filters.types.join(','))}`);
  if (filters.dpts.length > 0) params.push(`dpt_main=${encodeURIComponent(filters.dpts.join(','))}`);
  if (filters.deltaBeforeMs > 0) params.push(`delta_before_ms=${filters.deltaBeforeMs}`);
  if (filters.deltaAfterMs > 0) params.push(`delta_after_ms=${filters.deltaAfterMs}`);
  if (params.length === 0) return url;
  return url + (url.includes('?') ? '&' : '?') + params.join('&');
}

/** Converts local datetime-local string to UTC ISO string, returns empty string if invalid. */
function localToUtcIso(localStr: string): string {
  if (!localStr) return '';
  const d = new Date(localStr);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

/** Converts local datetime-local string to epoch milliseconds, returns fallback if invalid. */
function localToEpochMs(localStr: string, fallback: number): number {
  if (!localStr) return fallback;
  const d = new Date(localStr);
  return isNaN(d.getTime()) ? fallback : d.getTime();
}

/** Builds the /api/telegrams URL for a range. Times use the loader's
 * datetime-local format ("YYYY-MM-DDTHH:MM", interpreted in the local timezone). */
export function buildHistoryUrl(range: LoadedRange, limit: number): string {
  let url = apiUrl(`/api/telegrams?limit=${limit}`);
  if (range.kind === 'relative') {
    const start = new Date(Date.now() - range.seconds * 1000).toISOString();
    url += `&start_time=${encodeURIComponent(start)}`;
  } else {
    const startUtc = localToUtcIso(range.startTime);
    if (startUtc) url += `&start_time=${encodeURIComponent(startUtc)}`;
    const endUtc = localToUtcIso(range.endTime);
    if (endUtc) url += `&end_time=${encodeURIComponent(endUtc)}`;
  }
  return url;
}

/** Resolves a LoadedRange to concrete epoch-ms bounds (open ends → 0 / now). */
export function rangeToMs(range: LoadedRange, nowMs = Date.now()): { startMs: number; endMs: number } {
  if (range.kind === 'relative') {
    return { startMs: nowMs - range.seconds * 1000, endMs: nowMs };
  }
  return {
    startMs: localToEpochMs(range.startTime, 0),
    endMs: localToEpochMs(range.endTime, nowMs),
  };
}

/**
 * Fetches history telegrams for a range with server-side filters applied.
 * All active filters combine with AND (#275), so a single query suffices.
 */
export async function loadHistoryTelegrams(
  range: LoadedRange,
  limit: number,
  filters?: ActiveFilters,
): Promise<{ telegrams: Telegram[]; metadata: HistoryMetadata }> {
  const baseUrl = buildHistoryUrl(range, limit);
  const res = await fetch(applyFilterParams(baseUrl, filters));
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const data = await res.json();
  return {
    telegrams: data.telegrams || [],
    metadata: data.metadata || { total_count: 0, limit_reached: false },
  };
}
