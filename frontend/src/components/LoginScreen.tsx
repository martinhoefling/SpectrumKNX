import { useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { apiUrl } from '../utils/basePath';
import type { AuthStatus } from '../hooks/useAuthStatus';

interface LoginScreenProps {
  status: AuthStatus;
  onAuthenticated: () => void;
}

/**
 * Shown instead of the app when login is required.
 *
 * Doubles as first-run setup: if auth is on but no account exists — which
 * happens when AUTH_UI_ENABLED is set before anyone has configured a user —
 * this creates the admin account. Enabling and creating the account are one
 * request so there is never a window where auth is on with no owner.
 */
export function LoginScreen({ status, onAuthenticated }: LoginScreenProps) {
  const isSetup = !status.configured;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(apiUrl(isSetup ? '/api/auth/enable' : '/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(
          response.status === 429
            ? 'Too many failed attempts. Wait a moment and try again.'
            : (body.detail ?? 'Login failed')
        );
        return;
      }
      onAuthenticated();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const field: React.CSSProperties = {
    width: '100%', padding: '0.6rem 0.7rem', borderRadius: 8, fontSize: '0.9rem',
    background: 'var(--bg-input, #0f0f14)', color: 'var(--text-main)',
    border: '1px solid var(--border-color)', marginTop: '0.3rem',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-main, #0b0b0f)', padding: '2rem',
    }}>
      <form
        onSubmit={submit}
        style={{
          width: '100%', maxWidth: 380, background: 'var(--bg-panel, #16161d)',
          border: '1px solid var(--border-color)', borderRadius: 14, padding: '1.75rem',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '1.25rem' }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(99,102,241,0.15)', color: 'var(--accent-primary)',
          }}>
            {isSetup ? <ShieldCheck size={19} /> : <Lock size={19} />}
          </div>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)' }}>
              {isSetup ? 'Create an account' : 'Spectrum KNX'}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
              {isSetup ? 'Authentication is on but no account exists yet.' : 'Sign in to continue'}
            </div>
          </div>
        </div>

        <label style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
          Username
          <input
            style={field} value={username} onChange={e => setUsername(e.target.value)}
            autoFocus autoComplete="username" required
          />
        </label>

        <label style={{ fontSize: '0.78rem', color: 'var(--text-dim)', display: 'block', marginTop: '0.85rem' }}>
          Password
          <input
            style={field} type="password" value={password} onChange={e => setPassword(e.target.value)}
            autoComplete={isSetup ? 'new-password' : 'current-password'} required
            minLength={isSetup ? 8 : undefined}
          />
          {isSetup && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>At least 8 characters.</span>
          )}
        </label>

        {error && (
          <div style={{
            marginTop: '0.85rem', padding: '0.5rem 0.65rem', borderRadius: 7, fontSize: '0.8rem',
            background: 'rgba(239,68,68,0.12)', border: '1px solid var(--error, #ef4444)',
            color: 'var(--error, #ef4444)',
          }}>
            {error}
          </div>
        )}

        <button
          type="submit" disabled={busy}
          style={{
            width: '100%', marginTop: '1.25rem', padding: '0.6rem', borderRadius: 8,
            fontSize: '0.88rem', fontWeight: 600, cursor: busy ? 'default' : 'pointer',
            border: '1px solid var(--accent-primary)', background: 'var(--accent-primary)',
            color: '#fff', opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Please wait…' : isSetup ? 'Create account' : 'Sign in'}
        </button>

        {!isSetup && (
          <div style={{ marginTop: '1rem', fontSize: '0.72rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
            Locked out? Set <code>AUTH_UI_ENABLED=false</code> (an add-on option in Home Assistant),
            change the password, then switch it back on.
          </div>
        )}
      </form>
    </div>
  );
}
