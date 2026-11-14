/**
 * Merge keys that must stay visible into a filtered list, preserving `all`
 * buffer order and deduping by key. Used so marked (non-hidden) telegrams
 * survive main/quick/focus filters without becoming context anchors.
 */
export function forceIncludeKeys<T>(
  all: readonly T[],
  filtered: readonly T[],
  keyOf: (t: T) => string,
  alwaysKeys: ReadonlySet<string>,
): T[] {
  if (alwaysKeys.size === 0) return filtered as T[];

  const have = new Set(filtered.map(keyOf));
  let need = false;
  for (const k of alwaysKeys) {
    if (!have.has(k)) {
      need = true;
      break;
    }
  }
  if (!need) return filtered as T[];

  const include = new Set(have);
  for (const k of alwaysKeys) include.add(k);

  const seen = new Set<string>();
  const out: T[] = [];
  for (const t of all) {
    const key = keyOf(t);
    if (!include.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
