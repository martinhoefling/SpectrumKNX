import React, { useRef, useLayoutEffect, useState, useMemo } from 'react';
import UplotReact from 'uplot-react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { ChartBucket } from '../hooks/useChartData';
import { useThemeTick } from '../hooks/useTheme';

interface TimelineChartProps {
  bucket: ChartBucket;
  minTime: number | null;
  maxTime: number | null;
}

const syncCursor = uPlot.sync('knx-time-axis');

export const TimelineChart: React.FC<TimelineChartProps> = ({ bucket }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const themeTick = useThemeTick();

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

  const rowHeight = 40;
  const rowGap = 4;
  const chartHeight = series.length * (rowHeight + rowGap) + 60;

  // Rebuild `options` only on structural changes (size, theme, series identity),
  // never on data — so a new telegram updates the chart via setData rather than
  // recreating it, keeping the cursor/hover alive (#207). The draw plugin below
  // therefore reads timestamps/values from `u.data`, not from this closure.
  const structureKey = [
    width, themeTick, series.map(s => s.name).join('|'),
  ].join('§');

  const options: uPlot.Options = useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const gridStroke = style.getPropertyValue('--border-subtle').trim();
    const axisStroke = style.getPropertyValue('--text-dim').trim();
    const accentPrimary = style.getPropertyValue('--accent-primary').trim();

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
          }

          ctx.restore();

          // Series labels (structural: names come from the closure, count from data).
          for (let sIdx = 0; sIdx < seriesCount; sIdx++) {
            const yTop = top + sIdx * (rowHeight + rowGap) + rowGap;
            ctx.fillStyle = accentPrimary;
            ctx.font = '600 12px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(series[sIdx]?.name ?? '', left + width + 15, yTop + rowHeight / 2);
          }
        }]
      }
    });

    return {
      width,
      height: chartHeight,
      padding: [0, 180, 0, 0],
      cursor: { sync: { key: syncCursor.key } },
      plugins: [timelinePlugin()],
      scales: {
        x: { time: true },
        y: { auto: false, range: [0, 1] }
      },
      axes: [
        {
          space: 50,
          stroke: axisStroke,
          grid: { stroke: gridStroke },
          values: (_u, splits) => splits.map(v =>
            new Date(v * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
          )
        },
        {
          show: true,
          stroke: axisStroke,
          grid: { stroke: gridStroke },
          size: 1,
          values: () => []
        }
      ],
      series: [
        {
          value: (_u, v) => v == null ? '-' : new Date(v * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
        },
        ...series.map((s) => ({
          label: s.name,
          show: false,
        }))
      ]
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey]);

  return (
    <div style={{ marginBottom: '2rem', background: 'var(--bg-inset)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'visible' }}>
      <h4 style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--text-main)' }}>
        Binary States Timeline
      </h4>
      <div ref={containerRef} style={{ width: '100%', overflow: 'visible' }}>
         <UplotReact options={options} data={data} />
      </div>
    </div>
  );
};
