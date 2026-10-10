import { getPref, setPref } from './prefs';

// Height of a metric chart in the visualization, draggable at its bottom edge
// and remembered per chart (#185).

export const MIN_CHART_HEIGHT = 120;
export const MAX_CHART_HEIGHT = 1200;

const CHART_HEIGHTS_PREF = 'chartHeights';

export const clampChartHeight = (height: number): number =>
  Math.round(Math.min(MAX_CHART_HEIGHT, Math.max(MIN_CHART_HEIGHT, height)));

function readAll(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(getPref(CHART_HEIGHTS_PREF) ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, number>;
  } catch {
    // Ignore a malformed stored value
  }
  return {};
}

/** The height the user gave this chart, or null to use the chart's default. */
export function readChartHeight(key: string): number | null {
  const stored = readAll()[key];
  return typeof stored === 'number' && Number.isFinite(stored) ? clampChartHeight(stored) : null;
}

/** Remembers a chart's height; null forgets it, returning the chart to its default. */
export function writeChartHeight(key: string, height: number | null): void {
  const all = readAll();
  if (height === null) delete all[key];
  else all[key] = clampChartHeight(height);
  setPref(CHART_HEIGHTS_PREF, JSON.stringify(all));
}
