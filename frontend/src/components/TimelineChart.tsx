import React, { useRef, useLayoutEffect, useState, useMemo } from 'react';
import UplotReact from 'uplot-react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { ChartBucket } from '../hooks/useChartData';
import { useThemeTick } from '../hooks/useTheme';
import { spansMultipleDays, formatAxisTime, formatFullTime } from '../utils/timeFormat';

interface TimelineChartProps {
  bucket: ChartBucket;
  minTime: number | null;
  maxTime: number | null;
  /** Draw a tick at each telegram timestamp so cyclic repeats are visible (#195). */
  showDots: boolean;
  /** When true (no active zoom), let the chart re-fit to new data so a telegram
   * that extends the range stays visible instead of falling off a frozen scale
   * (#340). When zoomed, stays false to preserve the app-controlled range (#281). */
  autoFollow?: boolean;
  onZoomRangeChange?: (value: [number, number] | null) => void;
}

const syncCursor = uPlot.sync('knx-time-axis');

export const TimelineChart: React.FC<TimelineChartProps> = ({ bucket, minTime, maxTime, showDots, autoFollow = false, onZoomRangeChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const themeTick = useThemeTick();
  const valueRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Per-series real-telegram flags, refreshed every render and read from the
  // (stable, memoized) draw plugin so dots stay correct on live updates (#195/#207).
  // Written in render so it is fresh before uPlot's child draw effect on this
  // commit; only ever read inside the imperative draw plugin, never in render.
  const realRef = useRef<boolean[][]>([]);
  // eslint-disable-next-line react-hooks/refs
  realRef.current = bucket.series.map(s => s.real);

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

  // Show a date alongside times once the visible range crosses midnight (#281).
  const multiDay = minTime != null && maxTime != null && spansMultipleDays(minTime, maxTime);
  const LEFT_GUTTER = 150;

  const rowHeight = 40;
  const rowGap = 4;
  const chartHeight = series.length * (rowHeight + rowGap) + 60;

  // Rebuild `options` only on structural changes (size, theme, series identity),
  // never on data — so a new telegram updates the chart via setData rather than
  // recreating it, keeping the cursor/hover alive (#207). The draw plugin below
  // therefore reads timestamps/values from `u.data`, not from this closure.
  const structureKey = [
    width, themeTick, showDots, minTime, maxTime, series.map(s => s.name).join('|'),
  ].join('§');

  const options: uPlot.Options = useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const gridStroke = style.getPropertyValue('--border-subtle').trim();
    const axisStroke = style.getPropertyValue('--text-dim').trim();

    const timelinePlugin = () => ({
      hooks: {
        draw: [(u: uPlot) => {
          const { ctx } = u;
          const { left, top, width, height } = u.bbox;

          ctx.save();
          ctx.beginPath();
          ctx.rect(left, top, width, height);
          ctx.clip();

          // Read x (seconds) and y from the live uPlot data, not the closure,
          // so the plugin stays correct while `options` is kept stable (#207).
          const xs = u.data[0];
          const seriesCount = u.data.length - 1;

          for (let sIdx = 0; sIdx < seriesCount; sIdx++) {
            const yData = u.data[sIdx + 1];
            const yTop = top + sIdx * (rowHeight + rowGap) + rowGap;

            for (let i = 0; i < xs.length; i++) {
              const val = yData[i];
              if (val === null) continue;

              const xStart = u.valToPos(xs[i], 'x', true);
              let xEnd;
              if (i < xs.length - 1) {
                xEnd = u.valToPos(xs[i + 1], 'x', true);
              } else {
                xEnd = left + width;
              }

              if (xEnd <= xStart) continue;

              const isOn = val === 1;
              ctx.fillStyle = isOn ? '#22c55e' : '#ef4444';
              ctx.fillRect(xStart, yTop, xEnd - xStart, rowHeight);

              if (xEnd - xStart > 40) {
                ctx.fillStyle = 'white';
                ctx.font = 'bold 11px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(isOn ? 'On' : 'Off', xStart + (xEnd - xStart) / 2, yTop + rowHeight / 2);
              }
            }

            // Telegram dots: mark each actual receipt (not forward-filled holds),
            // so cyclic same-value repeats — e.g. a 90 s "server alive" — are
            // visible as ticks along the bar (#195). `real` is read from the ref
            // so it tracks live data while `options` stay stable (#207).
            if (showDots) {
              const real = realRef.current[sIdx];
              const yMid = yTop + rowHeight / 2;
              for (let i = 0; i < xs.length; i++) {
                if (!real?.[i] || yData[i] === null) continue;
                const x = u.valToPos(xs[i], 'x', true);
                ctx.beginPath();
                ctx.arc(x, yMid, 2.5, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.fill();
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(0,0,0,0.55)';
                ctx.stroke();
              }
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
            series.forEach((s, sIdx) => {
              const el = valueRefs.current[sIdx];
              if (!el) return;
              const val = isOutside || idx == null ? s.data[s.data.length - 1] : s.data[idx];
              el.textContent = val === 1 ? 'On' : val === 0 ? 'Off' : '-';
              el.style.color = val === 1 ? '#22c55e' : val === 0 ? '#ef4444' : 'var(--text-dim)';
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
            u.over.addEventListener('dblclick', () => {
              onZoomRangeChange?.(null);
            });
          }
        ]
      },
      plugins: [timelinePlugin()],
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
          // Wider tick spacing for the longer "MM-DD HH:mm" labels so the ruler
          // stays readable instead of overlapping when zoomed out (#314).
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
        Binary States Timeline
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
            const lastVal = s.data[s.data.length - 1];
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
                    color: lastVal === 1 ? '#22c55e' : lastVal === 0 ? '#ef4444' : 'var(--text-dim)',
                    marginTop: '2px',
                  }}
                >
                  {lastVal === 1 ? 'On' : lastVal === 0 ? 'Off' : '-'}
                </div>
              </div>
            );
          })}
        </div>
        <div ref={containerRef} style={{ width: '100%', overflow: 'visible' }}>
           {/* Re-fit to new data only while not zoomed (#340): keeps a new telegram
               visible instead of dropping off a frozen scale. When the user has
               zoomed, autoFollow is false so the range is preserved (#281). */}
           <UplotReact options={options} data={data} resetScales={autoFollow} />
        </div>
      </div>
      {/* Always spell out the visible window's start and end (#314). Pad the
          caption to match the plot area boundaries. */}
      {minTime != null && maxTime != null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.35rem', paddingLeft: `${LEFT_GUTTER}px`, paddingRight: '16px', fontSize: '0.7rem', color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
          <span>{formatFullTime(minTime, multiDay)}</span>
          <span>{formatFullTime(maxTime, multiDay)}</span>
        </div>
      )}
    </div>
  );
};
