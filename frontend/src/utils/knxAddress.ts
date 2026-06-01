/**
 * Numerically compares two KNX addresses of the same type.
 * Handles dot-separated PAs (e.g. 1.1.10) and slash-separated GAs
 * with 2 or 3 parts (e.g. 0/1 or 1/2/10).
 */
export function compareKnxAddress(a: string, b: string): number {
  const sep = a.includes('/') ? '/' : '.';
  const aParts = a.split(sep).map(Number);
  const bParts = b.split(sep).map(Number);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
