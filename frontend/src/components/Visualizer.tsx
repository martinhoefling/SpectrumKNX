import React, { useRef } from 'react';
import type { Telegram } from '../hooks/useWebSocket';
import { VisualizerSidebar } from './VisualizerSidebar';
import { useChartData } from '../hooks/useChartData';
import { MixedChart } from './MixedChart';
import { TimelineChart } from './TimelineChart';
import { Download } from 'lucide-react';

interface VisualizerProps {
  telegrams: Telegram[];
  selectedTargets: string[];
  onTargetsChange: (targets: string[]) => void;
  onClose: () => void;
}

export const Visualizer: React.FC<VisualizerProps> = ({ telegrams, selectedTargets, onTargetsChange, onClose }) => {
  
  const chartWrapperRef = useRef<HTMLDivElement>(null);
  const { buckets, minTime, maxTime } = useChartData(telegrams, selectedTargets);

  const exportPng = () => {
    // A quick hack: uPlot naturally renders to canvas
    // We can just grab all canvases in the chart wrapper and let the user save them.
    // However, saving multiple canvases as one image is complex.
    // For now, if there's at least one canvas, export the first one roughly to prove concept,
    // or just trigger print.
    window.print();
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        
        <VisualizerSidebar
          telegrams={telegrams}
          selectedTargets={selectedTargets}
          onTargetsChange={onTargetsChange}
          onClose={onClose}
        />

        {/* Chart Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)' }}>
            <div>
              <h3 style={{ fontSize: '1rem', margin: 0 }}>Visualization</h3>
              {selectedTargets.length === 0 ? (
                <p style={{ color: 'var(--text-dim)', fontSize: '0.8125rem', margin: '0.2rem 0 0' }}>Select targets from the sidebar to begin.</p>
              ) : (
                <p style={{ color: 'var(--text-dim)', fontSize: '0.8125rem', margin: '0.2rem 0 0' }}>Plotting {selectedTargets.length} targets across {buckets.length} metric group(s).</p>
              )}
            </div>
            
            {buckets.length > 0 && (
              <button
                className="icon-button"
                onClick={exportPng}
                title="Print / PDF Export"
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.85rem', border: '1px solid var(--border-color)', borderRadius: '7px', fontSize: '0.8125rem' }}
              >
                <Download size={16} /> Export
              </button>
            )}
          </div>
          
          <div ref={chartWrapperRef} style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
            {buckets.map(b => (
              b.isBinary ? (
                <TimelineChart key={b.unit} bucket={b} minTime={minTime} maxTime={maxTime} />
              ) : (
                <MixedChart key={b.unit} bucket={b} minTime={minTime} maxTime={maxTime} />
              )
            ))}
            
            {buckets.length === 0 && selectedTargets.length > 0 && (
              <div style={{ color: 'var(--text-dim)', textAlign: 'center', marginTop: '3rem' }}>
                No plottable values (numeric or continuous) found for the selected targets.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
