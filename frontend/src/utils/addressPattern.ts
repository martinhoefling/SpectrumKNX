// Comma-ORed address/DPT-key pattern matching for the telegram list's quick
// filter (#309): wildcards (`*` = any whole segment) and ranges (`A-B`) on
// dot- or slash-delimited addresses, e.g. "*.1.*, 1.2.12-1.2.91" (physical),
// "1/5/*, */*/255, 3/1/1-3/1/127" (group), "1.008-1.011, 16.*" (DPT key).

type Matcher = (value: string) => boolean;

const delimiterOf = (s: string): '/' | '.' => (s.includes('/') ? '/' : '.');

/** Converts a dotted/slashed address into one comparable integer, treating
 * each segment as a base-65536 digit (comfortably covers KNX's 16-bit
 * address fields). Returns null for non-numeric segments (e.g. wildcards). */
const toComparable = (addr: string, delim: string): number | null => {
  const parts = addr.split(delim).map(Number);
  if (parts.length === 0 || parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, p) => acc * 65536 + p, 0);
};

const rangeMatcher = (loStr: string, hiStr: string): Matcher | null => {
  const delim = delimiterOf(loStr);
  if (delimiterOf(hiStr) !== delim) return null;
  const lo = toComparable(loStr, delim);
  const hi = toComparable(hiStr, delim);
  if (lo == null || hi == null) return null;
  const [min, max] = lo <= hi ? [lo, hi] : [hi, lo];
  return value => {
    const v = toComparable(value, delim);
    return v != null && v >= min && v <= max;
  };
};

const wildcardMatcher = (pattern: string): Matcher => {
  const delim = delimiterOf(pattern);
  const patSegs = pattern.split(delim);
  return value => {
    const valSegs = value.split(delim);
    if (valSegs.length !== patSegs.length) return false;
    return patSegs.every((p, i) => p === '*' || p === valSegs[i]);
  };
};

const tokenToMatcher = (token: string): Matcher => {
  if (token.includes('-') && !token.includes('*')) {
    const [loStr, hiStr] = token.split('-').map(s => s.trim());
    if (loStr && hiStr) {
      const range = rangeMatcher(loStr, hiStr);
      if (range) return range;
    }
  }
  if (token.includes('*')) return wildcardMatcher(token);
  return value => value === token;
};

/**
 * Builds a matcher for a comma-separated field of address/DPT-key patterns
 * and ranges, ORed together. An empty/whitespace-only pattern imposes no
 * restriction (matches everything) — check `isBlank` before applying it if
 * "no restriction" should instead mean "field inactive".
 */
export function makeAddressPatternMatcher(input: string): Matcher {
  const tokens = input.split(',').map(t => t.trim()).filter(Boolean);
  if (tokens.length === 0) return () => true;
  const matchers = tokens.map(tokenToMatcher);
  return value => matchers.some(m => m(value));
}
