import React, { useRef, useLayoutEffect, useState } from 'react';
import UplotReact from 'uplot-react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { ChartBucket } from '../hooks/useChartData';

interface TimelineChartProps {
  bucket: ChartBucket;
  minTime: number | null;
  maxTime: number | null;
}

const syncCursor = uPlot.sync('knx-time-axis');

export const TimelineChart: React.FC<TimelineChartProps> = ({ bucket }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

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
  const chartHeight = series.length * (rowHeight + rowGap) + 60; // Extra for axis

  // Custom plugin to draw the timeline blocks
  const timelinePlugin = () => {
    return {
      hooks: {
        draw: [(u: uPlot) => {
          const { ctx } = u;
          const { left, top, width, height } = u.bbox;

          ctx.save();
          // Clip to chart area for the colored blocks
          ctx.beginPath();
          ctx.rect(left, top, width, height);
          ctx.clip();

          series.forEach((_, sIdx) => {
            const yData = u.data[sIdx + 1];
            const yTop = top + sIdx * (rowHeight + rowGap) + rowGap;
            
            for (let i = 0; i < timestamps.length; i++) {
              const val = yData[i];
              if (val === null) continue;

              const xStart = u.valToPos(timestamps[i] / 1000, 'x', true);
              // Find end of this segment (next data point or end of chart)
              let xEnd;
              if (i < timestamps.length - 1) {
                xEnd = u.valToPos(timestamps[i + 1] / 1000, 'x', true);
              } else {
                xEnd = left + width;
              }

              if (xEnd <= xStart) continue;

              const isOn = val === 1;
              ctx.fillStyle = isOn ? '#22c55e' : '#ef4444'; // Green / Red
              ctx.fillRect(xStart, yTop, xEnd - xStart, rowHeight);

              // Draw Label if wide enough
              if (xEnd - xStart > 40) {
                ctx.fillStyle = 'white';
                ctx.font = 'bold 11px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(isOn ? 'On' : 'Off', xStart + (xEnd - xStart) / 2, yTop + rowHeight / 2);
              }
            }
          });

          ctx.restore();

          // Draw series names on the right (unclipped)
          series.forEach((s, sIdx) => {
            const yTop = top + sIdx * (rowHeight + rowGap) + rowGap;
            ctx.fillStyle = '#6366f1';
            ctx.font = '600 12px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.name, left + width + 15, yTop + rowHeight / 2);
          });
        }]
      }
    };
  };

  const options: uPlot.Options = {
    width, // Use full width
    height: chartHeight,
    padding: [0, 180, 0, 0], // Leave 180px on the right for labels
    cursor: { sync: { key: syncCursor.key } },
    plugins: [timelinePlugin()],
    scales: {
      x: { time: true },
      y: { auto: false, range: [0, 1] }
    },
    axes: [
      {
        space: 50,
        stroke: 'var(--text-dim)',
        grid: { stroke: 'rgba(255,255,255,0.05)' },
        values: (_u, splits) => splits.map(v => 
          new Date(v * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
        )
      },
      { show: false } // Hide Y axis
    ],
    series: [
      {
        value: (_u, v) => v == null ? '-' : new Date(v * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      },
      ...series.map((s) => ({
        label: s.name,
        show: false, // Don't draw actual lines
      }))
    ]
  };

  return (
    <div style={{ marginBottom: '2rem', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'visible' }}>
      <h4 style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--text-main)' }}>
        Binary States Timeline
      </h4>
      <div ref={containerRef} style={{ width: '100%', overflow: 'visible' }}>
         <UplotReact options={options} data={data} />
      </div>
    </div>
  );
};
