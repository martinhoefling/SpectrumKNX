/**
 * Named values of KNX DPTs whose payload is at most 4 bits (xknx 4.0.0).
 * DPT 1 is one bit, DPT 2 is that bit plus a control bit, DPT 3 is a
 * direction plus a step code 0–7. Names are the subtype's own words
 * (on/off, true/false, up/down), not a generic boolean.
 */

import { isTextDptMain, textDptCharWidth } from './knxSend';

export type BusPayload =
  | boolean
  | number
  | string
  | { control: boolean; value: string }
  | { control: string; step_code: number };

export interface DiscreteChoice {
  /** Button / option text, lowercase like the telegram list. */
  label: string;
  payload: BusPayload;
}

/** [value 0, value 1] for each 1-bit subtype. */
const DPT1: Record<number, [string, string]> = {
  1: ['off', 'on'],
  2: ['false', 'true'],
  3: ['disable', 'enable'],
  4: ['no_ramp', 'ramp'],
  5: ['no_alarm', 'alarm'],
  6: ['low', 'high'],
  7: ['decrease', 'increase'],
  8: ['up', 'down'],
  9: ['open', 'close'],
  10: ['stop', 'start'],
  11: ['inactive', 'active'],
  12: ['not_inverted', 'inverted'],
  13: ['start_stop', 'cyclically'],
  14: ['fixed', 'calculated'],
  15: ['no_action', 'reset'],
  16: ['no_action', 'acknowledge'],
  17: ['trigger_0', 'trigger'],
  18: ['not_occupied', 'occupied'],
  19: ['closed', 'open'],
  21: ['or', 'and'],
  22: ['scene_a', 'scene_b'],
  23: ['up_down_mode', 'step_stop_mode'],
  24: ['day', 'night'],
  100: ['cool', 'heat'],
  1200: ['consumer', 'producer'],
  1201: ['positive', 'negative'],
};

/** Value bit of each 2-bit controlled subtype. 2.009 is up/down, not open/close. */
const DPT2: Record<number, [string, string]> = {
  1: ['off', 'on'],
  2: ['false', 'true'],
  3: ['disable', 'enable'],
  4: ['no_ramp', 'ramp'],
  5: ['no_alarm', 'alarm'],
  6: ['low', 'high'],
  7: ['decrease', 'increase'],
  8: ['up', 'down'],
  9: ['up', 'down'],
  10: ['stop', 'start'],
  11: ['inactive', 'active'],
  12: ['not_inverted', 'inverted'],
};

/** Direction of each 4-bit control subtype; the step code is 0–7. */
const DPT3: Record<number, [string, string]> = {
  7: ['decrease', 'increase'],
  8: ['up', 'down'],
};

/** Underscores → spaces; keep lowercase for list/button parity with the backend. */
function displayName(name: string): string {
  return name.replace(/_/g, ' ').toLowerCase();
}

function parseDptKey(dptKey: string): { main: number; sub?: number } | null {
  const match = dptKey.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  return { main: Number(match[1]), sub: match[2] !== undefined ? Number(match[2]) : undefined };
}

function samePayload(a: BusPayload, b: BusPayload): boolean {
  if (typeof a !== 'object' || typeof b !== 'object' || a == null || b == null) return a === b;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(key => (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key]);
}

/**
 * One choice per legal value, in DPT order (bit 0, then bit 1).
 * Null when this DPT is not a ≤4-bit type with a known vocabulary.
 */
export function discreteDptValues(dptKey?: string | null): DiscreteChoice[] | null {
  if (!dptKey) return null;
  const parsed = parseDptKey(dptKey);
  if (!parsed || parsed.sub == null) return null;

  if (parsed.main === 1) {
    const pair = DPT1[parsed.sub];
    if (!pair) return null;
    return [
      { label: displayName(pair[0]), payload: false },
      { label: displayName(pair[1]), payload: true },
    ];
  }

  if (parsed.main === 2) {
    const pair = DPT2[parsed.sub];
    if (!pair) return null;
    return [false, true].flatMap(control =>
      pair.map(name => ({
        label: control ? `${displayName(name)} (control)` : displayName(name),
        payload: { control, value: name },
      })),
    );
  }

  if (parsed.main === 3) {
    const pair = DPT3[parsed.sub];
    if (!pair) return null;
    return pair.flatMap(name =>
      Array.from({ length: 8 }, (_, step) => ({
        label: `${displayName(name)} ${step}`,
        payload: { control: name, step_code: step },
      })),
    );
  }

  return null;
}

/** Words for a sent payload, matching the value shown in the telegram list. */
export function describeBusPayload(payload: BusPayload, dptKey?: string | null): string {
  const choices = discreteDptValues(dptKey);
  const hit = choices?.find(choice => samePayload(choice.payload, payload));
  if (hit) return hit.label;
  if (typeof payload === 'boolean') return payload ? 'on' : 'off';
  if (typeof payload === 'object') return JSON.stringify(payload);
  return String(payload);
}

export interface BusValueView {
  value_formatted?: string | null;
  value_numeric?: number | null;
  value_json?: Record<string, unknown> | null;
  raw_hex?: string | null;
  unit?: string | null;
}

/** Map a bus/telegram value onto the same words the send buttons use for this DPT. */
function coerceBit(value: BusValueView): boolean | null {
  if (value.value_numeric === 0 || value.value_numeric === 1) return value.value_numeric === 1;
  const raw = (value.value_formatted ?? '').trim().toLowerCase().replace(/_/g, ' ');
  if (!raw) return null;
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  if (raw === '1' || raw === 'true' || raw === 'on') return true;
  return null;
}

function rawNibble(value: BusValueView): number | null {
  if (typeof value.value_numeric === 'number' && Number.isFinite(value.value_numeric)) {
    return Math.trunc(value.value_numeric) & 0xff;
  }
  const hex = (value.raw_hex ?? '').trim().toLowerCase().replace(/^0x/, '');
  if (/^[0-9a-f]+$/.test(hex)) {
    const n = Number.parseInt(hex, 16);
    return Number.isFinite(n) ? (n & 0xff) : null;
  }
  const formatted = (value.value_formatted ?? '').trim();
  if (/^\d+$/.test(formatted)) return Number.parseInt(formatted, 10) & 0xff;
  return null;
}

function payloadFromJson(json: Record<string, unknown> | null | undefined): BusPayload | null {
  if (!json || typeof json !== 'object') return null;
  if ('step_code' in json && 'control' in json) {
    return { control: String(json.control), step_code: Number(json.step_code) };
  }
  if ('value' in json && 'control' in json && typeof json.control === 'boolean') {
    return { control: json.control, value: String(json.value) };
  }
  return null;
}

/**
 * Display text (+ optional unit) for a last-seen / bus value under an effective DPT.
 * Discrete ≤4-bit DPTs use the same lowercase words as the send buttons; other
 * DPTs keep value_formatted / numeric / hex and the telegram unit.
 */
export function formatBusValueForDpt(
  value: BusValueView,
  dptKey?: string | null,
): { text: string; unit: string } {
  const choices = discreteDptValues(dptKey);
  const parsed = dptKey ? parseDptKey(dptKey) : null;
  const textDpt = isTextDptMain(parsed?.main);
  // Text DPTs keep leading/trailing spaces; other DPTs still trim labels.
  const rawFormatted = value.value_formatted ?? '';
  const formatted = textDpt ? rawFormatted : rawFormatted.trim();
  const formattedKey = formatted.trim().toLowerCase().replace(/_/g, ' ');

  if (choices && choices.length > 0) {
    const fromJson = payloadFromJson(value.value_json ?? undefined);
    if (fromJson) {
      const hit = choices.find(c => samePayload(c.payload, fromJson));
      if (hit) return { text: hit.label, unit: '' };
    }

    const byLabel = choices.find(c => c.label === formattedKey);
    if (byLabel) return { text: byLabel.label, unit: '' };

    if (parsed?.main === 1 && choices.length === 2) {
      const bit = coerceBit(value);
      if (bit != null) return { text: choices[bit ? 1 : 0].label, unit: '' };
    }

    if (parsed?.main === 2 && parsed.sub != null) {
      const pair = DPT2[parsed.sub];
      const n = rawNibble(value);
      if (pair && n != null) {
        const valueBit = (n & 1) !== 0;
        const control = (n & 2) !== 0;
        const name = pair[valueBit ? 1 : 0];
        const label = control ? `${displayName(name)} (control)` : displayName(name);
        return { text: label, unit: '' };
      }
    }

    if (parsed?.main === 3 && parsed.sub != null) {
      const pair = DPT3[parsed.sub];
      const n = rawNibble(value);
      if (pair && n != null) {
        const step = n & 7;
        const dir = pair[(n & 8) !== 0 ? 1 : 0];
        return { text: `${displayName(dir)} ${step}`, unit: '' };
      }
    }
  }

  if (parsed?.main === 1 && parsed.sub == null) {
    const bit = coerceBit(value);
    if (bit != null) return { text: bit ? 'on' : 'off', unit: '' };
  }

  let text = formatted
    || (value.value_numeric != null ? String(value.value_numeric) : '')
    || value.raw_hex
    || '—';
  if (textDpt && text !== '—') {
    const width = textDptCharWidth(parsed?.main);
    if (width != null) text = text.padEnd(width, ' ').slice(0, width);
  }
  const unit = text === '—' ? '' : (value.unit ?? '').trim();
  return { text, unit };
}
