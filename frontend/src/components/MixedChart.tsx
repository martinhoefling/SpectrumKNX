import React, { useRef, useLayoutEffect, useState, useMemo } from 'react';
import UplotReact from 'uplot-react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { ChartBucket } from '../hooks/useChartData';
import { useThemeTick } from '../hooks/useTheme';
import { seriesColor } from '../utils/seriesColors';
import { isSeriesHidden, setSeriesHidden } from '../utils/legendVisibility';

interface MixedChartProps {
  bucket: ChartBucket;
  minTime: number | null;
  maxTime: number | null;
  stepped: boolean;
}

// Ensure we have a shared sync cursor across all charts
const syncCursor = uPlot.sync('knx-time-axis');

export const MixedChart: React.FC<MixedChartProps> = ({ bucket, stepped }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const themeTick = useThemeTick();

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
    width, isBinary, unit, stepped, themeTick,
    series.map(s => `${s.address}~${s.name}`).join('|'),
  ].join('§');

  const options: uPlot.Options = useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const gridStroke = style.getPropertyValue('--border-subtle').trim();
    const axisStroke = style.getPropertyValue('--text-dim').trim();

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
      cursor: { sync: { key: syncCursor.key } },
      hooks: {
        // Record legend show/hide toggles so they survive chart recreation (#192).
        setSeries: [(u, idx, opts) => {
          if (idx == null || idx === 0 || !('show' in opts)) return;
          const addr = series[idx - 1]?.address;
          if (addr) setSeriesHidden(addr, !u.series[idx].show);
        }]
      },
      scales: {
        x: { time: true },
        y: scaleConfig
      },
      axes: [
        {
          space: 50,
          grid: { stroke: gridStroke, width: 1 },
          stroke: axisStroke,
          values: (_u, splits) => splits.map(v =>
            new Date(v * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
          )
        },
        {
          space: 30,
          grid: { stroke: gridStroke, width: 1 },
          stroke: axisStroke,
          values: isBinary
            ? (_u, splits) => splits.map(v => v === 1 ? 'ON' : v === 0 ? 'OFF' : '')
            : undefined
        }
      ],
      series: [
        {
          value: (_u, v) => v == null ? '-' : new Date(v * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
        },
        ...series.map((s) => ({
          label: s.name,
          show: !isSeriesHidden(s.address),
          stroke: seriesColor(s.address),
          width: 2,
          spanGaps: true,
          paths: (isBinary || stepped) ? uPlot.paths.stepped?.({ align: 1 }) : undefined,
          fill: isBinary ? seriesColor(s.address) + '33' : undefined,
          points: { show: false },
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
      <h4 style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--text-main)' }}>
        {isBinary ? 'Binary States (Ein/Aus)' : `Metrics (${unit})`}
      </h4>
      <div ref={containerRef} style={{ width: '100%', overflow: 'hidden' }}>
         <UplotReact options={options} data={data} />
      </div>
    </div>
  );
};
