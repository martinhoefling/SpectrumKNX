import { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { Visualizer } from './Visualizer';
import { useWebSocket, type Telegram } from '../hooks/useWebSocket';
import { loadHistoryTelegrams } from '../utils/historyLoad';
import { hasActiveFilters, matchesTelegram } from '../types/filters';
import { wsUrl } from '../utils/basePath';
import type { VizViewState } from '../utils/viewUrl';

const DEFAULT_REFRESH_SECONDS = 300;
const DEFAULT_LIMIT = 100000;

/**
 * Chart-only rendering of a shared view (#150) for iframes / dashboard cards
 * (e.g. a Home Assistant Webpage card). Relative windows stay current via the
 * live websocket feed plus a periodic window re-fetch; absolute windows are
 * static.
 */
export function EmbedView({ view }: { view: VizViewState }) {
  const [telegrams, setTelegrams] = useState<Telegram[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Force the requested theme (dashboards are commonly dark).
  useLayoutEffect(() => {
    if (view.theme) document.documentElement.setAttribute('data-theme', view.theme);
  }, [view.theme]);

  const limit = view.limit ?? DEFAULT_LIMIT;

  const load = useCallback(() => {
    loadHistoryTelegrams(view.range, limit, view.filters)
      .then(({ telegrams: result }) => {
        setTelegrams(result);
        setError(null);
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Load failed'))
      .finally(() => setLoaded(true));
  }, [view, limit]);

  useEffect(() => {
    load();
    if (view.range.kind !== 'relative') return;
    const interval = window.setInterval(load, (view.refresh ?? DEFAULT_REFRESH_SECONDS) * 1000);
    return () => window.clearInterval(interval);
  }, [load, view.range.kind, view.refresh]);

  // Between re-fetches, append live telegrams that match the view's filters.
  const handleTelegram = useCallback((t: Telegram) => {
    if (view.range.kind !== 'relative') return;
    if (hasActiveFilters(view.filters) && !matchesTelegram(t, view.filters)) return;
    setTelegrams(prev => {
      const next = [t, ...prev];
      return next.length > limit ? next.slice(0, limit) : next;
    });
  }, [view, limit]);

  useWebSocket(wsUrl('/ws/telegrams'), handleTelegram);

  if (!loaded) {
    return <div style={centered}>Loading…</div>;
  }
  if (error) {
    return <div style={{ ...centered, color: 'var(--error)' }}>{error}</div>;
  }
  if (telegrams.length === 0) {
    return <div style={centered}>No telegrams in the selected window.</div>;
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Visualizer
        telegrams={telegrams}
        selectedTargets={view.plot}
        onTargetsChange={() => {}}
        onClose={() => {}}
        embed
      />
    </div>
  );
}

const centered: React.CSSProperties = {
  height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text-dim)', fontSize: '0.875rem',
};
