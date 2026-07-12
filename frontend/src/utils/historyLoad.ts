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

/** Builds the /api/telegrams URL for a range. Times use the loader's
 * datetime-local format ("YYYY-MM-DDTHH:MM", treated as UTC). */
export function buildHistoryUrl(range: LoadedRange, limit: number): string {
  let url = apiUrl(`/api/telegrams?limit=${limit}`);
  if (range.kind === 'relative') {
    const start = new Date(Date.now() - range.seconds * 1000).toISOString();
    url += `&start_time=${encodeURIComponent(start)}`;
  } else {
    if (range.startTime) url += `&start_time=${encodeURIComponent(range.startTime + ':00Z')}`;
    if (range.endTime) url += `&end_time=${encodeURIComponent(range.endTime + ':00Z')}`;
  }
  return url;
}

/**
 * Fetches history telegrams for a range with server-side filters applied.
 * OR source/target relation is handled with two queries merged client-side,
 * because the knx-telegram-store library only supports AND across the two.
 */
export async function loadHistoryTelegrams(
  range: LoadedRange,
  limit: number,
  filters?: ActiveFilters,
): Promise<{ telegrams: Telegram[]; metadata: HistoryMetadata }> {
  const baseUrl = buildHistoryUrl(range, limit);
  const isOrMode = filters?.sourceTargetRelation === 'OR'
    && (filters.sources.length > 0)
    && (filters.targets.length > 0);

  if (isOrMode) {
    const srcFilters = { ...filters, targets: [], sourceTargetRelation: 'AND' as const };
    const tgtFilters = { ...filters, sources: [], sourceTargetRelation: 'AND' as const };
    const [srcRes, tgtRes] = await Promise.all([
      fetch(applyFilterParams(baseUrl, srcFilters)),
      fetch(applyFilterParams(baseUrl, tgtFilters)),
    ]);
    if (!srcRes.ok || !tgtRes.ok) throw new Error(`Server error: ${srcRes.ok ? tgtRes.status : srcRes.status}`);
    const [srcData, tgtData] = await Promise.all([srcRes.json(), tgtRes.json()]);

    const seen = new Set<string>();
    const merged: Telegram[] = [];
    for (const t of [...(srcData.telegrams || []), ...(tgtData.telegrams || [])]) {
      if (!seen.has(t.timestamp)) {
        seen.add(t.timestamp);
        merged.push(t);
      }
    }
    // Re-sort descending (both halves arrive sorted but interleaved)
    merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const limitReached = (srcData.metadata?.limit_reached || tgtData.metadata?.limit_reached) ?? false;
    return { telegrams: merged, metadata: { total_count: merged.length, limit_reached: limitReached } };
  }

  const res = await fetch(applyFilterParams(baseUrl, filters));
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const data = await res.json();
  return {
    telegrams: data.telegrams || [],
    metadata: data.metadata || { total_count: 0, limit_reached: false },
  };
}
