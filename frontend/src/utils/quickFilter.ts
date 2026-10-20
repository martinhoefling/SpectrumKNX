// Quick filter bar matching (#271, #309), shared by the table (which renders
// the bar) and its parents (which use quick-filter matches as Time-Delta-Context
// anchors, so context rows around them stay visible — #520).
import type { Telegram } from '../hooks/useWebSocket';
import { dptKey } from '../types/filters';
import { makeAddressPatternMatcher } from './addressPattern';
import { makeValueMatcher } from './valuePattern';

// A quick-filter cell's two input rows (#309). Most columns use both (address/DPT
// pattern + name regex on source/target/dpt; from/to on time/value); TYPE only
// uses `top` (a comma-separated fixed-value list); `delta` isn't matched through
// this pipeline at all — its two rows edit the Time-Delta-Context window instead.
export interface QuickCellValue {
  top: string;
  bottom: string;
}
/** Patterns per column id ('time', 'source', 'target', 'type', 'dpt', 'value'). */
export type QuickPatterns = Partial<Record<string, QuickCellValue>>;

/** Case-insensitive regex matcher; an invalid pattern degrades to a literal substring match. */
export const makeTextMatcher = (pattern: string): ((s: string) => boolean) => {
  try {
    const re = new RegExp(pattern, 'i');
    return s => re.test(s);
  } catch {
    const lower = pattern.toLowerCase();
    return s => s.toLowerCase().includes(lower);
  }
};

/** Builds one combined predicate from all active quick-filter cells, so
 * patterns are compiled once per change rather than per telegram. */
export const compileQuickFilters = (patterns: QuickPatterns): ((t: Telegram) => boolean) => {
  const checks: ((t: Telegram) => boolean)[] = [];

  const time = patterns.time;
  if (time?.top || time?.bottom) {
    const from = time.top ? new Date(time.top).getTime() : null;
    const to = time.bottom ? new Date(time.bottom).getTime() : null;
    checks.push(t => {
      const ts = new Date(t.timestamp).getTime();
      if (from != null && !Number.isNaN(from) && ts < from) return false;
      if (to != null && !Number.isNaN(to) && ts > to) return false;
      return true;
    });
  }

  const source = patterns.source;
  if (source?.top) {
    const m = makeAddressPatternMatcher(source.top);
    checks.push(t => m(t.source_address));
  }
  if (source?.bottom) {
    const m = makeTextMatcher(source.bottom);
    checks.push(t => m(t.source_name ?? ''));
  }

  const target = patterns.target;
  if (target?.top) {
    const m = makeAddressPatternMatcher(target.top);
    checks.push(t => m(t.target_address));
  }
  if (target?.bottom) {
    const m = makeTextMatcher(target.bottom);
    checks.push(t => m(t.target_name ?? ''));
  }

  const type = patterns.type;
  if (type?.top) {
    const values = type.top.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (values.length > 0) {
      checks.push(t => {
        const typeVal = (t.simplified_type || t.telegram_type || '').toLowerCase();
        const dirVal = (t.direction ?? '').toLowerCase();
        return values.some(v => v === typeVal || v === dirVal);
      });
    }
  }

  const dpt = patterns.dpt;
  if (dpt?.top) {
    const m = makeAddressPatternMatcher(dpt.top);
    checks.push(t => t.dpt_main != null && m(dptKey(t.dpt_main, t.dpt_sub)));
  }
  if (dpt?.bottom) {
    const m = makeTextMatcher(dpt.bottom);
    checks.push(t => m(t.dpt_name ?? ''));
  }

  const value = patterns.value;
  if (value?.top || value?.bottom) {
    const m = makeValueMatcher(value.top ?? '', value.bottom ?? '');
    checks.push(m);
  }

  if (checks.length === 0) return () => true;
  return t => checks.every(check => check(t));
};

/** The effective quick-filter predicate, or null when the bar is closed, disabled or empty. */
export function activeQuickFilter(open: boolean, enabled: boolean, patterns: QuickPatterns): ((t: Telegram) => boolean) | null {
  if (!open || !enabled) return null;
  const hasPattern = Object.entries(patterns).some(([id, cell]) => id !== 'delta' && (cell?.top || cell?.bottom));
  return hasPattern ? compileQuickFilters(patterns) : null;
}
