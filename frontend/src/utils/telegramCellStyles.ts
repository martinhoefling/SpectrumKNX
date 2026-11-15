/**
 * Telegram-table cell style class names. Visual tokens live as `--tt-*` CSS
 * variables / `.tt-*` classes in index.css so future prefs can restyle cells
 * without touching call sites.
 */

export const TT = {
  cell: 'tt-cell',
  time: 'tt-time',
  timeDate: 'tt-time-date',
  delta: 'tt-delta',
  deltaRow: 'tt-delta-row',
  addr: 'tt-addr',
  addrSource: 'tt-addr-source',
  addrTarget: 'tt-addr-target',
  subtitle: 'tt-subtitle',
  subtitleTargetName: 'tt-subtitle-target-name',
  type: 'tt-type',
  typeWrite: 'tt-type-write',
  typeRead: 'tt-type-read',
  /** Read whose GA later received a Response — same green as the send-panel status. */
  typeReadAnswered: 'tt-type-read-answered',
  typeResponse: 'tt-type-response',
  typeOther: 'tt-type-other',
  directionIn: 'tt-direction-in',
  directionOut: 'tt-direction-out',
  dpt: 'tt-dpt',
  dptDot: 'tt-dpt-dot',
  dptDot1: 'tt-dpt-dot-1',
  dptDot5: 'tt-dpt-dot-5',
  dptDot9: 'tt-dpt-dot-9',
  dptDotUnknown: 'tt-dpt-dot-unknown',
  value: 'tt-value',
  valueUnit: 'tt-value-unit',
  valueRow: 'tt-value-row',
  valueToggle: 'tt-value-toggle',
  rawBadge: 'raw-badge',
} as const;

/** Type label class for Write / Read / Response (falls back to other). */
export function ttTypeClass(simplified: string | null | undefined, answered = false): string {
  switch (simplified) {
    case 'Write': return `${TT.type} ${TT.typeWrite}`;
    case 'Read': return `${TT.type} ${answered ? TT.typeReadAnswered : TT.typeRead}`;
    case 'Response': return `${TT.type} ${TT.typeResponse}`;
    default: return `${TT.type} ${TT.typeOther}`;
  }
}

type GaTelegram = {
  timestamp: string;
  target_address: string;
  simplified_type?: string | null;
  telegram_type?: string | null;
};

export function isGroupRead(t: { simplified_type?: string | null; telegram_type?: string | null }): boolean {
  if (t.simplified_type === 'Read') return true;
  if (t.simplified_type === 'Response' || t.simplified_type === 'Write') return false;
  const type = t.telegram_type ?? '';
  return type.includes('Read') && !type.includes('Response');
}

export function isGroupResponse(t: { simplified_type?: string | null; telegram_type?: string | null }): boolean {
  return t.simplified_type === 'Response' || Boolean(t.telegram_type?.includes('Response'));
}

/** A Response answers a Read only when that Read is strictly older. */
export function responseAnswersRead(readMs: number, responseMs: number): boolean {
  return Number.isFinite(readMs) && Number.isFinite(responseMs) && readMs < responseMs;
}

/** True when some Response on the Read's GA is strictly newer than the Read. */
export function readEventAnswered(
  read: { timestamp: string; target_address?: string | null; simplified_type?: string | null; telegram_type?: string | null } | null | undefined,
  rows: GaTelegram[],
): boolean {
  if (!read?.target_address || !isGroupRead(read)) return false;
  const readMs = Date.parse(read.timestamp);
  return rows.some(t =>
    t.target_address === read.target_address
    && isGroupResponse(t)
    && responseAnswersRead(readMs, Date.parse(t.timestamp)),
  );
}

/**
 * Reads that a later Response on the same GA has answered.
 * Keys are `timestamp|target` so callers can match without importing anchor identity.
 */
export function answeredReadIds(rows: GaTelegram[]): Set<string> {
  const responses = new Map<string, number[]>();
  for (const t of rows) {
    if (!t.target_address || !isGroupResponse(t)) continue;
    const ms = Date.parse(t.timestamp);
    if (!Number.isFinite(ms)) continue;
    const list = responses.get(t.target_address);
    if (list) list.push(ms);
    else responses.set(t.target_address, [ms]);
  }
  for (const list of responses.values()) list.sort((a, b) => a - b);

  const answered = new Set<string>();
  for (const t of rows) {
    if (!t.target_address || !isGroupRead(t)) continue;
    const ms = Date.parse(t.timestamp);
    const list = responses.get(t.target_address);
    if (!list || !Number.isFinite(ms)) continue;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (!responseAnswersRead(ms, list[mid])) lo = mid + 1;
      else hi = mid;
    }
    if (lo < list.length) answered.add(`${t.timestamp}|${t.target_address}`);
  }
  return answered;
}

/** Seen-read state of one group address. Follows the latest Read or Response. */
export type GaReadPhase = 'none' | 'request' | 'answered';

/**
 * Per-GA read phase from known telegrams, independent of row order.
 * A Response strictly after the latest Read is `answered`; a later Read
 * reopens `request` until the next Response.
 */
export function gaReadPhases(rows: GaTelegram[]): Map<string, GaReadPhase> {
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

/** Direction subtitle class. */
export function ttDirectionClass(direction: string | null | undefined): string {
  return direction === 'Outgoing' ? TT.directionOut : TT.directionIn;
}

/** DPT colour-dot class from main category. */
export function ttDptDotClass(dptMain: number | null | undefined): string {
  if (dptMain === 1) return `${TT.dptDot} ${TT.dptDot1}`;
  if (dptMain === 5) return `${TT.dptDot} ${TT.dptDot5}`;
  if (dptMain === 9) return `${TT.dptDot} ${TT.dptDot9}`;
  return `${TT.dptDot} ${TT.dptDotUnknown}`;
}
