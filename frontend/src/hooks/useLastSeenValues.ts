import { useState, useEffect, useMemo, useCallback } from 'react';
import { apiUrl } from '../utils/basePath';
import type { Telegram } from './useWebSocket';

// Fetches the last-seen telegram for a set of group addresses and keeps it
// current from the live feed. Shared by GaValuesTable (#269) and the building
// view's comm-object summary row (#307).
export const useLastSeenValues = (
  addresses: string[],
  latestTelegram?: Telegram | null
): Record<string, Telegram> => {
  const [valuesByGA, setValuesByGA] = useState<Record<string, Telegram>>({});
  // Dedupe while preserving caller order, so the request URL (and thus the fetch
  // mock/network-log assertions) stays stable across renders with the same set.
  const addressKey = [...new Set(addresses)].join(',');
  const uniqueAddresses = useMemo(() => (addressKey ? addressKey.split(',') : []), [addressKey]);
  const addressSet = useMemo(() => new Set(uniqueAddresses), [uniqueAddresses]);

  const fetchValues = useCallback(async () => {
    if (uniqueAddresses.length === 0) return;
    try {
      const res = await fetch(
        apiUrl(`/api/telegrams/last?target_address=${encodeURIComponent(uniqueAddresses.join(','))}`)
      );
      const json = await res.json();
      const map: Record<string, Telegram> = {};
      for (const t of (json.telegrams ?? []) as Telegram[]) map[t.target_address] = t;
      setValuesByGA(map);
    } catch {
      // network errors are non-fatal; callers just see no last-seen values
    }
  }, [uniqueAddresses]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchValues();
  }, [fetchValues]);

  // Keep values current from the live feed without re-fetching.
  useEffect(() => {
    if (!latestTelegram || !addressSet.has(latestTelegram.target_address)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValuesByGA(prev => ({ ...prev, [latestTelegram.target_address]: latestTelegram }));
  }, [latestTelegram, addressSet]);

  return valuesByGA;
};
