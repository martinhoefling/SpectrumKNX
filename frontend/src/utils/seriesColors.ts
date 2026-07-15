// Palette for chart series lines (distinct, works on light and dark themes).
const COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#eab308', // yellow
  '#22c55e', // green
  '#a855f7', // purple
  '#f97316', // orange
  '#14b8a6', // teal
];

const assigned = new Map<string, string>();

/**
 * Stable color per group address (#197): assigned on first use and kept for
 * the session, so toggling target visibility never recolors other lines.
 */
export function seriesColor(address: string): string {
  let color = assigned.get(address);
  if (!color) {
    color = COLORS[assigned.size % COLORS.length];
    assigned.set(address, color);
  }
  return color;
}
