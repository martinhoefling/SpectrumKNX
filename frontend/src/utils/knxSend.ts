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

async function post(endpoint: string, body: unknown): Promise<void> {
  const res = await fetch(apiUrl(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.detail) detail = data.detail;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new Error(detail);
  }
}

export function sendTelegram(address: string, payload: unknown, dpt?: string, response = false): Promise<void> {
  return post('/api/knx/send', { address, payload, dpt: dpt || null, response });
}

export function readTelegram(address: string): Promise<void> {
  return post('/api/knx/read', { address });
}
