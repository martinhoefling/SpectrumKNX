import { apiUrl } from './basePath';

/** Coerce a user-entered string into the value type xknx expects for the DPT.
 * Booleans (on/off/true/false) and numbers are recognised; everything else is
 * sent as a string. The backend transcoder validates and rejects bad values. */
export function coerceValue(raw: string): boolean | number | string {
  const v = raw.trim();
  const lower = v.toLowerCase();
  if (['true', 'on', 'yes'].includes(lower)) return true;
  if (['false', 'off', 'no'].includes(lower)) return false;
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

/** Format a DPT main/sub pair into the "5.001" string the backend expects. */
export function formatDpt(main?: number | null, sub?: number | null): string {
  if (main == null) return '';
  return sub == null ? String(main) : `${main}.${String(sub).padStart(3, '0')}`;
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

/** Status of the (single) delayed/cyclic send job, as returned by the backend. */
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

export async function getScheduledSendStatus(): Promise<ScheduledSendStatus> {
  const res = await fetch(apiUrl('/api/knx/send/scheduled/status'));
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<ScheduledSendStatus>;
}

export function cancelScheduledSend(): Promise<unknown> {
  return post('/api/knx/send/scheduled/cancel');
}
