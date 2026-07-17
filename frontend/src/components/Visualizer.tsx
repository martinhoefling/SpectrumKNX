import React, { useRef, useState } from 'react';
import type { Telegram } from '../hooks/useWebSocket';
import { VisualizerSidebar } from './VisualizerSidebar';
import { useChartData } from '../hooks/useChartData';
import { MixedChart } from './MixedChart';
import { TimelineChart } from './TimelineChart';
import { Download, Link2, Check } from 'lucide-react';
import { getCookie, setCookie } from '../utils/cookies';
import { clearSeriesHidden } from '../utils/legendVisibility';

interface VisualizerProps {
  telegrams: Telegram[];
  selectedTargets: string[];
  onTargetsChange: (targets: string[]) => void;
  onClose: () => void;
  /** Returns a shareable URL for the current view (#150); shows a Copy-link button when set. */
  getShareLink?: () => string;
  /** Chart-area-only rendering for iframe/dashboard embedding (#150). */
  embed?: boolean;
}

export const Visualizer: React.FC<VisualizerProps> = ({
  telegrams, selectedTargets, onTargetsChange, onClose, getShareLink, embed = false,
}) => {

  const chartWrapperRef = useRef<HTMLDivElement>(null);
  const { buckets, minTime, maxTime } = useChartData(telegrams, selectedTargets);
  const [stepped, setStepped] = useState(() => getCookie('chartStepped') !== 'false');
  const [showDots, setShowDots] = useState(() => getCookie('chartDots') !== 'false');
  const [linkCopied, setLinkCopied] = useState(false);

  // Deselecting a target clears any legend-hide on it, so reselecting the same
  // target shows its series again instead of staying invisible (#205).
  const handleTargetsChange = (next: string[]) => {
    const removed = selectedTargets.filter(a => !next.includes(a));
    if (removed.length > 0) clearSeriesHidden(removed);
    onTargetsChange(next);
  };

  const toggleStepped = () => {
    setStepped(s => {
      const next = !s;
      setCookie('chartStepped', String(next));
      return next;
    });
  };

  const toggleDots = () => {
    setShowDots(d => {
      const next = !d;
      setCookie('chartDots', String(next));
      return next;
    });
  };

  const exportPng = () => {
    // A quick hack: uPlot naturally renders to canvas
    // We can just grab all canvases in the chart wrapper and let the user save them.
    // However, saving multiple canvases as one image is complex.
    // For now, if there's at least one canvas, export the first one roughly to prove concept,
    // or just trigger print.
    window.print();
  };

  const copyShareLink = async () => {
    if (!getShareLink) return;
    const absolute = new URL(getShareLink(), window.location.href).toString();
    try {
      await navigator.clipboard.writeText(absolute);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. non-secure context) — show the URL instead.
      window.prompt('Copy this link:', absolute);
    }
  };

  const charts = (
    <div ref={chartWrapperRef} style={{ flex: 1, overflowY: 'auto', padding: embed ? '0.75rem' : '1.5rem' }}>
      {buckets.map(b => (
        b.isBinary ? (
          <TimelineChart key={b.unit} bucket={b} minTime={minTime} maxTime={maxTime} showDots={showDots} />
        ) : (
          <MixedChart key={b.unit} bucket={b} minTime={minTime} maxTime={maxTime} stepped={stepped} showDots={showDots} />
        )
      ))}

      {buckets.length === 0 && selectedTargets.length > 0 && (
        <div style={{ color: 'var(--text-dim)', textAlign: 'center', marginTop: '3rem' }}>
          No plottable values (numeric or continuous) found for the selected targets.
        </div>
      )}
    </div>
  );

  if (embed) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-subtle)' }}>
        {charts}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        <VisualizerSidebar
          telegrams={telegrams}
          selectedTargets={selectedTargets}
          onTargetsChange={handleTargetsChange}
          onClose={onClose}
        />

        {/* Chart Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-subtle)' }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  onClick={toggleStepped}
                  title={stepped ? 'Switch to linear interpolation' : 'Switch to stepped (hold-last-value)'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.4rem 0.85rem', border: '1px solid var(--border-color)',
                    borderRadius: '7px', fontSize: '0.8125rem', cursor: 'pointer',
                    background: stepped ? 'rgba(99,102,241,0.15)' : 'transparent',
                    color: stepped ? 'var(--accent-primary)' : 'var(--text-dim)',
                  }}
                >
                  {stepped ? 'Stepped' : 'Linear'}
                </button>
                <button
                  onClick={toggleDots}
                  title={showDots ? 'Hide telegram dots' : 'Show a dot at each telegram (makes cyclic repeats visible)'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.4rem 0.85rem', border: '1px solid var(--border-color)',
                    borderRadius: '7px', fontSize: '0.8125rem', cursor: 'pointer',
                    background: showDots ? 'rgba(99,102,241,0.15)' : 'transparent',
                    color: showDots ? 'var(--accent-primary)' : 'var(--text-dim)',
                  }}
                >
                  Dots
                </button>
                {getShareLink && (
                  <button
                    className="icon-button"
                    onClick={() => void copyShareLink()}
                    title="Copy a shareable link to this visualization (filters, targets and time range)"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.85rem',
                      border: '1px solid var(--border-color)', borderRadius: '7px', fontSize: '0.8125rem',
                      color: linkCopied ? 'var(--success)' : undefined,
                    }}
                  >
                    {linkCopied ? <><Check size={16} /> Copied</> : <><Link2 size={16} /> Copy link</>}
                  </button>
                )}
                <button
                  className="icon-button"
                  onClick={exportPng}
                  title="Print / PDF Export"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.85rem', border: '1px solid var(--border-color)', borderRadius: '7px', fontSize: '0.8125rem' }}
                >
                  <Download size={16} /> Export
                </button>
              </div>
            )}
          </div>

          {charts}
        </div>
      </div>
    </div>
  );
};
