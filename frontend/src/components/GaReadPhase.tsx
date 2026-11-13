import { createContext, useContext, useMemo, type ReactNode } from 'react';

import {
  combineGaReadPhase,
  gaReadPhases,
  readEventAnswered,
  type GaReadPhase,
} from '../utils/telegramCellStyles';

type PhaseRow = {
  timestamp: string;
  target_address: string;
  simplified_type?: string | null;
  telegram_type?: string | null;
};

const EMPTY_ROWS: PhaseRow[] = [];
const EMPTY: Map<string, GaReadPhase> = new Map();

type PhaseState = { rows: PhaseRow[]; phases: Map<string, GaReadPhase> };
const EMPTY_STATE: PhaseState = { rows: EMPTY_ROWS, phases: EMPTY };
const GaReadPhaseContext = createContext<PhaseState>(EMPTY_STATE);

/**
 * Known telegrams for the GA read phase. Nested providers keep every row and
 * recompute from timestamps, so a newer Read reopens an older Response.
 */
export function GaReadPhaseProvider({
  rows,
  children,
}: {
  rows?: PhaseRow[];
  children: ReactNode;
}) {
  const parent = useContext(GaReadPhaseContext);
  const local = rows ?? EMPTY_ROWS;
  const value = useMemo(() => {
    if (local.length === 0) return parent;
    if (parent.rows.length === 0) return { rows: local, phases: gaReadPhases(local) };
    const all = parent.rows.concat(local);
    return { rows: all, phases: gaReadPhases(all) };
  }, [parent, local]);
  return <GaReadPhaseContext.Provider value={value}>{children}</GaReadPhaseContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- phase hook beside its provider
export function useGaReadPhaseMap(): Map<string, GaReadPhase> {
  return useContext(GaReadPhaseContext).phases;
}

/** Green READ only when a Response in the known telegrams is strictly newer. */
// eslint-disable-next-line react-refresh/only-export-components -- phase hook beside its provider
export function useReadAnswered(
  read: Parameters<typeof readEventAnswered>[0],
): boolean {
  const rows = useContext(GaReadPhaseContext).rows;
  return readEventAnswered(read, rows);
}

// eslint-disable-next-line react-refresh/only-export-components -- phase hook beside its provider
export function useGaReadPhase(address: string | null | undefined): GaReadPhase {
  const map = useGaReadPhaseMap();
  const addr = (address ?? '').trim();
  if (!addr) return 'none';
  return map.get(addr) ?? 'none';
}

// eslint-disable-next-line react-refresh/only-export-components -- phase hook beside its provider
export function useGaReadPhaseFor(addresses: string[]): GaReadPhase {
  const map = useGaReadPhaseMap();
  return combineGaReadPhase(map, addresses);
}
