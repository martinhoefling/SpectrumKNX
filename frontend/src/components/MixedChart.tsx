import React, { useRef, useLayoutEffect, useState, useMemo } from 'react';
import UplotReact from 'uplot-react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { Lock, LockOpen, ChevronDown, ChevronRight } from 'lucide-react';
import type { ChartBucket } from '../hooks/useChartData';
import { useThemeTick } from '../hooks/useTheme';
import { seriesColor } from '../utils/seriesColors';
import { isSeriesHidden, setSeriesHidden } from '../utils/legendVisibility';
import { spansMultipleDays, formatAxisTime, formatFullTime } from '../utils/timeFormat';

interface MixedChartProps {
  bucket: ChartBucket;
  minTime: number | null;
  maxTime: number | null;
  stepped: boolean;
  /** Draw a dot at each telegram timestamp so cyclic repeats are visible (#195). */
  showDots: boolean;
  /** When true (no active zoom), let the chart re-fit to new data so a telegram
   * that extends the range stays visible instead of falling off a frozen scale
   * (#340). When zoomed, stays false to preserve the app-controlled range (#281). */
  autoFollow?: boolean;
  onZoomRangeChange?: (value: [number, number] | null) => void;
  /** "2/3" when this is one of several charts split off this metric by locking (#349). */
  groupLabel?: string;
  /** Whether this (the unit's currently-open) chart is locked against further GAs (#349). */
  locked?: boolean;
  onToggleLock?: () => void;
  /** Click (not drag-select) on the chart: navigate to the telegram list around
   * this timestamp (#308). */
  onTimeClick?: (ms: number) => void;
}

// Ensure we have a shared sync cursor across all charts
const syncCursor = uPlot.sync('knx-time-axis');
const MIN_GUTTER = 60;
const MAX_GUTTER = 220;

// Reused scratch canvas for text measurement (created lazily, once).
let measureCanvas: HTMLCanvasElement | null = null;

// Widens the y-axis gutter to fit the largest expected tick label instead of a
// fixed guess, so e.g. "30000 lx" isn't clipped at the left edge (#349).
const measureGutterWidth = (series: ChartBucket['series'], unit: string): number => {
  let maxAbs = 0;
  for (const s of series) {
    for (const v of s.data) {
      if (v != null && Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
    }
  }
  const sample = `${Math.ceil(maxAbs).toLocaleString()} ${unit}`;
  measureCanvas ??= document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return MIN_GUTTER + 90;
  ctx.font = '11px sans-serif'; // approximates uPlot's default axis label font
  return Math.min(MAX_GUTTER, Math.max(MIN_GUTTER, Math.ceil(ctx.measureText(sample).width) + 30));
};

export const MixedChart: React.FC<MixedChartProps> = ({
  bucket, minTime, maxTime, stepped, showDots, autoFollow = false, onZoomRangeChange,
  groupLabel, locked, onToggleLock, onTimeClick,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [legendOpen, setLegendOpen] = useState(true);
  const themeTick = useThemeTick();
  // Ref-read inside the stable `ready` hook (same pattern as realIndicesRef
  // below) so a new onTimeClick identity each render doesn't rebuild the chart.
  const onTimeClickRef = useRef(onTimeClick);
  // eslint-disable-next-line react-hooks/refs
  onTimeClickRef.current = onTimeClick;

  // Resize observer to keep chart fluid
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      setWidth(entries[0].contentRect.width);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const { unit, isBinary, timestamps, series } = bucket;
  const leftGutter = useMemo(() => measureGutterWidth(series, unit), [series, unit]);

  // Show a date alongside times once the visible range crosses midnight (#281).
  const multiDay = minTime != null && maxTime != null && spansMultipleDays(minTime, maxTime);

  // Prepare data array: [ [x], [y1], [y2] ]
  // We divide timestamps by 1000 since uPlot expects unix seconds by default
  const data: uPlot.AlignedData = [
    timestamps.map(t => t / 1000),
    ...series.map(s => s.data)
  ];

  // Only the chart's *structure* (size, theme, series identity, unit) should
  // rebuild `options`; a new telegram changes `data`, not `options`, so
  // uplot-react updates via setData instead of destroying and recreating the
  // chart — which would drop the cursor/hover on every telegram (#207).
  const structureKey = [
    width, isBinary, unit, stepped, showDots, themeTick, leftGutter,
    minTime, maxTime,
    series.map(s => `${s.address}~${s.name}`).join('|'),
  ].join('§');

  // Indices (per series) where an actual telegram was received, so dots mark
  // real receipts rather than every forward-filled column (#195). Held in a ref
  // that is refreshed every render, so the points.filter (kept in the stable
  // memoized options for #207) reads live data instead of a stale snapshot.
  const realIndicesRef = useRef<number[][]>([]);
  // Written in render (not an effect) so it is fresh before uPlot's child draw
  // effect runs on this commit; only ever read inside the imperative points
  // filter, never during React render.
  // eslint-disable-next-line react-hooks/refs
  realIndicesRef.current = series.map(s => s.real.flatMap((r, i) => (r ? [i] : [])));

  // Fixed legend (#349): unlike uPlot's native legend, this doesn't move
  // around under the cursor. Each row's value tracks the hovered x-position
  // (or the series' last value while not hovering), and the row whose plotted
  // y-position is nearest the cursor is highlighted so a crowded chart's
  // hovered line is identifiable.
  const legendValueRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const legendRowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const options: uPlot.Options = useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const gridStroke = style.getPropertyValue('--border-subtle').trim();
    const axisStroke = style.getPropertyValue('--text-dim').trim();
    const hoverColor = style.getPropertyValue('--accent-primary').trim() || '#6366f1';

    // Configure Y-Axis scale limits based on smart defaults
    let scaleConfig: uPlot.Scale = {};
    if (!isBinary && (unit === '%' || unit === 'Hz' || unit === 'W')) {
      scaleConfig = {
        auto: true,
        range: (_u, _min, max) => {
          const hardMin = 0;
          return [hardMin, max > hardMin ? max * 1.1 : 100];
        }
      };
    } else if (isBinary) {
      scaleConfig = { auto: false, range: [-0.1, 1.1] };
    }

    return {
      width,
      height: isBinary ? Math.max(150, series.length * 50) : 300,
      padding: [8, 16, 8, 0],
      legend: { show: false }, // replaced by the fixed overlay legend below (#349)
      cursor: {
        sync: { key: syncCursor.key },
        drag: { x: true, y: false, setScale: false }
      },
      hooks: {
        // Record legend show/hide toggles so they survive chart recreation (#192).
        // Use the requested value from `opts.show` rather than reading it back
        // off `u.series[idx].show`, which uPlot only commits after this hook —
        // reading the stale value lagged the store by one click and made the
        // legend appear to need a second click to stick (#205).
        setSeries: [(_u, idx, opts) => {
          if (idx == null || idx === 0 || !('show' in opts)) return;
          const addr = series[idx - 1]?.address;
          if (addr) setSeriesHidden(addr, !opts.show);
        }],
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            const isOutside = u.cursor.left == null || u.cursor.left < 0;
            let nearestIdx = -1;
            let nearestDist = Infinity;
            series.forEach((s, sIdx) => {
              const val = isOutside || idx == null ? s.data[s.data.length - 1] : s.data[idx];
              const el = legendValueRefs.current[sIdx];
              if (el) {
                el.textContent = val == null ? '–' : isBinary ? (val === 1 ? 'On' : 'Off') : `${val} ${unit}`;
              }
              // Nearest-to-cursor row (by plotted y pixel), for the hover highlight.
              if (!isOutside && idx != null && val != null) {
                const yPos = u.valToPos(val, 'y');
                const dist = Math.abs(yPos - (u.cursor.top ?? -Infinity));
                if (dist < nearestDist) { nearestDist = dist; nearestIdx = sIdx; }
              }
            });
            legendRowRefs.current.forEach((row, sIdx) => {
              if (!row) return;
              const hot = !isOutside && sIdx === nearestIdx && nearestDist < 40;
              row.style.background = hot ? `color-mix(in srgb, ${hoverColor} 16%, transparent)` : 'transparent';
              row.style.fontWeight = hot ? '700' : '500';
            });
          }
        ],
        setSelect: [
          (u) => {
            if (u.select.width > 0) {
              const min = u.posToVal(u.select.left, 'x');
              const max = u.posToVal(u.select.left + u.select.width, 'x');
              onZoomRangeChange?.([min * 1000, max * 1000]);
            }
          }
        ],
        ready: [
          (u) => {
            // Click (not drag-select) navigates to the telegram list around this
            // time (#308); a dblclick still resets the zoom. The navigation is
            // delayed past the dblclick window so the first click of a dblclick
            // doesn't fire it before the reset cancels it.
            let clickTimer: ReturnType<typeof setTimeout> | null = null;
            let downX: number | null = null;
            u.over.addEventListener('mousedown', (e) => { downX = e.clientX; });
            u.over.addEventListener('mouseup', (e) => {
              const startX = downX;
              downX = null;
              if (startX === null || Math.abs(e.clientX - startX) >= 5) return;
              const rect = u.over.getBoundingClientRect();
              const ms = u.posToVal(e.clientX - rect.left, 'x') * 1000;
              clickTimer = setTimeout(() => onTimeClickRef.current?.(ms), 250);
            });
            u.over.addEventListener('dblclick', () => {
              if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
              onZoomRangeChange?.(null);
            });
          }
        ]
      },
      scales: {
        x: {
          time: true,
          min: minTime ? minTime / 1000 : undefined,
          max: maxTime ? maxTime / 1000 : undefined,
        },
        y: scaleConfig
      },
      axes: [
        {
          // Wider minimum tick spacing when labels carry a date, so the
          // "MM-DD HH:mm" ticks don't overlap into an unreadable ruler (#314).
          space: multiDay ? 95 : 55,
          grid: { stroke: gridStroke, width: 1 },
          stroke: axisStroke,
          values: (_u, splits) => splits.map(v => formatAxisTime(v * 1000, multiDay))
        },
        {
          space: 30,
          grid: { stroke: gridStroke, width: 1 },
          stroke: axisStroke,
          size: leftGutter,
          values: isBinary
            ? (_u, splits) => splits.map(v => v === 1 ? 'ON' : v === 0 ? 'OFF' : '')
            : undefined
        }
      ],
      series: [
        {
          value: (_u, v) => v == null ? '-' : formatFullTime(v * 1000, multiDay)
        },
        ...series.map((s, sIdx) => ({
          label: s.name,
          show: !isSeriesHidden(s.address),
          stroke: seriesColor(s.address),
          width: 2,
          spanGaps: true,
          paths: (isBinary || stepped) ? uPlot.paths.stepped?.({ align: 1 }) : undefined,
          fill: isBinary ? seriesColor(s.address) + '33' : undefined,
          points: showDots
            ? { show: true, size: 5, space: 0, filter: () => realIndicesRef.current[sIdx] ?? null }
            : { show: false },
          value: (_u: uPlot, v: number | null) => {
            if (v === null) return '-';
            if (isBinary) return v === 1 ? 'On' : 'Off';
            return v + ' ' + unit;
          }
        }))
      ]
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey]);

  return (
    <div style={{ marginBottom: '2rem', background: 'var(--bg-inset)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {isBinary ? 'Binary States (Ein/Aus)' : `Metrics (${unit})`}
          {groupLabel && (
            <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-dim)' }}>{groupLabel}</span>
          )}
        </h4>
        {onToggleLock && (
          <button
            onClick={onToggleLock}
            title={locked
              ? 'Unlock: further selected GAs of this metric will join this chart again'
              : 'Lock: prevent further selected GAs of this metric from crowding this chart — they start a new one instead'}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'transparent',
              border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.25rem 0.5rem',
              fontSize: '0.7rem', cursor: 'pointer',
              color: locked ? 'var(--accent-primary)' : 'var(--text-dim)',
            }}
          >
            {locked ? <Lock size={12} /> : <LockOpen size={12} />}
            {locked ? 'Locked' : 'Lock'}
          </button>
        )}
      </div>
      <div ref={containerRef} style={{ width: '100%', overflow: 'hidden', position: 'relative' }}>
         {/* Re-fit to new data only while not zoomed (#340): keeps a new telegram
             visible instead of dropping off a frozen scale. When the user has
             zoomed, autoFollow is false so the range is preserved (#281). */}
         <UplotReact options={options} data={data} resetScales={autoFollow} />

         {/* Fixed legend (#349): stays put while hovering, unlike uPlot's native
             legend, and shows each GA's value at the hovered x-position. */}
         <div style={{
           position: 'absolute', top: 4, right: 4, zIndex: 10,
           // --bg-inset (and every --bg-* token) is intentionally translucent
           // for this app's glass-panel look, but a plotted line crossing
           // behind a legend row at the same height reads badly through it —
           // --bg-dark is the one fully opaque token, used here instead.
           background: 'var(--bg-dark)',
           boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
           border: '1px solid var(--border-color)', borderRadius: '6px',
           maxWidth: '55%', pointerEvents: 'auto',
         }}>
           <button
             onClick={() => setLegendOpen(o => !o)}
             style={{
               display: 'flex', alignItems: 'center', gap: '0.25rem', width: '100%',
               background: 'transparent', border: 'none', cursor: 'pointer',
               padding: '0.25rem 0.4rem', fontSize: '0.65rem', color: 'var(--text-dim)',
             }}
           >
             {legendOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
             {series.length} GA{series.length !== 1 ? 's' : ''}
           </button>
           {legendOpen && (
             <div style={{ maxHeight: '160px', overflowY: 'auto', padding: '0 0.4rem 0.35rem' }}>
               {series.map((s, sIdx) => (
                 <div
                   key={s.address}
                   ref={el => { legendRowRefs.current[sIdx] = el; }}
                   style={{
                     display: 'flex', alignItems: 'center', gap: '0.35rem',
                     padding: '0.15rem 0.3rem', borderRadius: '4px', fontSize: '0.68rem',
                     transition: 'background 0.1s',
                   }}
                 >
                   <span style={{ width: 8, height: 8, borderRadius: '50%', background: seriesColor(s.address), flexShrink: 0 }} />
                   <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-main)' }} title={s.name}>
                     {s.name}
                   </span>
                   <span
                     ref={el => { legendValueRefs.current[sIdx] = el; }}
                     style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}
                   >
                     {s.data[s.data.length - 1] == null ? '–' : isBinary ? (s.data[s.data.length - 1] === 1 ? 'On' : 'Off') : `${s.data[s.data.length - 1]} ${unit}`}
                   </span>
                 </div>
               ))}
             </div>
           )}
         </div>
      </div>
      {/* Always spell out the visible window's start and end, so the range is
          readable even when the axis ticks are sparse or zoomed out (#314). */}
      {minTime != null && maxTime != null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.35rem', paddingLeft: `${leftGutter}px`, paddingRight: '16px', fontSize: '0.7rem', color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
          <span>{formatFullTime(minTime, multiDay)}</span>
          <span>{formatFullTime(maxTime, multiDay)}</span>
        </div>
      )}
    </div>
  );
};
