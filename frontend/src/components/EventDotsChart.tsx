import React, { useRef, useLayoutEffect, useState, useMemo } from 'react';
import UplotReact from 'uplot-react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { ChartBucket } from '../hooks/useChartData';
import { useThemeTick } from '../hooks/useTheme';
import { seriesColor } from '../utils/seriesColors';
import { spansMultipleDays, formatAxisTime, formatFullTime } from '../utils/timeFormat';

interface EventDotsChartProps {
  bucket: ChartBucket;
  minTime: number | null;
  maxTime: number | null;
  autoFollow?: boolean;
  onZoomRangeChange?: (value: [number, number] | null) => void;
  /** Click (not drag-select) on the chart: navigate to the telegram list around
   * this timestamp (#308). */
  onTimeClick?: (ms: number) => void;
}

const syncCursor = uPlot.sync('knx-time-axis');

/**
 * Discrete event dots for GAs that never resolve to a number or boolean —
 * text (DPT16) and other unchartable/complex payloads — grouped in one lane
 * group like the binary timeline (#341). Each dot is a standalone occurrence
 * (no forward-fill/held state); its tooltip/legend shows the telegram's
 * formatted value.
 */
export const EventDotsChart: React.FC<EventDotsChartProps> = ({ bucket, minTime, maxTime, autoFollow = false, onZoomRangeChange, onTimeClick }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const themeTick = useThemeTick();
  const valueRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Ref-read inside the stable draw/cursor plugins (same pattern as the other
  // charts) so live data/callback updates don't force a chart rebuild.
  const realRef = useRef<boolean[][]>([]);
  // eslint-disable-next-line react-hooks/refs
  realRef.current = bucket.series.map(s => s.real);
  const labelsRef = useRef<(string | null)[][]>([]);
  // eslint-disable-next-line react-hooks/refs
  labelsRef.current = bucket.series.map(s => s.labels ?? []);
  const onTimeClickRef = useRef(onTimeClick);
  // eslint-disable-next-line react-hooks/refs
  onTimeClickRef.current = onTimeClick;

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      setWidth(entries[0].contentRect.width);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const { series, timestamps } = bucket;
  const data: uPlot.AlignedData = [
    timestamps.map(t => t / 1000),
    ...series.map(s => s.data)
  ];

  const multiDay = minTime != null && maxTime != null && spansMultipleDays(minTime, maxTime);
  const LEFT_GUTTER = 150;

  const rowHeight = 32;
  const rowGap = 4;
  // The bottom time axis + chart padding reserve a fixed amount of vertical
  // space regardless of content, so a generous floor is needed here or the
  // actual plot area (uPlot's bbox) can shrink to a sliver — the draw plugin
  // below still positions rows from the *real* bbox height, not this value,
  // but the row/legend heights on our own side need enough room to show in.
  const chartHeight = Math.max(160, series.length * (rowHeight + rowGap) + 60);

  const structureKey = [
    width, themeTick, minTime, maxTime, series.map(s => s.name).join('|'),
  ].join('§');

  const options: uPlot.Options = useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const gridStroke = style.getPropertyValue('--border-subtle').trim();
    const axisStroke = style.getPropertyValue('--text-dim').trim();
    const dotOutline = style.getPropertyValue('--bg-inset').trim();

    const eventsPlugin = () => ({
      hooks: {
        draw: [(u: uPlot) => {
          const { ctx } = u;
          const { left, top, width, height } = u.bbox;

          ctx.save();
          ctx.beginPath();
          ctx.rect(left, top, width, height);
          ctx.clip();

          const xs = u.data[0];
          const seriesCount = u.data.length - 1;
          // Row positions are derived from uPlot's *actual* plot area (bbox),
          // not a value computed independently on our side — the bottom time
          // axis + padding reserve a fixed amount of space regardless of the
          // container height, so a row position computed from a static offset
          // can land outside the real (and clipped) plot rect for a small
          // series count, silently drawing nothing.
          const rowSlot = seriesCount > 0 ? height / seriesCount : height;

          for (let sIdx = 0; sIdx < seriesCount; sIdx++) {
            const yMid = top + sIdx * rowSlot + rowSlot / 2;
            const color = seriesColor(series[sIdx]?.address ?? String(sIdx));

            // Baseline for the row, so an empty stretch still reads as "this GA's lane".
            ctx.strokeStyle = gridStroke;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(left, yMid);
            ctx.lineTo(left + width, yMid);
            ctx.stroke();

            const real = realRef.current[sIdx];
            for (let i = 0; i < xs.length; i++) {
              if (!real?.[i]) continue;
              const x = u.valToPos(xs[i], 'x', true);
              ctx.beginPath();
              ctx.arc(x, yMid, 4.5, 0, Math.PI * 2);
              ctx.fillStyle = color;
              ctx.fill();
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = dotOutline;
              ctx.stroke();
            }
          }

          ctx.restore();
        }]
      }
    });

    return {
      width,
      height: chartHeight,
      padding: [10, 16, 30, 0],
      cursor: {
        sync: { key: syncCursor.key },
        drag: { x: true, y: false, setScale: false }
      },
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            const isOutside = u.cursor.left == null || u.cursor.left < 0;
            series.forEach((_s, sIdx) => {
              const el = valueRefs.current[sIdx];
              if (!el) return;
              const labels = labelsRef.current[sIdx] ?? [];
              // While hovering, show the label at the cursor column only if
              // this row actually had an event there; otherwise fall back to
              // its last known label (matching the other charts' hover UX).
              const hoverLabel = !isOutside && idx != null ? labels[idx] : null;
              const lastLabel = [...labels].reverse().find(l => l != null) ?? null;
              const text = hoverLabel ?? lastLabel;
              el.textContent = text ?? '–';
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
      plugins: [eventsPlugin()],
      scales: {
        x: {
          time: true,
          min: minTime ? minTime / 1000 : undefined,
          max: maxTime ? maxTime / 1000 : undefined,
        },
        y: { auto: false, range: [0, 1] }
      },
      axes: [
        {
          space: multiDay ? 95 : 55,
          stroke: axisStroke,
          grid: { stroke: gridStroke },
          values: (_u, splits) => splits.map(v => formatAxisTime(v * 1000, multiDay))
        },
        {
          show: true,
          stroke: axisStroke,
          grid: { stroke: gridStroke },
          size: LEFT_GUTTER,
          values: () => []
        }
      ],
      series: [
        {
          value: (_u, v) => v == null ? '-' : formatFullTime(v * 1000, multiDay)
        },
        ...series.map((s) => ({
          label: s.name,
          show: false,
        }))
      ]
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey]);

  const plotTop = 10;
  return (
    <div style={{ marginBottom: '2rem', background: 'var(--bg-inset)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'visible' }}>
      <h4 style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--text-main)' }}>
        Events (unchartable values)
      </h4>
      <div style={{ position: 'relative', width: '100%' }}>
        {/* HTML Legend Overlay on the left */}
        <div style={{
          position: 'absolute',
          left: '8px',
          top: `${plotTop + rowGap}px`,
          width: `${LEFT_GUTTER - 16}px`,
          height: `${chartHeight - plotTop - 30}px`,
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: 'none',
          zIndex: 10,
        }}>
          {series.map((s, sIdx) => {
            const labels = s.labels ?? [];
            const lastLabel = [...labels].reverse().find(l => l != null) ?? null;
            return (
              <div
                key={s.address}
                style={{
                  height: `${rowHeight}px`,
                  marginBottom: `${rowGap}px`,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  fontSize: '0.75rem',
                  lineHeight: '1.2',
                }}
              >
                <div style={{
                  fontWeight: 600,
                  color: 'var(--text-main)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }} title={s.name}>
                  {s.name}
                </div>
                <div
                  ref={el => { valueRefs.current[sIdx] = el; }}
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    color: 'var(--text-dim)',
                    marginTop: '2px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={lastLabel ?? undefined}
                >
                  {lastLabel ?? '–'}
                </div>
              </div>
            );
          })}
        </div>
        <div ref={containerRef} style={{ width: '100%', overflow: 'visible' }}>
           <UplotReact options={options} data={data} resetScales={autoFollow} />
        </div>
      </div>
      {minTime != null && maxTime != null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.35rem', paddingLeft: `${LEFT_GUTTER}px`, paddingRight: '16px', fontSize: '0.7rem', color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
          <span>{formatFullTime(minTime, multiDay)}</span>
          <span>{formatFullTime(maxTime, multiDay)}</span>
        </div>
      )}
    </div>
  );
};
