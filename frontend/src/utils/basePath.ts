/**
 * Returns the base path for API / WebSocket calls.
 *
 * In standalone mode (docker-compose) this is just "" (empty string),
 * so `/api/...` continues to work as-is.
 *
 * Under Home Assistant Ingress the page is served at
 *   /api/hassio_ingress/<token>/
 * and we need to prefix every fetch / WS URL with that path.
 *
 * We detect this by looking at `document.baseURI` which Vite's
 * `base: './'` will set relative to wherever index.html was loaded.
 */
export function getBasePath(): string {
  try {
    const base = new URL(document.baseURI);
    // pathname will be e.g. "/api/hassio_ingress/<token>/" or just "/"
    let path = base.pathname;
    // Remove trailing slash to keep join logic clean
    if (path.endsWith('/')) path = path.slice(0, -1);
    // "/" becomes ""
    return path === '/' ? '' : path;
  } catch {
    return '';
  }
}

/** Build a full URL for a fetch() call (e.g. apiUrl('/api/version')). */
export function apiUrl(endpoint: string): string {
  return `${getBasePath()}${endpoint}`;
}

/** Build a full WebSocket URL (e.g. wsUrl('/ws/telegrams')). */
export function wsUrl(endpoint: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${getBasePath()}${endpoint}`;
}
