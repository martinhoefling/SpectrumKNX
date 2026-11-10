import { createContext, useContext, type ReactNode } from 'react';
import type { FilterOption } from '../types/filters';

const DptCatalogContext = createContext<FilterOption[]>([]);

/** App-wide project DPT catalog for write UIs (send panel / send-to-GA popover). */
export function DptCatalogProvider({ value, children }: {
  value: FilterOption[];
  children: ReactNode;
}) {
  return (
    <DptCatalogContext.Provider value={value}>
      {children}
    </DptCatalogContext.Provider>
  );
}

export function useDptCatalog(): FilterOption[] {
  return useContext(DptCatalogContext);
}
