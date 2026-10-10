import type { ChartBucket } from '../hooks/useChartData';

// Left gutter of the visualization charts: the space before the plot area that
// holds the y-axis tick labels (metric charts) or the GA name labels (binary
// timeline, events).
//
// Every chart on screen must reserve the same gutter, or their time axes start
// at different horizontal positions and one instant no longer lines up down
// the page — the shared hover line appears to jump between charts. Idea ported
// from the devTabSel fork.

const MIN_GUTTER = 60;
const MAX_GUTTER = 220;

/** Gutter of the binary timeline and events charts: room for their GA labels. */
export const LABEL_GUTTER = 150;

type Measure = (text: string) => number | null;

// Reused scratch canvas for text measurement (created lazily, once).
let measureCanvas: HTMLCanvasElement | null = null;

const measureTickLabel: Measure = text => {
  measureCanvas ??= document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return null;
  ctx.font = '11px sans-serif'; // approximates uPlot's default axis label font
  return ctx.measureText(text).width;
};

/**
 * Gutter a metric chart needs on its own: wide enough for its largest y-axis
 * tick label instead of a fixed guess, so e.g. "30000 lx" isn't clipped (#349).
 */
export function metricGutterWidth(series: ChartBucket['series'], unit: string, measure: Measure = measureTickLabel): number {
  let maxAbs = 0;
  for (const s of series) {
    for (const v of s.data) {
      if (v != null && Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
    }
  }
  const width = measure(`${Math.ceil(maxAbs).toLocaleString()} ${unit}`);
  if (width == null) return MIN_GUTTER + 90;
  return Math.min(MAX_GUTTER, Math.max(MIN_GUTTER, Math.ceil(width) + 30));
}

/** Gutter one chart needs on its own. */
export function gutterWidthFor(bucket: ChartBucket, measure: Measure = measureTickLabel): number {
  return bucket.isBinary || bucket.isEvents ? LABEL_GUTTER : metricGutterWidth(bucket.series, bucket.unit, measure);
}

/**
 * The one gutter all charts currently on screen share: the widest any of them
 * needs. `measure` is injectable so this is testable without a canvas.
 */
export function sharedLeftGutter(buckets: ChartBucket[], measure: Measure = measureTickLabel): number {
  let widest = 0;
  for (const bucket of buckets) widest = Math.max(widest, gutterWidthFor(bucket, measure));
  return widest;
}
