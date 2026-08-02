import { useState, useEffect } from 'react';
import { apiUrl } from '../utils/basePath';

export interface UpdateRelease {
  version: string;
  name: string;
  notes: string;
  html_url: string;
  published_at: string;
}

export interface UpdateInfo {
  enabled: boolean;
  current?: string;
  latest?: string | null;
  update_available: boolean;
  html_url?: string | null;
  published_at?: string | null;
  releases?: UpdateRelease[];
  error?: boolean;
}

/**
 * Fetches update status from the backend once on mount. Returns null until
 * loaded (or on failure) — the backend already caches and fails quietly, so
 * there's no retry/error handling to do here.
 */
export function useUpdateCheck(): UpdateInfo | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/api/update'))
      .then(r => r.json())
      .then(data => { if (!cancelled) setInfo(data); })
      .catch(() => { if (!cancelled) setInfo(null); });
    return () => { cancelled = true; };
  }, []);

  return info;
}
