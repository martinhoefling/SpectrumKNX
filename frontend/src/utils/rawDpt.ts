/**
 * Client-side decoding of raw KNX payload bytes for group addresses that have
 * no datatype in the ETS project (#315).
 *
 * Such telegrams reach the frontend as an array of payload bytes in
 * `value_json` (e.g. `[0x0c, 0x1a]`) with no decoded numeric value, so the
 * visualization can't plot them. Letting the user pick a datatype lets us
 * interpret those bytes into a number here, without a project re-import.
 *
 * Only the datatypes that decode to a single plottable number are offered.
 */

export interface RawDptOption {
  /** Stable key persisted per group address. */
  key: string;
  /** Dropdown label. */
  label: string;
  /** Physical unit for bucketing/axis, or '' when dimensionless. */
  unit: string;
  /** Expected payload width in bytes; a mismatch decodes to null. */
  bytes: number;
}

/** Datatypes offered for an untyped GA, in menu order. */
export const RAW_DPT_OPTIONS: RawDptOption[] = [
  { key: '5', label: '5 · 8-bit unsigned (0–255)', unit: '', bytes: 1 },
  { key: '5.001', label: '5.001 · Percent (0–100%)', unit: '%', bytes: 1 },
  { key: '5.004', label: '5.004 · Percent (0–255%)', unit: '%', bytes: 1 },
  { key: '6', label: '6 · 8-bit signed (−128–127)', unit: '', bytes: 1 },
  { key: '7', label: '7 · 2-byte unsigned', unit: '', bytes: 2 },
  { key: '8', label: '8 · 2-byte signed', unit: '', bytes: 2 },
  { key: '9', label: '9 · 2-byte float', unit: '', bytes: 2 },
  { key: '12', label: '12 · 4-byte unsigned', unit: '', bytes: 4 },
  { key: '13', label: '13 · 4-byte signed', unit: '', bytes: 4 },
  { key: '14', label: '14 · 4-byte float', unit: '', bytes: 4 },
];

const OPTION_BY_KEY = new Map(RAW_DPT_OPTIONS.map(o => [o.key, o]));

/** The physical unit a decoded value should be bucketed/labelled under. */
export const rawDptUnit = (key: string): string => OPTION_BY_KEY.get(key)?.unit ?? '';

/** Decodes the KNX 2-byte float (DPT 9) format from two bytes. */
const decodeKnxFloat16 = (b0: number, b1: number): number => {
  const data = ((b0 << 8) | b1) & 0xffff;
  const exponent = (data & 0x7800) >> 11;
  // 11-bit mantissa in two's complement (the high bit is the sign).
  let mantissa = data & 0x07ff;
  if (data & 0x8000) mantissa -= 2048;
  return 0.01 * mantissa * Math.pow(2, exponent);
};

/**
 * Decodes raw payload bytes into a plottable number for the chosen datatype,
 * or null when the datatype is unknown or the width does not match.
 */
export function decodeRawDpt(bytes: readonly number[], key: string): number | null {
  const opt = OPTION_BY_KEY.get(key);
  if (!opt || bytes.length !== opt.bytes) return null;
  if (bytes.some(b => !Number.isInteger(b) || b < 0 || b > 255)) return null;

  const view = new DataView(new Uint8Array(bytes).buffer);
  switch (key) {
    case '5':
      return view.getUint8(0);
    case '5.001':
      return (view.getUint8(0) * 100) / 255;
    case '5.004':
      return view.getUint8(0); // percent on a 0–255 scale: the raw byte is the value
    case '6':
      return view.getInt8(0);
    case '7':
      return view.getUint16(0, false);
    case '8':
      return view.getInt16(0, false);
    case '9':
      return decodeKnxFloat16(bytes[0], bytes[1]);
    case '12':
      return view.getUint32(0, false);
    case '13':
      return view.getInt32(0, false);
    case '14':
      return view.getFloat32(0, false);
    default:
      return null;
  }
}
