import { apiUrl } from './basePath';

/**
 * Integer width of a bare DPT main ("2"), which xknx cannot transcode.
 * Mirrors `_BARE_INT_MAINS` in knx_daemon.py. Float, time, date, string and
 * colour mains are absent and keep the normal transcoder path.
 */
const BARE_INT_MAINS: Record<number, { bits: number; signed: boolean }> = {
  1: { bits: 1, signed: false },
  2: { bits: 2, signed: false },
  3: { bits: 4, signed: false },
  23: { bits: 2, signed: false },
  4: { bits: 8, signed: false },
  5: { bits: 8, signed: false },
  17: { bits: 8, signed: false },
  18: { bits: 8, signed: false },
  20: { bits: 8, signed: false },
  21: { bits: 8, signed: false },
  25: { bits: 8, signed: false },
  26: { bits: 8, signed: false },
  238: { bits: 8, signed: false },
  6: { bits: 8, signed: true },
  7: { bits: 16, signed: false },
  22: { bits: 16, signed: false },
  8: { bits: 16, signed: true },
  12: { bits: 32, signed: false },
  27: { bits: 32, signed: false },
  13: { bits: 32, signed: true },
  29: { bits: 64, signed: true },
};

function bareIntMain(dpt?: string | null): { main: number; bits: number; signed: boolean } | null {
  const match = (dpt ?? '').trim().match(/^(\d+)$/);
  if (!match) return null;
  const main = Number(match[1]);
  const spec = BARE_INT_MAINS[main];
  return spec ? { main, ...spec } : null;
}

function intBounds(bits: number, signed: boolean): { min: bigint; max: bigint } {
  if (signed) {
    const half = 1n << BigInt(bits - 1);
    return { min: -half, max: half - 1n };
  }
  return { min: 0n, max: (1n << BigInt(bits)) - 1n };
}

/** A parsed integer that fits in a JSON number. Wider values are refused. */
function safeInt(n: bigint, label: string): number {
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(-Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Invalid value: ${label}`);
  }
  return Number(n);
}

/**
 * `0x` / `0b` with digits become an integer. A prefix without valid digits
 * throws so the text is not sent on as a string.
 */
function parseRadix(v: string): number | undefined {
  const hex = /^0x([0-9a-f]+)$/i.exec(v);
  if (hex) return safeInt(BigInt(`0x${hex[1]}`), v);
  const bin = /^0b([01]+)$/i.exec(v);
  if (bin) return safeInt(BigInt(`0b${bin[1]}`), v);
  if (/^0[xb]/i.test(v)) throw new Error(`Invalid value: ${v}`);
  return undefined;
}

/** Coerce a user-entered string into the value type xknx expects for the DPT.
 * Booleans (on/off/true/false), decimal numbers, and `0x` / `0b` integers are
 * recognised; everything else is sent as a string. The backend transcoder
 * validates and rejects bad values. */
export function coerceValue(raw: string): boolean | number | string {
  const v = raw.trim();
  const lower = v.toLowerCase();
  if (['true', 'on', 'yes'].includes(lower)) return true;
  if (['false', 'off', 'no'].includes(lower)) return false;
  const radix = parseRadix(v);
  if (radix !== undefined) return radix;
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

/**
 * Payload for a free value field. A bare integer main ("2") accepts only a
 * value that fits that width: decimal in range, `0x` / `0b` as a bit pattern
 * (two's complement when the type is signed). Anything else throws and must
 * not be sent.
 */
export function payloadFromValue(raw: string, dpt?: string | null): boolean | number | string {
  const spec = bareIntMain(dpt);
  if (!spec) return coerceValue(raw);

  const v = raw.trim();
  const { min, max } = intBounds(spec.bits, spec.signed);
  const outOfRange = (shown: bigint) => {
    throw new Error(`Value ${shown} is out of range for DPT ${spec.main} (${min}–${max})`);
  };
  const lower = v.toLowerCase();
  if (['true', 'on', 'yes'].includes(lower)) return finishBare(1n, v, min, max, outOfRange);
  if (['false', 'off', 'no'].includes(lower)) return finishBare(0n, v, min, max, outOfRange);

  const hex = /^0x([0-9a-f]+)$/i.exec(v);
  const bin = /^0b([01]+)$/i.exec(v);
  if (hex || bin) {
    const pattern = hex ? BigInt(`0x${hex[1]}`) : BigInt(`0b${bin![1]}`);
    const width = 1n << BigInt(spec.bits);
    if (pattern < 0n || pattern >= width) outOfRange(pattern);
    const value = spec.signed && pattern >= (width >> 1n) ? pattern - width : pattern;
    return safeInt(value, v);
  }
  if (/^0[xb]/i.test(v)) throw new Error(`Invalid value: ${v}`);

  if (/^[+-]?\d+$/.test(v)) {
    const n = BigInt(v.replace(/^\+/, ''));
    if (n < min || n > max) outOfRange(n);
    return safeInt(n, v);
  }
  throw new Error(`Invalid value: ${v}`);
}

function finishBare(
  n: bigint,
  label: string,
  min: bigint,
  max: bigint,
  outOfRange: (shown: bigint) => never,
): number {
  if (n < min || n > max) outOfRange(n);
  return safeInt(n, label);
}

/** Format a DPT main/sub pair into the "5.001" string the backend expects. */
export function formatDpt(main?: number | null, sub?: number | null): string {
  if (main == null) return '';
  return sub == null ? String(main) : `${main}.${String(sub).padStart(3, '0')}`;
}

/**
 * Parse the main number out of a DPT string ("5.010" -> 5, "1" -> 1).
 * Returns undefined for an empty or malformed value. Inverse of `formatDpt`;
 * used to pick the write widget from the (possibly overridden) DPT (#342).
 */
export function parseDptMain(dpt: string): number | undefined {
  const m = dpt.trim().match(/^(\d+)(?:\.\d+)?$/);
  if (!m) return undefined;
  return Number(m[1]);
}

/** Main + optional subtype from a DPT key ("16.001" → {16,1}, "4" → {4,null}). */
export function parseDptKey(dpt?: string | null): { main: number; sub: number | null } | null {
  const m = (dpt ?? '').trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  return { main: Number(m[1]), sub: m[2] != null ? Number(m[2]) : null };
}

/** Character / string DPTs: 4 (1 char), 16 (14-byte), 28 (UTF-8). */
export function isTextDptMain(main?: number | null): boolean {
  return main === 4 || main === 16 || main === 28;
}

/** Fixed character width for text DPTs; `null` when length is variable (DPT 28). */
export function textDptCharWidth(main?: number | null): number | null {
  if (main === 4) return 1;
  if (main === 16) return 14;
  return null;
}

export type TextDptEncoding = 'ascii' | 'latin1' | 'utf8';

/**
 * Character set for a text DPT subtype (xknx `_encoding`).
 * Bare main 4/16 and 4.001 / 16.000 → ASCII; *.002 / *.001 Latin → latin1; 28 → utf8.
 */
export function textDptEncoding(dptKey?: string | null): TextDptEncoding | null {
  const parsed = parseDptKey(dptKey);
  if (!parsed || !isTextDptMain(parsed.main)) return null;
  if (parsed.main === 28) return 'utf8';
  if (parsed.main === 4) {
    if (parsed.sub == null || parsed.sub === 1) return 'ascii';
    if (parsed.sub === 2) return 'latin1';
    return 'ascii';
  }
  // DPT 16
  if (parsed.sub == null || parsed.sub === 0) return 'ascii';
  if (parsed.sub === 1) return 'latin1';
  return 'ascii';
}

const ENCODING_LABEL: Record<TextDptEncoding, string> = {
  ascii: 'ASCII',
  latin1: 'Latin-1',
  utf8: 'UTF-8',
};

function assertTextDptCharset(value: string, encoding: TextDptEncoding, dptLabel: string): void {
  if (encoding === 'utf8') return;
  const max = encoding === 'ascii' ? 127 : 255;
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code > max) {
      throw new Error(`Character not allowed for DPT ${dptLabel} (${ENCODING_LABEL[encoding]})`);
    }
  }
}

/**
 * Payload for a text DPT write: no trim; pad/slice to fixed width; charset check.
 * Non-text DPTs return `raw` unchanged (caller should not use this path).
 */
export function textDptWritePayload(raw: string, dptKey?: string | null): string {
  const parsed = parseDptKey(dptKey);
  if (!parsed || !isTextDptMain(parsed.main)) return raw;

  const width = textDptCharWidth(parsed.main);
  const value = width == null ? raw : raw.padEnd(width, ' ').slice(0, width);
  const encoding = textDptEncoding(dptKey) ?? 'utf8';
  const label = (dptKey ?? String(parsed.main)).trim() || String(parsed.main);
  assertTextDptCharset(value, encoding, label);
  return value;
}

async function post<T = unknown>(endpoint: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data?.detail === 'string') detail = data.detail;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export function sendTelegram(address: string, payload: unknown, dpt?: string, response = false): Promise<unknown> {
  return post('/api/knx/send', { address, payload, dpt: dpt || null, response });
}

export function readTelegram(address: string): Promise<unknown> {
  return post('/api/knx/read', { address });
}

/** Status of one delayed/cyclic send job, as returned by the backend. */
export interface ScheduledSendStatus {
  state: 'idle' | 'waiting' | 'running' | 'done' | 'cancelled' | 'failed';
  id?: string;
  address?: string;
  delay_seconds?: number;
  interval_seconds?: number | null;
  sends_done?: number;
  sends_skipped?: number;
  next_send_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
}

export function startScheduledSend(
  address: string,
  payload: unknown,
  dpt: string | undefined,
  opts: { delaySeconds?: number; intervalSeconds?: number },
): Promise<ScheduledSendStatus> {
  return post<ScheduledSendStatus>('/api/knx/send/scheduled', {
    address,
    payload,
    dpt: dpt || null,
    response: false,
    delay_seconds: opts.delaySeconds ?? 0,
    interval_seconds: opts.intervalSeconds ?? null,
  });
}

/** Active (waiting/running) scheduled jobs. */
export async function getScheduledSendStatus(): Promise<ScheduledSendStatus[]> {
  const res = await fetch(apiUrl('/api/knx/send/scheduled/status'));
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const data = await res.json() as { jobs?: ScheduledSendStatus[] };
  return Array.isArray(data.jobs) ? data.jobs : [];
}

export function cancelScheduledSend(jobId: string): Promise<unknown> {
  return post('/api/knx/send/scheduled/cancel', { id: jobId });
}

/** Cancel every waiting/running scheduled send (omit id → cancel-all). */
export function cancelAllScheduledSends(): Promise<unknown> {
  return post('/api/knx/send/scheduled/cancel', {});
}
