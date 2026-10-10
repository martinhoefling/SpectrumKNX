import { getPref, setPref } from './prefs';

// Column order of the telegram list, changed by dragging a column header
// (ported from the devTabSel fork). Stored as a list of column ids.

const COLUMN_ORDER_PREF = 'columnOrder';

/**
 * A stored order made safe against the current column set: unknown ids are
 * dropped, duplicates collapse, and columns the stored order does not know yet
 * (added in a later version) are put back at their default position relative
 * to the columns before them.
 */
export function normalizeColumnOrder(stored: unknown, defaults: readonly string[]): string[] {
  const known = new Set(defaults);
  const order: string[] = [];
  if (Array.isArray(stored)) {
    for (const id of stored) {
      if (typeof id === 'string' && known.has(id) && !order.includes(id)) order.push(id);
    }
  }
  defaults.forEach((id, i) => {
    if (order.includes(id)) return;
    // After the nearest preceding default column that is already placed.
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = order.indexOf(defaults[j]);
      if (k !== -1) { at = k + 1; break; }
    }
    order.splice(at, 0, id);
  });
  return order;
}

/** `order` with `dragged` moved directly before or after `target`. */
export function moveColumn(order: readonly string[], dragged: string, target: string, side: 'before' | 'after'): string[] {
  if (dragged === target || !order.includes(dragged) || !order.includes(target)) return [...order];
  const next = order.filter(id => id !== dragged);
  const at = next.indexOf(target) + (side === 'after' ? 1 : 0);
  next.splice(at, 0, dragged);
  return next;
}

export function readColumnOrderPref(defaults: readonly string[]): string[] {
  try {
    const saved = getPref(COLUMN_ORDER_PREF);
    if (saved) return normalizeColumnOrder(JSON.parse(saved), defaults);
  } catch {
    // Ignore a malformed stored value
  }
  return [...defaults];
}

export function writeColumnOrderPref(order: readonly string[]): void {
  setPref(COLUMN_ORDER_PREF, JSON.stringify(order));
}
