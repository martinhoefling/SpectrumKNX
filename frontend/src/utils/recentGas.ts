const STORAGE_KEY = 'spectrumknx-recent-send-gas';
const MAX_RECENT = 10;

/** Last group addresses sent to via the send bar, newest first (#187). */
export function loadRecentGas(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/** Records a send target and returns the updated list. */
export function pushRecentGa(address: string): string[] {
  const next = [address, ...loadRecentGas().filter(a => a !== address)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode etc.) — recents just don't persist.
  }
  return next;
}
