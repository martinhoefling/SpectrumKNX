/**
 * Named values of KNX DPTs whose payload is at most 4 bits (xknx 4.0.0).
 * DPT 1 is one bit, DPT 2 is that bit plus a control bit, DPT 3 is a
 * direction plus a step code 0–7. Names are the subtype's own words
 * (on/off, true/false, up/down), not a generic boolean.
 */

export type BusPayload =
  | boolean
  | number
  | string
  | { control: boolean; value: string }
  | { control: string; step_code: number };

export interface DiscreteChoice {
  /** Button / option text, title case. */
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

function titleValue(name: string): string {
  return name.replace(/_/g, ' ').replace(/(^|\s)\w/g, letter => letter.toUpperCase());
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
      { label: titleValue(pair[0]), payload: false },
      { label: titleValue(pair[1]), payload: true },
    ];
  }

  if (parsed.main === 2) {
    const pair = DPT2[parsed.sub];
    if (!pair) return null;
    return [false, true].flatMap(control =>
      pair.map(name => ({
        label: control ? `${titleValue(name)} (control)` : titleValue(name),
        payload: { control, value: name },
      })),
    );
  }

  if (parsed.main === 3) {
    const pair = DPT3[parsed.sub];
    if (!pair) return null;
    return pair.flatMap(name =>
      Array.from({ length: 8 }, (_, step) => ({
        label: `${titleValue(name)} ${step}`,
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
  if (hit) return hit.label.toLowerCase();
  if (typeof payload === 'boolean') return payload ? 'on' : 'off';
  if (typeof payload === 'object') return JSON.stringify(payload);
  return String(payload);
}
