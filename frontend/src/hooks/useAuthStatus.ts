import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../utils/basePath';

export interface AuthStatus {
  ui_auth_enabled: boolean;
  /** AUTH_UI_ENABLED is holding auth off — the documented password recovery. */
  ui_auth_forced_off: boolean;
  /** At least one account exists. */
  configured: boolean;
  authenticated: boolean;
  user: string | null;
  mcp_token_required: boolean;
  /** The MCP token comes from AUTH_MCP_TOKEN, so it cannot be managed here. */
  mcp_token_env: boolean;
}

/**
 * Authentication state, and whether the app should be showing a login screen.
 *
 * Returns null until loaded. `/api/auth/status` is deliberately reachable
 * without a session, so this works before login.
 */
export function useAuthStatus(): { status: AuthStatus | null; reload: () => void } {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce(n => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/api/auth/status'))
      .then(r => r.json())
      .then(data => { if (!cancelled) setStatus(data); })
      // Failing closed here would lock the UI out over a transient blip, and
      // the API enforces access anyway — so treat an unreachable status as
      // "no auth configured" and let requests 401 if it is.
      .catch(() => { if (!cancelled) setStatus(null); });
    return () => { cancelled = true; };
  }, [nonce]);

  return { status, reload };
}

/** Whether the login screen should replace the app. */
export function loginRequired(status: AuthStatus | null): boolean {
  return !!status && status.ui_auth_enabled && !status.authenticated;
}
