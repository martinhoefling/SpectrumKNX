import React, { useRef, useLayoutEffect, useState } from 'react';
import UplotReact from 'uplot-react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { ChartBucket } from '../hooks/useChartData';

interface MixedChartProps {
  bucket: ChartBucket;
  minTime: number | null;
  maxTime: number | null;
}

// Generate simple distinct colors for series
const COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#eab308', // yellow
  '#22c55e', // green
  '#a855f7', // purple
  '#f97316', // orange
  '#14b8a6', // teal
];

// Ensure we have a shared sync cursor across all charts
const syncCursor = uPlot.sync('knx-time-axis');

export const MixedChart: React.FC<MixedChartProps> = ({ bucket, minTime, maxTime }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

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

  // Configure Y-Axis scale limits based on smart defaults
  let scaleConfig: uPlot.Scale = {
    // scale auto
  };

  if (!isBinary && (unit === '%' || unit === 'Hz' || unit === 'W')) {
    // Smart Y bounds: these should typically floor at 0
    scaleConfig = {
      auto: true,
      range: (u, min, max) => {
        let hardMin = 0;
        return [hardMin, max > hardMin ? max * 1.1 : 100];
      }
    };
  } else if (isBinary) {
    // For boolean square wave, lock to slightly outside 0-1
    scaleConfig = {
      auto: false,
      range: [-0.1, 1.1]
    };
  }

  const options: uPlot.Options = {
    width,
    height: isBinary ? Math.max(150, series.length * 50) : 300,
    cursor: { sync: { key: syncCursor.key } },
    scales: {
      x: { time: true },
      // Shared Y scale for this unit bucket
      y: scaleConfig
    },
    axes: [
      {
        space: 50,
        grid: { stroke: 'rgba(0,0,0,0.1)', width: 1 },
        stroke: 'var(--bg-dark)',
      },
      {
        grid: { stroke: 'rgba(0,0,0,0.1)', width: 1 },
        stroke: 'var(--bg-dark)',
        values: isBinary 
          ? (u, splits) => splits.map(v => v === 1 ? 'ON' : v === 0 ? 'OFF' : '')
          : undefined
      }
    ],
    series: [
      {
        value: (u, v) => v == null ? '-' : new Date(v * 1000).toLocaleTimeString()
      },
      ...series.map((s, idx) => ({
        label: s.name,
        stroke: COLORS[idx % COLORS.length],
        width: 2,
        spanGaps: true, // Interpolate gaps so lines don't break on missing data
        paths: isBinary ? uPlot.paths.stepped?.({ align: 1 }) : undefined,
        fill: isBinary ? COLORS[idx % COLORS.length] + '33' : undefined,
        points: { show: false }, // Hide explicit dots for performance/cleanliness
        value: (u: uPlot, v: number | null) => {
          if (v === null) return '-';
          if (isBinary) return v === 1 ? 'Ein' : 'Aus';
          return v + ' ' + unit;
        }
      }))
    ]
  };

  return (
    <div style={{ marginBottom: '2rem', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
      <h4 style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--text-main)' }}>
        {isBinary ? 'Binary States (Ein/Aus)' : `Metrics (${unit})`}
      </h4>
      <div ref={containerRef} style={{ width: '100%', overflow: 'hidden' }}>
         <UplotReact options={options} data={data} />
      </div>
    </div>
  );
};
