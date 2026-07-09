import ReactMarkdown from 'react-markdown';
import { Sparkles, X, ExternalLink } from 'lucide-react';
import type { UpdateInfo } from '../hooks/useUpdateCheck';
import { getBasePath } from '../utils/basePath';

interface UpdateNotificationProps {
  info: UpdateInfo;
  onClose: () => void;
}

const formatDate = (iso?: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
};

// Under Home Assistant Ingress the app is served at /api/hassio_ingress/<token>/,
// so the user updates via the add-on page rather than any in-app action.
const isHomeAssistant = (): boolean => getBasePath().includes('hassio_ingress');

export function UpdateNotification({ info, onClose }: UpdateNotificationProps) {
  const releases = info.releases ?? [];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(10, 10, 15, 0.85)', backdropFilter: 'blur(12px)', zIndex: 1000, padding: '2rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative', width: '100%', maxWidth: '560px', maxHeight: '80vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg-panel, #16161d)', border: '1px solid var(--border-color)',
          borderRadius: '14px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: '9px', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(99,102,241,0.15)', color: 'var(--accent-primary)',
          }}>
            <Sparkles size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>
              Update available
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
              {info.current} → <strong style={{ color: 'var(--accent-primary)' }}>{info.latest}</strong>
              {formatDate(info.published_at) && <span> · {formatDate(info.published_at)}</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            title="Dismiss"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)',
              padding: '0.35rem', borderRadius: '6px', display: 'flex', flexShrink: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-main)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Release notes */}
        <div className="update-notes" style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }}>
          {releases.length === 0 ? (
            <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
              A new version is available. See the release notes on GitHub for details.
            </p>
          ) : (
            releases.map(rel => (
              <div key={rel.version} style={{ marginBottom: '1.25rem' }}>
                <div style={{
                  fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)',
                  marginBottom: '0.4rem', fontFamily: '"JetBrains Mono", monospace',
                }}>
                  {rel.name || rel.version}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
                  <ReactMarkdown
                    components={{
                      a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)' }} />,
                    }}
                  >
                    {rel.notes}
                  </ReactMarkdown>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)',
        }}>
          <div style={{ flex: 1, fontSize: '0.75rem', color: 'var(--text-dim)' }}>
            {isHomeAssistant()
              ? 'Update from the Spectrum KNX add-on page in Home Assistant.'
              : 'Pull the latest image / installer to update.'}
          </div>
          {info.html_url && (
            <a
              href={info.html_url}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none',
                padding: '0.5rem 0.85rem', borderRadius: '7px', fontSize: '0.8rem', fontWeight: 600,
                border: '1px solid var(--accent-primary)', background: 'rgba(99,102,241,0.12)',
                color: 'var(--accent-primary)', whiteSpace: 'nowrap',
              }}
            >
              <ExternalLink size={14} />
              View on GitHub
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
