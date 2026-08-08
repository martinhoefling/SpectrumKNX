// VALUE column quick-filter matching for the telegram list (#309): binary
// (`0b…`), hex (`0x…`) and decimal digit patterns with `+` (any single digit)
// and `*` (any run of digits) wildcards, plus quoted-regex/literal text —
// matched against a telegram's raw hex, decimal value, or formatted text.

export interface ValueMatchable {
  value_numeric: number | null;
  raw_hex?: string | null;
  value_formatted?: string | null;
  unit?: string | null;
}

type Matcher = (t: ValueMatchable) => boolean;

/** `+` -> exactly one digit of `digitClass`, `*` -> any run of that digit class. */
const wildcardToRegex = (pattern: string, digitClass: string): RegExp => {
  const body = pattern
    .split('')
    .map(ch => (ch === '+' ? `[${digitClass}]` : ch === '*' ? `[${digitClass}]*` : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${body}$`, 'i');
};

const hexMatcher = (pattern: string): Matcher => {
  const re = wildcardToRegex(pattern.slice(2), '0-9a-fA-F');
  return t => !!t.raw_hex && re.test(t.raw_hex.replace(/^0x/i, ''));
};

const binaryMatcher = (pattern: string): Matcher => {
  const re = wildcardToRegex(pattern.slice(2), '01');
  return t => {
    if (!t.raw_hex) return false;
    const bits = t.raw_hex
      .replace(/^0x/i, '')
      .split('')
      .map(c => parseInt(c, 16).toString(2).padStart(4, '0'))
      .join('');
    return re.test(bits) || re.test(bits.replace(/^0+(?=.)/, ''));
  };
};

const decimalWildcardMatcher = (pattern: string): Matcher => {
  const re = wildcardToRegex(pattern, '0-9');
  return t => t.value_numeric != null && re.test(String(t.value_numeric));
};

const isPlainNumber = (s: string): boolean => /^-?\d+(\.\d+)?$/.test(s);

const regexOrLiteralMatcher = (pattern: string): Matcher => {
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'i');
  } catch {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, ch => (ch === '*' ? '.*' : ch === '+' ? '.' : `\\${ch}`));
    re = new RegExp(`^${escaped}$`, 'i');
  }
  return t => {
    const haystack = [t.value_formatted ?? t.value_numeric ?? '', t.unit, t.raw_hex].filter(Boolean).join(' ');
    return re.test(haystack);
  };
};

/** Parses one VALUE cell entry (a single row's text) into a matcher. */
function parseValueToken(token: string): Matcher {
  if (token.startsWith('"') && token.endsWith('"') && token.length >= 2) {
    return regexOrLiteralMatcher(token.slice(1, -1));
  }
  if (/^0x/i.test(token)) return hexMatcher(token);
  if (/^0b/i.test(token)) return binaryMatcher(token);
  if (/^[\d+*]+$/.test(token) && /\d/.test(token)) return decimalWildcardMatcher(token);
  return regexOrLiteralMatcher(token);
}

/**
 * Builds a matcher from the VALUE cell's two rows. When both rows are plain
 * numbers (no wildcards), they form a numeric range against `value_numeric`;
 * otherwise each non-empty row is parsed as its own pattern and ORed.
 */
export function makeValueMatcher(top: string, bottom: string): Matcher {
  const from = top.trim();
  const to = bottom.trim();
  if (from && to && isPlainNumber(from) && isPlainNumber(to)) {
    const lo = Math.min(Number(from), Number(to));
    const hi = Math.max(Number(from), Number(to));
    return t => t.value_numeric != null && t.value_numeric >= lo && t.value_numeric <= hi;
  }
  const matchers = [from, to].filter(Boolean).map(parseValueToken);
  if (matchers.length === 0) return () => true;
  return t => matchers.some(m => m(t));
}
