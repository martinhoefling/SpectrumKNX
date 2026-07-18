/** Default padding applied to a zero-width time range, per side (ms). */
export const DEGENERATE_RANGE_PAD_MS = 60_000;

/**
 * Widen a zero-width time range so charts get a valid x-scale.
 *
 * A single telegram (or several at the same instant) yields `min === max`,
 * which collapses uPlot's time axis and renders every tick as 00:00 (#239).
 * Pad symmetrically around the point so the axis shows real times.
 */
export function expandDegenerateRange(
  min: number,
  max: number,
  padMs: number = DEGENERATE_RANGE_PAD_MS,
): [number, number] {
  if (max > min) return [min, max];
  return [min - padMs, max + padMs];
}
