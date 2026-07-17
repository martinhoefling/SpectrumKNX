import React, { useRef, useMemo, useEffect, useState } from 'react';
import type { Telegram } from '../hooks/useWebSocket';

interface TimeBrushProps {
  minTime: number;
  maxTime: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  telegrams: Telegram[];
}

export const TimeBrush: React.FC<TimeBrushProps> = ({
  minTime,
  maxTime,
  value,
  onChange,
  telegrams,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<'left' | 'right' | 'middle' | null>(null);
  const dragStartRef = useRef<{ x: number; val: [number, number] } | null>(null);

  const range = maxTime - minTime;
  const leftPct = range > 0 ? ((value[0] - minTime) / range) * 100 : 0;
  const rightPct = range > 0 ? ((value[1] - minTime) / range) * 100 : 100;
  const widthPct = Math.max(0, rightPct - leftPct);

  // Calculate activity density
  const density = useMemo(() => {
    const bins = 60;
    const counts = new Array(bins).fill(0);
    if (range <= 0) return counts;
    
    for (const t of telegrams) {
      const time = new Date(t.timestamp).getTime();
      const bin = Math.min(bins - 1, Math.max(0, Math.floor(((time - minTime) / range) * bins)));
      counts[bin]++;
    }
    const maxCount = Math.max(...counts, 1);
    return counts.map(c => c / maxCount);
  }, [telegrams, minTime, maxTime, range]);

  const svgPath = useMemo(() => {
    const width = 1000;
    const height = 28;
    const step = width / (density.length - 1);
    let path = `M 0 ${height} `;
    density.forEach((val, i) => {
      const x = i * step;
      const y = height - val * height * 0.85; // leave some headroom
      path += `L ${x} ${y} `;
    });
    path += `L ${width} ${height} Z`;
    return path;
  }, [density]);

  const handleStartDrag = (mode: 'left' | 'right' | 'middle', clientX: number) => {
    setDragMode(mode);
    dragStartRef.current = { x: clientX, val: [...value] };
  };

  useEffect(() => {
    if (!dragMode) return;

    const handleMouseMove = (e: MouseEvent) => {
      const start = dragStartRef.current;
      const container = containerRef.current;
      if (!start || !container) return;

      const rect = container.getBoundingClientRect();
      const trackWidth = rect.width;
      if (trackWidth <= 0) return;

      const deltaX = e.clientX - start.x;
      const deltaTime = (deltaX / trackWidth) * range;

      let nextLeft = start.val[0];
      let nextRight = start.val[1];

      // Minimum gap of 1 second (1000ms)
      const minGap = 1000;

      if (dragMode === 'left') {
        nextLeft = Math.min(start.val[1] - minGap, Math.max(minTime, start.val[0] + deltaTime));
      } else if (dragMode === 'right') {
        nextRight = Math.max(start.val[0] + minGap, Math.min(maxTime, start.val[1] + deltaTime));
      } else if (dragMode === 'middle') {
        const windowWidth = start.val[1] - start.val[0];
        nextLeft = start.val[0] + deltaTime;
        nextRight = start.val[1] + deltaTime;

        if (nextLeft < minTime) {
          nextLeft = minTime;
          nextRight = minTime + windowWidth;
        } else if (nextRight > maxTime) {
          nextRight = maxTime;
          nextLeft = maxTime - windowWidth;
        }
      }

      onChange([nextLeft, nextRight]);
    };

    const handleMouseUp = () => {
      setDragMode(null);
      dragStartRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragMode, minTime, maxTime, range, value, onChange]);

  const formatTime = (ms: number) => {
    return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };

  return (
    <div style={{ padding: '0.75rem 1.5rem', borderTop: '1px solid var(--border-color)', background: 'var(--bg-panel)', flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.73rem', color: 'var(--text-dim)', marginBottom: '0.4rem' }}>
        <span>{formatTime(value[0])}</span>
        <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>Pan & Zoom Timeline</span>
        <span>{formatTime(value[1])}</span>
      </div>

      <div
        ref={containerRef}
        style={{
          position: 'relative',
          height: 30,
          background: 'var(--bg-inset)',
          border: '1px solid var(--border-color)',
          borderRadius: 6,
          overflow: 'hidden',
          cursor: dragMode === 'middle' ? 'grabbing' : 'default',
        }}
      >
        {/* Sparkline background */}
        <svg
          viewBox="0 0 1000 28"
          preserveAspectRatio="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            opacity: 0.15,
          }}
        >
          <path d={svgPath} fill="var(--accent-primary)" />
        </svg>

        {/* Selected Window area */}
        <div
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            handleStartDrag('middle', e.clientX);
          }}
          style={{
            position: 'absolute',
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            height: '100%',
            background: 'rgba(99, 102, 241, 0.08)',
            borderLeft: '1px solid var(--accent-primary)',
            borderRight: '1px solid var(--accent-primary)',
            cursor: dragMode === 'middle' ? 'grabbing' : 'grab',
            boxSizing: 'border-box',
          }}
        >
          {/* Active window background overlay */}
          <div style={{ position: 'absolute', inset: 0, borderTop: '2px solid var(--accent-primary)', borderBottom: '2px solid var(--accent-primary)', opacity: 0.8 }} />
        </div>

        {/* Left resize handle */}
        <div
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            handleStartDrag('left', e.clientX);
          }}
          style={{
            position: 'absolute',
            left: `calc(${leftPct}% - 5px)`,
            width: 10,
            height: '100%',
            cursor: 'ew-resize',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 4,
              height: 14,
              borderRadius: 2,
              background: dragMode === 'left' ? 'var(--accent-primary)' : 'var(--text-dim)',
              border: '1px solid var(--border-color)',
            }}
          />
        </div>

        {/* Right resize handle */}
        <div
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            handleStartDrag('right', e.clientX);
          }}
          style={{
            position: 'absolute',
            left: `calc(${rightPct}% - 5px)`,
            width: 10,
            height: '100%',
            cursor: 'ew-resize',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 4,
              height: 14,
              borderRadius: 2,
              background: dragMode === 'right' ? 'var(--accent-primary)' : 'var(--text-dim)',
              border: '1px solid var(--border-color)',
            }}
          />
        </div>
      </div>
    </div>
  );
};
