import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../utils/basePath';
import type { AuthStatus } from '../hooks/useAuthStatus';

interface AuthSettingsProps {
  status: AuthStatus;
  onChanged: () => void;
}

const row: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.35rem', gap: '0.5rem',
};
const field: React.CSSProperties = {
  padding: '0.3rem 0.45rem', borderRadius: 6, fontSize: '0.78rem', minWidth: 0,
  background: 'var(--bg-input, #0f0f14)', color: 'var(--text-main)', border: '1px solid var(--border-color)',
};
const button: React.CSSProperties = {
  padding: '0.3rem 0.6rem', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
  border: '1px solid var(--accent-primary)', background: 'rgba(99,102,241,0.12)', color: 'var(--accent-primary)',
  whiteSpace: 'nowrap',
};

/** Authentication section of the settings panel (#451). */
export function AuthSettings({ status, onChanged }: AuthSettingsProps) {
  const [users, setUsers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({ username: '', password: '' });
  const [setup, setSetup] = useState({ username: '', password: '' });
  const [newPassword, setNewPassword] = useState('');
  const [mcpToken, setMcpToken] = useState<string | null>(null);

  const call = useCallback(async (path: string, init?: RequestInit) => {
    // State is only touched after the request resolves: clearing the error up
    // front would be a synchronous setState inside the users effect below.
    const response = await fetch(apiUrl(path), {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.detail ?? `Request failed (${response.status})`);
      return null;
    }
    setError(null);
    return response.json().catch(() => ({}));
  }, []);

  // Fetched with .then rather than an awaited helper, matching useUpdateCheck:
  // an async helper looks to the linter like it may setState synchronously
  // inside the effect.
  const [usersNonce, setUsersNonce] = useState(0);
  const loadUsers = useCallback(() => setUsersNonce(n => n + 1), []);

  useEffect(() => {
    if (!status.ui_auth_enabled || !status.authenticated) return;
    let cancelled = false;
    fetch(apiUrl('/api/auth/users'))
      .then(r => (r.ok ? r.json() : null))
      .then(body => { if (!cancelled && body) setUsers(body.users ?? []); })
      .catch(() => { /* the panel simply shows no users */ });
    return () => { cancelled = true; };
  }, [status.ui_auth_enabled, status.authenticated, usersNonce]);

  const label = (text: string) => <span style={{ color: 'var(--text-dim)' }}>{text}</span>;

  return (
    <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-subtle)' }}>
      <div style={row}>
        {label('Login:')}
        <span style={{ fontSize: '0.75rem', color: status.ui_auth_enabled ? 'var(--success)' : 'var(--text-dim)' }}>
          {status.ui_auth_enabled ? '● Required' : '○ Off'}
        </span>
      </div>

      {status.ui_auth_forced_off && (
        <div style={{ marginTop: '0.35rem', fontSize: '0.72rem', color: 'var(--warning, #f59e0b)' }}>
          Held off by AUTH_UI_ENABLED. Accounts are kept — remove the setting to switch login back on.
        </div>
      )}

      {/* Login is forced on by the environment but nobody owns the instance
          yet. Without this the panel would show a reassuring green "Required"
          while the account is still unclaimed. */}
      {status.ui_auth_enabled && !status.configured && (
        <div style={{
          marginTop: '0.4rem', padding: '0.45rem 0.55rem', borderRadius: 6, fontSize: '0.72rem',
          background: 'rgba(239,68,68,0.1)', border: '1px solid var(--error, #ef4444)',
          color: 'var(--error, #ef4444)', lineHeight: 1.5,
        }}>
          <strong>No account exists yet.</strong> Login is switched on by AUTH_UI_ENABLED (or the
          add-on&apos;s AUTH_UI option), but nobody has claimed the administrator account. Create it
          now — until you do, this installation has no owner.
        </div>
      )}

      {error && (
        <div style={{ marginTop: '0.35rem', fontSize: '0.72rem', color: 'var(--error, #ef4444)' }}>{error}</div>
      )}

      {/* Enabling requires creating the first account in the same step. */}
      {/* Accounts exist but login is off: flip it back on without creating one. */}
      {!status.ui_auth_enabled && !status.ui_auth_forced_off && status.configured && (
        <div style={{ marginTop: '0.5rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: '0.35rem' }}>
            Accounts already exist. Turning login on keeps them; you will be asked to sign in.
          </div>
          <button
            style={button}
            onClick={async () => {
              if (await call('/api/auth/enable', { method: 'POST', body: JSON.stringify({}) })) onChanged();
            }}
          >
            Enable login
          </button>
        </div>
      )}

      {!status.ui_auth_enabled && !status.ui_auth_forced_off && !status.configured && (
        <div style={{ marginTop: '0.5rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: '0.35rem' }}>
            Turning login on creates the first account at the same time.
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <input
              style={{ ...field, flex: 1 }} placeholder="username" value={setup.username}
              onChange={e => setSetup({ ...setup, username: e.target.value })}
            />
            <input
              style={{ ...field, flex: 1 }} type="password" placeholder="password (8+)" value={setup.password}
              onChange={e => setSetup({ ...setup, password: e.target.value })}
            />
            <button
              style={button}
              onClick={async () => {
                if (await call('/api/auth/enable', { method: 'POST', body: JSON.stringify(setup) })) {
                  setSetup({ username: '', password: '' });
                  onChanged();
                }
              }}
            >
              Enable login
            </button>
          </div>
        </div>
      )}

      {status.ui_auth_enabled && status.authenticated && (
        <>
          <div style={row}>
            {label('Signed in as:')}
            <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.75rem', color: 'var(--text-main)' }}>
              {status.user}
            </span>
          </div>

          <div style={{ marginTop: '0.5rem' }}>
            {label('Users')}
            {users.map(user => (
              <div key={user} style={row}>
                <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.75rem' }}>{user}</span>
                <button
                  style={{ ...button, borderColor: 'var(--error, #ef4444)', color: 'var(--error, #ef4444)', background: 'transparent' }}
                  onClick={async () => {
                    if (await call(`/api/auth/users/${encodeURIComponent(user)}`, { method: 'DELETE' })) loadUsers();
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
              <input
                style={{ ...field, flex: 1 }} placeholder="username" value={newUser.username}
                onChange={e => setNewUser({ ...newUser, username: e.target.value })}
              />
              <input
                style={{ ...field, flex: 1 }} type="password" placeholder="password (8+)" value={newUser.password}
                onChange={e => setNewUser({ ...newUser, password: e.target.value })}
              />
              <button
                style={button}
                onClick={async () => {
                  if (await call('/api/auth/users', { method: 'POST', body: JSON.stringify(newUser) })) {
                    setNewUser({ username: '', password: '' });
                    loadUsers();
                  }
                }}
              >
                Add
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
            <input
              style={{ ...field, flex: 1 }} type="password" placeholder="new password for your account"
              value={newPassword} onChange={e => setNewPassword(e.target.value)}
            />
            <button
              style={button}
              onClick={async () => {
                if (await call('/api/auth/password', { method: 'POST', body: JSON.stringify({ password: newPassword }) })) {
                  setNewPassword('');
                }
              }}
            >
              Change
            </button>
          </div>

          {/* MCP token — shown once, stored hashed. */}
          <div style={{ marginTop: '0.6rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-subtle)' }}>
            <div style={row}>
              {label('MCP token:')}
              <span style={{ fontSize: '0.75rem', color: status.mcp_token_required ? 'var(--success)' : 'var(--text-dim)' }}>
                {status.mcp_token_env ? '● From AUTH_MCP_TOKEN' : status.mcp_token_required ? '● Required' : '○ Off'}
              </span>
            </div>
            {!status.mcp_token_env && (
              <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
                <button
                  style={button}
                  onClick={async () => {
                    const body = await call('/api/auth/mcp-token', { method: 'POST' });
                    if (body) { setMcpToken(body.token); onChanged(); }
                  }}
                >
                  {status.mcp_token_required ? 'Regenerate' : 'Generate'}
                </button>
                {status.mcp_token_required && (
                  <button
                    style={{ ...button, borderColor: 'var(--border-color)', color: 'var(--text-dim)', background: 'transparent' }}
                    onClick={async () => {
                      if (await call('/api/auth/mcp-token', { method: 'DELETE' })) { setMcpToken(null); onChanged(); }
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            )}
            {mcpToken && (
              <div style={{
                marginTop: '0.45rem', padding: '0.45rem 0.55rem', borderRadius: 6, fontSize: '0.72rem',
                background: 'rgba(245,158,11,0.1)', border: '1px solid var(--warning, #f59e0b)',
              }}>
                <div style={{ color: 'var(--warning, #f59e0b)', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Copy this now — it is not shown again.
                </div>
                <code style={{ wordBreak: 'break-all', color: 'var(--text-main)' }}>{mcpToken}</code>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.7rem' }}>
            <button
              style={{ ...button, borderColor: 'var(--border-color)', color: 'var(--text-dim)', background: 'transparent' }}
              onClick={async () => { await call('/api/auth/logout', { method: 'POST' }); onChanged(); }}
            >
              Sign out
            </button>
            <button
              style={{ ...button, borderColor: 'var(--error, #ef4444)', color: 'var(--error, #ef4444)', background: 'transparent' }}
              onClick={async () => { if (await call('/api/auth/disable', { method: 'POST' })) onChanged(); }}
            >
              Turn login off
            </button>
          </div>
        </>
      )}
    </div>
  );
}
