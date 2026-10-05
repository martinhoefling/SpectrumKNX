import React, { useCallback, useRef, useState } from 'react';
import { getPref, setPref } from '../utils/prefs';
import { MIN_PANE_WIDTH, clampPaneWidth } from '../utils/paneWidth';

const DEFAULT_WIDTH = 'clamp(260px, 18vw, 340px)';

const readWidth = (prefKey: string): number | null => {
  const n = Number(getPref(prefKey));
  return Number.isFinite(n) && n >= MIN_PANE_WIDTH ? n : null;
};

interface ResizablePaneProps {
  open: boolean;
  /** Pref name the width is remembered under; panes sharing it share a width. */
  prefKey: string;
  children: React.ReactNode;
}

/**
 * Slide-in side pane whose width can be dragged at its right edge (#447), like
 * the telegram list's columns: drag to resize, double-click to reset. Until it
 * is resized it keeps the responsive default width.
 */
export const ResizablePane: React.FC<ResizablePaneProps> = ({ open, prefKey, children }) => {
  const [width, setWidth] = useState<number | null>(() => readWidth(prefKey));
  const [dragging, setDragging] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);

  const cssWidth = width != null ? `${width}px` : DEFAULT_WIDTH;

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = innerRef.current?.getBoundingClientRect().width ?? width ?? MIN_PANE_WIDTH;
    let latest = startWidth;
    const onMove = (ev: MouseEvent) => {
      latest = clampPaneWidth(startWidth + (ev.clientX - startX), window.innerWidth);
      setWidth(latest);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setDragging(false);
      if (latest !== startWidth) setPref(prefKey, String(latest));
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    setDragging(true);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [prefKey, width]);

  const handleReset = useCallback(() => {
    setWidth(null);
    setPref(prefKey, '');
  }, [prefKey]);

  return (
    <div style={{
      width: open ? cssWidth : '0px',
      overflow: 'hidden',
      // No easing while dragging — the pane has to follow the pointer.
      transition: dragging ? 'none' : 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
      flexShrink: 0,
      position: 'relative',
      borderRight: open ? '1px solid var(--border-color)' : 'none',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div ref={innerRef} style={{ width: cssWidth, flex: 1, overflow: 'hidden' }}>
        {children}
      </div>
      {open && (
        <div
          className={`pane-resize-handle${dragging ? ' dragging' : ''}`}
          onMouseDown={handleResizeStart}
          onDoubleClick={handleReset}
          title="Drag to resize · double-click to reset"
        />
      )}
      <style>{`
        .pane-resize-handle {
          position: absolute;
          top: 0;
          right: 0;
          width: 6px;
          height: 100%;
          cursor: col-resize;
          z-index: 5;
          user-select: none;
        }
        .pane-resize-handle::after {
          content: '';
          position: absolute;
          top: 0;
          right: 0;
          width: 2px;
          height: 100%;
          background: var(--accent-primary);
          opacity: 0;
          transition: opacity 0.15s;
        }
        .pane-resize-handle:hover::after,
        .pane-resize-handle.dragging::after {
          opacity: 0.7;
        }
      `}</style>
    </div>
  );
};
