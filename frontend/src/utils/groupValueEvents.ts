/**
 * One classifier for GroupValue Read / Response / Write.
 *
 * Callers:
 * - Send panel and popover: each incoming telegram is classified as it arrives.
 *   The GA phase is recomputed from every telegram seen so far (the live buffer,
 *   including the pause backlog).
 * - Telegram table: a Read was followed by a Response when one exists in that
 *   buffer. The jump always targets the earliest such Response. Whether the
 *   Read is *painted* answered depends on the sort: not primarily time-sorted
 *   → the buffer is enough; primarily time-sorted → that earliest Response
 *   must itself sit in the current viewport. A later Response on screen does
 *   not paint the Read answered.
 */

export type BusEventKind = 'read' | 'response' | 'write' | 'other';

export interface GroupValueTelegram {
  timestamp: string;
  target_address: string;
  simplified_type?: string | null;
  telegram_type?: string | null;
}

/** Response, then Read, then Write. A label that names a Response is never a Read. */
export function busEventKind(label: string | null | undefined): BusEventKind {
  const u = (label ?? '').trim().toUpperCase();
  if (!u) return 'other';
  if (u.includes('RESPONSE')) return 'response';
  if (u.includes('READ')) return 'read';
  if (u.includes('WRITE')) return 'write';
  return 'other';
}

/**
 * simplified_type wins when it is Read, Response, or Write (any casing).
 * Otherwise the raw telegram_type is used. A telegram is only one kind.
 */
export function telegramBusEventKind(
  t: { simplified_type?: string | null; telegram_type?: string | null } | null | undefined,
): BusEventKind {
  if (!t) return 'other';
  const simplified = busEventKind(t.simplified_type);
  if (simplified !== 'other') return simplified;
  return busEventKind(t.telegram_type);
}

export function isReadKind(kind: string | null | undefined): boolean {
  return busEventKind(kind) === 'read';
}

export function isResponseKind(kind: string | null | undefined): boolean {
  return busEventKind(kind) === 'response';
}

export function isGroupRead(
  t: { simplified_type?: string | null; telegram_type?: string | null } | null | undefined,
): boolean {
  return telegramBusEventKind(t) === 'read';
}

export function isGroupResponse(
  t: { simplified_type?: string | null; telegram_type?: string | null } | null | undefined,
): boolean {
  return telegramBusEventKind(t) === 'response';
}

export function isGroupWrite(
  t: { simplified_type?: string | null; telegram_type?: string | null } | null | undefined,
): boolean {
  return telegramBusEventKind(t) === 'write';
}

/** A Response answers a Read only when that Read is strictly older. */
export function responseAnswersRead(readMs: number, responseMs: number): boolean {
  return Number.isFinite(readMs) && Number.isFinite(responseMs) && readMs < responseMs;
}

export function readFollowKey(t: { timestamp: string; target_address: string }): string {
  return `${t.timestamp}|${t.target_address}`;
}

/**
 * Earliest Response on the same group address strictly after the Read.
 * Same address string, not a trimmed or normalised form. Equal timestamps
 * do not answer. Invalid timestamps are ignored.
 */
export function matchingResponse<T extends GroupValueTelegram>(
  read: T,
  rows: readonly T[],
): T | null {
  if (!read.target_address || !isGroupRead(read)) return null;
  const readMs = Date.parse(read.timestamp);
  if (!Number.isFinite(readMs)) return null;
  let best: T | null = null;
  let bestMs = Infinity;
  let bestOrder = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i];
    if (t.target_address !== read.target_address || !isGroupResponse(t)) continue;
    const ms = Date.parse(t.timestamp);
    if (!responseAnswersRead(readMs, ms)) continue;
    if (ms < bestMs || (ms === bestMs && i < bestOrder)) {
      best = t;
      bestMs = ms;
      bestOrder = i;
    }
  }
  return best;
}

/**
 * Reads that a later Response on the same GA has followed.
 * The value is the earliest such Response. Keys are `timestamp|target`.
 */
export function responsesFollowingReads<T extends GroupValueTelegram>(
  rows: readonly T[],
): Map<string, T> {
  const responses = new Map<string, { ms: number; order: number; row: T }[]>();
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i];
    if (!t.target_address || !isGroupResponse(t)) continue;
    const ms = Date.parse(t.timestamp);
    if (!Number.isFinite(ms)) continue;
    const entry = { ms, order: i, row: t };
    const list = responses.get(t.target_address);
    if (list) list.push(entry);
    else responses.set(t.target_address, [entry]);
  }
  for (const list of responses.values()) {
    list.sort((a, b) => a.ms - b.ms || a.order - b.order);
  }

  const followed = new Map<string, T>();
  for (const t of rows) {
    if (!t.target_address || !isGroupRead(t)) continue;
    const ms = Date.parse(t.timestamp);
    const list = responses.get(t.target_address);
    if (!list || !Number.isFinite(ms)) continue;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (!responseAnswersRead(ms, list[mid].ms)) lo = mid + 1;
      else hi = mid;
    }
    if (lo < list.length) followed.set(readFollowKey(t), list[lo].row);
  }
  return followed;
}

/** True when some Response on the Read's GA is strictly newer than the Read. */
export function readEventAnswered(
  read: { timestamp: string; target_address?: string | null; simplified_type?: string | null; telegram_type?: string | null } | null | undefined,
  rows: readonly GroupValueTelegram[],
): boolean {
  if (!read?.target_address) return false;
  return matchingResponse({ ...read, target_address: read.target_address }, rows) != null;
}

/** Keys of reads that a later Response on the same GA has followed. */
export function answeredReadIds(rows: readonly GroupValueTelegram[]): Set<string> {
  return new Set(responsesFollowingReads(rows).keys());
}

type TelegramIdentity = GroupValueTelegram & {
  source_address?: string;
  raw_hex?: string | null;
};

/** Same bus telegram across a buffer row and a viewport copy of it. */
export function sameBusTelegram(a: TelegramIdentity, b: TelegramIdentity): boolean {
  return a.timestamp === b.timestamp
    && a.target_address === b.target_address
    && (a.source_address ?? '') === (b.source_address ?? '')
    && (a.raw_hex ?? '') === (b.raw_hex ?? '');
}

/**
 * True when this Response is one of `visibleRows`.
 * Time-sorted tables pass the earliest matching Response: a later Response
 * that happens to be on screen does not count.
 */
export function responseIsVisible<T extends TelegramIdentity>(
  response: T,
  visibleRows: readonly T[],
): boolean {
  return visibleRows.some(row => sameBusTelegram(response, row));
}

export interface ViewportSpan {
  index: number;
  start: number;
  end: number;
}

/**
 * Rows whose layout box intersects [scrollTop, scrollTop + viewportHeight).
 * A zero-height span is unmeasured and does not count. Overscan that does
 * not intersect the scrollport is excluded.
 */
export function rowsIntersectingViewport<T>(
  rows: readonly T[],
  spans: readonly ViewportSpan[],
  scrollTop: number,
  viewportHeight: number,
): T[] {
  if (!(viewportHeight > 0)) return [];
  const viewBottom = scrollTop + viewportHeight;
  const out: T[] = [];
  for (const span of spans) {
    if (!(span.end > span.start)) continue;
    if (!(span.end > scrollTop && span.start < viewBottom)) continue;
    const row = rows[span.index];
    if (row) out.push(row);
  }
  return out;
}

/** Seen-read state of one group address. Follows the latest Read or Response. */
export type GaReadPhase = 'none' | 'request' | 'answered';

/**
 * Per-GA read phase from known telegrams, independent of row order.
 * A Response strictly after the latest Read is `answered`; a later Read
 * reopens `request` until the next Response. The send panel recomputes this
 * as each telegram arrives.
 */
export function gaReadPhases(rows: readonly GroupValueTelegram[]): Map<string, GaReadPhase> {
  const latestRead = new Map<string, number>();
  const latestResponse = new Map<string, number>();
  for (const t of rows) {
    const addr = t.target_address;
    if (!addr) continue;
    const ms = Date.parse(t.timestamp);
    if (!Number.isFinite(ms)) continue;
    const bucket = isGroupResponse(t) ? latestResponse : isGroupRead(t) ? latestRead : null;
    if (!bucket) continue;
    const prev = bucket.get(addr);
    if (prev == null || ms > prev) bucket.set(addr, ms);
  }
  const map = new Map<string, GaReadPhase>();
  for (const addr of new Set([...latestRead.keys(), ...latestResponse.keys()])) {
    const readMs = latestRead.get(addr);
    const responseMs = latestResponse.get(addr);
    if (responseMs != null && (readMs == null || responseAnswersRead(readMs, responseMs))) map.set(addr, 'answered');
    else if (readMs != null) map.set(addr, 'request');
  }
  return map;
}

/** Across several addresses an open read wins, then an answered one. */
export function mergeGaReadPhase(a: GaReadPhase, b: GaReadPhase): GaReadPhase {
  if (a === 'request' || b === 'request') return 'request';
  if (a === 'answered' || b === 'answered') return 'answered';
  return 'none';
}

/** Phase across several addresses: an open read wins, then an answered one. */
export function combineGaReadPhase(
  map: Map<string, GaReadPhase>,
  addresses: string[],
): GaReadPhase {
  let phase: GaReadPhase = 'none';
  for (const address of addresses) {
    phase = mergeGaReadPhase(phase, map.get(address.trim()) ?? 'none');
    if (phase === 'request') return phase;
  }
  return phase;
}
