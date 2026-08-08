import type { Telegram } from '../hooks/useWebSocket';

// Identity of a telegram for anchor tracking across list updates (#202), row
// marking (#310), and per-message Time-Delta-Context flags (#319). No index
// fallback here — the same telegram must map to the same key in consecutive
// lists even when its position shifts. Shared so callers outside the table
// (the delta-context expansion in App.tsx/HistorySearch.tsx) can test
// flagged-membership against the same identity.
export const anchorKey = (t: Telegram) =>
  `${t.timestamp}-${t.source_address}-${t.target_address}-${t.raw_hex ?? ''}`;
