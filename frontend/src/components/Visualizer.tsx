import React, { useRef, useState, useMemo } from 'react';
import type { Telegram } from '../hooks/useWebSocket';
import { VisualizerSidebar } from './VisualizerSidebar';
import { useChartData } from '../hooks/useChartData';
import { MixedChart } from './MixedChart';
import { TimelineChart } from './TimelineChart';
import { EventDotsChart } from './EventDotsChart';
import { TimeBrush } from './TimeBrush';
import { Download, Link2, Check, X } from 'lucide-react';
import { getPref, setPref } from '../utils/prefs';
import { clearSeriesHidden } from '../utils/legendVisibility';
import { expandDegenerateRange } from '../utils/timeRange';
import { splitLockedBuckets } from '../utils/chartLock';

interface VisualizerProps {
  telegrams: Telegram[];
  selectedTargets: string[];
  onTargetsChange: (targets: string[]) => void;
  onClose: () => void;
  /** Returns a shareable URL for the current view (#150); shows a Copy-link button when set. */
  getShareLink?: () => string;
  /** Chart-area-only rendering for iframe/dashboard embedding (#150). */
  embed?: boolean;
  zoomRange?: [number, number] | null;
  onZoomRangeChange?: (range: [number, number] | null) => void;
  /** Click on a chart's time ruler or a telegram dot: navigate to the telegram
   * list around that timestamp (#308). */
  onTimeClick?: (ms: number) => void;
  /** Per-target row actions in the sidebar (#341): write/filter/last-seen. */
  writeEnabled?: boolean;
  onFilterGAs?: (addresses: string[]) => void;
  onLastSeen?: (address: string | string[], mode: 'ga' | 'pa') => void;
}

export const Visualizer: React.FC<VisualizerProps> = ({
  telegrams, selectedTargets, onTargetsChange, onClose, getShareLink, embed = false,
  zoomRange, onZoomRangeChange, onTimeClick, writeEnabled, onFilterGAs, onLastSeen,
}) => {

  const chartWrapperRef = useRef<HTMLDivElement>(null);

  // Datatype chosen per group address for GAs with no DPT in the project, so
  // their raw payloads can be decoded and plotted (#315). Persisted so the
  // choice survives reloads.
  const [dptOverrides, setDptOverrides] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(getPref('vizDptOverrides') || '{}') as Record<string, string>;
    } catch {
      return {};
    }
  });

  const setDptOverride = (address: string, key: string) => {
    setDptOverrides(prev => {
      const next = { ...prev };
      if (key) next[address] = key;
      else delete next[address];
      setPref('vizDptOverrides', JSON.stringify(next));
      return next;
    });
  };

  // GAs whose telegrams never carry a decoded DPT but do carry raw byte
  // payloads — the ones that need a manual datatype to be plottable (#315).
  const untypedTargets = useMemo(() => {
    const decoded = new Set<string>();
    const rawArray = new Set<string>();
    for (const t of telegrams) {
      if (!t.target_address) continue;
      if (t.dpt_main != null) decoded.add(t.target_address);
      else if (Array.isArray(t.value_json)) rawArray.add(t.target_address);
    }
    return new Set([...rawArray].filter(a => !decoded.has(a)));
  }, [telegrams]);

  const { buckets, minTime, maxTime, addressToUnit } = useChartData(telegrams, selectedTargets, dptOverrides);
  const [stepped, setStepped] = useState(() => getPref('chartStepped') !== 'false');
  const [showDots, setShowDots] = useState(() => getPref('chartDots') !== 'false');
  const [linkCopied, setLinkCopied] = useState(false);

  // Per-metric chart "lock" (#349): a locked chart stops taking further GAs of
  // its unit — the next one selected spawns a new chart instead of crowding
  // the existing one. Thresholds are "GAs assigned so far" counts (by
  // selection order) at each lock action; see utils/chartLock.ts.
  const [lockThresholds, setLockThresholds] = useState<Record<string, number[]>>({});
  const displayBuckets = useMemo(
    () => splitLockedBuckets(buckets, selectedTargets, addressToUnit, lockThresholds),
    [buckets, selectedTargets, addressToUnit, lockThresholds]
  );
  // `openGroupSize` is the currently-open chart's own GA count (for that
  // unit), read fresh from `displayBuckets` at the call site. If the most
  // recent threshold exactly equals it, nothing has been added since that
  // lock — toggling again undoes it; otherwise a new lock closes it off.
  const toggleLock = (unit: string, openGroupSize: number) => {
    setLockThresholds(prev => {
      const existing = prev[unit] ?? [];
      const alreadyLocked = existing.length > 0 && existing[existing.length - 1] === openGroupSize;
      const next = alreadyLocked ? existing.slice(0, -1) : [...existing, openGroupSize];
      return { ...prev, [unit]: next };
    });
  };

  const defaultRange = useMemo<[number, number]>(() => {
    // Pad a zero-width extent (a single telegram, or several at the same instant)
    // so the time axis renders real times instead of collapsing to 00:00 (#239).
    return expandDegenerateRange(minTime ?? 0, maxTime ?? 0);
  }, [minTime, maxTime]);

  const [internalZoomRange, setInternalZoomRange] = useState<[number, number] | null>(null);
  const currentZoomRange = zoomRange !== undefined ? zoomRange : internalZoomRange;

  // Edge pin (#341, #340 follow-up): a handle left at (or dragged/double-clicked
  // to) the domain edge keeps tracking that edge as minTime/maxTime move — the
  // timeline analogue of the telegram list's live-edge follow (#203). Ephemeral,
  // like the list's follow state: not part of the shareable-link zoomRange
  // contract, so it resets on reload rather than being encoded in a URL.
  const [edgePinned, setEdgePinned] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });

  const setZoomRange = (val: [number, number] | null | ((prev: [number, number] | null) => [number, number] | null)) => {
    const next = typeof val === 'function' ? val(currentZoomRange) : val;
    setInternalZoomRange(next);
    onZoomRangeChange?.(next);
    if (next && minTime !== null && maxTime !== null) {
      const eps = Math.max(1000, (maxTime - minTime) * 0.005);
      setEdgePinned({ left: next[0] <= minTime + eps, right: next[1] >= maxTime - eps });
    } else {
      setEdgePinned({ left: false, right: false });
    }
  };

  const activeRange = useMemo<[number, number]>(() => {
    if (!currentZoomRange || minTime === null || maxTime === null) return defaultRange;
    const left = edgePinned.left ? minTime : Math.max(minTime, Math.min(maxTime, currentZoomRange[0]));
    const right = edgePinned.right ? maxTime : Math.max(left, Math.min(maxTime, currentZoomRange[1]));
    return [left, right];
  }, [currentZoomRange, minTime, maxTime, defaultRange, edgePinned]);

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
      setPref('chartStepped', String(next));
      return next;
    });
  };

  const toggleDots = () => {
    setShowDots(d => {
      const next = !d;
      setPref('chartDots', String(next));
      return next;
    });
  };

  const exportPng = () => {
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
      window.prompt('Copy this link:', absolute);
    }
  };

  // With no active zoom the charts should track the data as the buffer grows, so
  // a new (or history-loaded) telegram that extends the range stays on screen
  // instead of dropping off a frozen scale (#340). A user zoom freezes it (#281).
  const autoFollow = currentZoomRange === null;

  const charts = (
    <div ref={chartWrapperRef} style={{ flex: 1, overflowY: 'auto', padding: embed ? '0.75rem' : '1.5rem' }}>
      {displayBuckets.map(g => (
        g.bucket.isBinary ? (
          <TimelineChart key={g.key} bucket={g.bucket} minTime={activeRange[0]} maxTime={activeRange[1]} showDots={showDots} autoFollow={autoFollow} onZoomRangeChange={setZoomRange} onTimeClick={onTimeClick} />
        ) : g.bucket.isEvents ? (
          <EventDotsChart key={g.key} bucket={g.bucket} minTime={activeRange[0]} maxTime={activeRange[1]} autoFollow={autoFollow} onZoomRangeChange={setZoomRange} onTimeClick={onTimeClick} />
        ) : (
          <MixedChart
            key={g.key} bucket={g.bucket} minTime={activeRange[0]} maxTime={activeRange[1]}
            stepped={stepped} showDots={showDots} autoFollow={autoFollow} onZoomRangeChange={setZoomRange}
            groupLabel={g.groupCount > 1 ? `${g.groupIndex}/${g.groupCount}` : undefined}
            // Only the unit's currently-open chart is lockable; earlier ones are permanently closed (#349).
            locked={g.isLatest ? (lockThresholds[g.bucket.unit]?.at(-1) === g.bucket.series.length) : undefined}
            onToggleLock={g.isLatest ? () => toggleLock(g.bucket.unit, g.bucket.series.length) : undefined}
            onTimeClick={onTimeClick}
          />
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
        {/* Pan & zoom timeline sits above the charts it controls (#308). */}
        {minTime !== null && maxTime !== null && minTime < maxTime && (
          <TimeBrush
            minTime={minTime}
            maxTime={maxTime}
            value={activeRange}
            onChange={setZoomRange}
            telegrams={telegrams}
            leftPinned={edgePinned.left}
            rightPinned={edgePinned.right}
          />
        )}
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
          untypedTargets={untypedTargets}
          dptOverrides={dptOverrides}
          onDptOverrideChange={setDptOverride}
          writeEnabled={writeEnabled}
          onFilterGAs={onFilterGAs}
          onLastSeen={onLastSeen}
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

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {buckets.length > 0 && (
                <>
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
                </>
              )}
              {/* Close X in the panel header, like every other main panel (#347). */}
              <button
                className="icon-button"
                onClick={onClose}
                title="Close Visualization"
                style={{ padding: '0.4rem', display: 'flex', color: 'var(--text-dim)' }}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Pan & zoom timeline sits above the charts it controls (#308). */}
          {minTime !== null && maxTime !== null && minTime < maxTime && (
            <TimeBrush
              minTime={minTime}
              maxTime={maxTime}
              value={activeRange}
              onChange={setZoomRange}
              telegrams={telegrams}
              leftPinned={edgePinned.left}
              rightPinned={edgePinned.right}
            />
          )}
          {charts}
        </div>
      </div>
    </div>
  );
};
