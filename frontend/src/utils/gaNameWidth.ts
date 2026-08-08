import { createContext } from 'react';

// Every GaValuesTable instance in a building tree shares one NAME column
// width, computed once from all GA names in the loaded project, so DPT/TIME/
// VALUE line up at the same x position across every function and comm-object
// table (#306). Falls back to a fixed max-width outside this context (tests,
// other callers).
export const GaNameWidthContext = createContext<number | null>(null);
