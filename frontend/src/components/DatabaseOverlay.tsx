import React, { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, Database, Trash2, HardDrive, AlertTriangle } from 'lucide-react';
import { apiUrl } from '../utils/basePath';

interface DatabaseInfo {
  backend: string;
  telegram_count: number;
  oldest_timestamp: string | null;
  newest_timestamp: string | null;
  size_bytes: number | null;
  retention_days: number | null;
  supports_size_stats: boolean;
  supports_optimize: boolean;
  read_only: boolean;
}

interface PurgePreview {
  count: number;
  cutoff: string | null; // null = purge all
}

interface DatabaseOverlayProps {
  onClose: () => void;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'n/a';
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} kB`;
  return `${bytes} B`;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

const PRESETS = [
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
];

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase',
  marginBottom: '0.75rem', letterSpacing: '0.05em',
};

const InfoTile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '0.75rem 1rem' }}>
    <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem' }}>
      {label}
    </div>
    <div style={{ fontSize: '0.95rem', color: 'var(--text-main)', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
      {value}
    </div>
  </div>
);

export const DatabaseOverlay: React.FC<DatabaseOverlayProps> = ({ onClose }) => {
  const [info, setInfo] = useState<DatabaseInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [cutoffDate, setCutoffDate] = useState('');
  const [preview, setPreview] = useState<PurgePreview | null>(null);
  const [isPurging, setIsPurging] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchInfo = useCallback(() => {
    setIsLoading(true);
    fetch(apiUrl('/api/database/info'))
      .then(r => r.json())
      .then((d: DatabaseInfo) => setInfo(d))
      .catch(() => setError('Failed to load database info'))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchInfo();
  }, [fetchInfo]);

  const purgeBody = (cutoff: string | null, dryRun: boolean) =>
    cutoff === null
      ? { purge_all: true, dry_run: dryRun }
      : { older_than: cutoff, dry_run: dryRun };

  const requestPreview = useCallback((cutoff: string | null) => {
    setMessage(null);
    setError(null);
    setIsPurging(true);
    fetch(apiUrl('/api/database/purge'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(purgeBody(cutoff, true)),
    })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => setPreview({ count: d.deleted, cutoff }))
      .catch(() => setError('Failed to compute purge preview'))
      .finally(() => setIsPurging(false));
  }, []);

  const confirmPurge = useCallback(() => {
    if (!preview) return;
    setIsPurging(true);
    setError(null);
    fetch(apiUrl('/api/database/purge'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(purgeBody(preview.cutoff, false)),
    })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => {
        setMessage(
          `Deleted ${d.deleted.toLocaleString()} telegrams.` +
          (info?.supports_optimize ? ' Run "Reclaim space" below to shrink the database.' : ''),
        );
        setPreview(null);
        fetchInfo();
      })
      .catch(() => setError('Purge failed'))
      .finally(() => setIsPurging(false));
  }, [preview, info, fetchInfo]);

  const runOptimize = useCallback(() => {
    setIsOptimizing(true);
    setMessage(null);
    setError(null);
    fetch(apiUrl('/api/database/optimize'), { method: 'POST' })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => {
        const freed = (d.size_bytes_before ?? 0) - (d.size_bytes_after ?? 0);
        setMessage(freed > 0 ? `Reclaimed ${formatBytes(freed)} of disk space.` : 'Database is already compact.');
        fetchInfo();
      })
      .catch(() => setError('Optimization failed'))
      .finally(() => setIsOptimizing(false));
  }, [fetchInfo]);

  const presetCutoff = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
  };

  const busy = isPurging || isOptimizing;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)',
        flexShrink: 0, background: 'var(--bg-subtle)',
      }}>
        <Database size={16} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>Database Maintenance</span>
        {info && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', background: 'var(--bg-tag)', padding: '0.15rem 0.5rem', borderRadius: '999px', border: '1px solid var(--border-color)' }}>
            {info.backend}
          </span>
        )}
        {info?.read_only && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', background: 'var(--bg-tag)', padding: '0.15rem 0.5rem', borderRadius: '999px', border: '1px solid var(--border-color)' }}>
            read-only
          </span>
        )}
        <button
          onClick={fetchInfo}
          disabled={isLoading}
          title="Refresh"
          style={{ background: 'transparent', border: 'none', cursor: isLoading ? 'not-allowed' : 'pointer', color: 'var(--text-dim)', padding: '0.2rem', display: 'flex', marginLeft: 'auto' }}
        >
          <RefreshCw size={14} style={isLoading ? { animation: 'spin 1s linear infinite' } : undefined} />
        </button>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: '0.2rem', display: 'flex' }}>
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {!info && isLoading && (
            <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '3rem' }}>Loading…</div>
          )}

          {info && (
            <>
              {/* Info tiles */}
              <div>
                <h3 style={sectionTitleStyle}>Storage</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
                  <InfoTile label="Telegrams" value={info.telegram_count.toLocaleString()} />
                  <InfoTile label="Size" value={info.supports_size_stats ? formatBytes(info.size_bytes) : 'n/a'} />
                  <InfoTile label="Oldest telegram" value={formatTimestamp(info.oldest_timestamp)} />
                  <InfoTile label="Newest telegram" value={formatTimestamp(info.newest_timestamp)} />
                  <InfoTile label="Retention" value={info.retention_days ? `${info.retention_days} days` : 'unlimited'} />
                </div>
              </div>

              {/* Read-only note */}
              {info.read_only && (
                <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '1rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                  This database is owned and managed by another application (e.g. Home Assistant) —
                  retention, purging and space reclamation are configured there.
                </div>
              )}

              {/* Purge */}
              {!info.read_only && (
              <div>
                <h3 style={sectionTitleStyle}>Purge old telegrams</h3>
                <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '1rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '0.75rem' }}>
                    Delete telegrams recorded before a date. You will see how many telegrams are affected before anything is deleted.
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    {PRESETS.map(p => (
                      <button
                        key={p.days}
                        className="glass-button"
                        disabled={busy}
                        onClick={() => requestPreview(presetCutoff(p.days))}
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-tag)', color: 'var(--text-main)', cursor: busy ? 'not-allowed' : 'pointer' }}
                      >
                        Older than {p.label}
                      </button>
                    ))}
                    <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>or before</span>
                    <input
                      type="date"
                      value={cutoffDate}
                      onChange={e => setCutoffDate(e.target.value)}
                      className="glass-input"
                      style={{ padding: '0.35rem 0.6rem', fontSize: '0.8rem', borderRadius: 6 }}
                    />
                    <button
                      className="glass-button"
                      disabled={busy || !cutoffDate}
                      onClick={() => requestPreview(new Date(cutoffDate).toISOString())}
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-tag)', color: 'var(--text-main)', cursor: busy || !cutoffDate ? 'not-allowed' : 'pointer' }}
                    >
                      Preview
                    </button>
                    <div style={{ flex: 1 }} />
                    <button
                      disabled={busy}
                      onClick={() => requestPreview(null)}
                      title="Delete all stored telegrams"
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', borderRadius: 6, border: '1px solid var(--error)', background: 'transparent', color: 'var(--error)', cursor: busy ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                    >
                      <Trash2 size={13} /> Delete all
                    </button>
                  </div>

                  {/* Confirmation */}
                  {preview && (
                    <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', border: '1px solid var(--error)', borderRadius: 8, background: 'rgba(239, 68, 68, 0.08)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <AlertTriangle size={16} style={{ color: 'var(--error)', flexShrink: 0 }} />
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-main)', flex: 1 }}>
                        {preview.count === 0
                          ? 'No telegrams match this cutoff.'
                          : preview.cutoff === null
                            ? <>This will permanently delete <b>all {preview.count.toLocaleString()} telegrams</b>.</>
                            : <>This will permanently delete <b>{preview.count.toLocaleString()} telegrams</b> recorded before {formatTimestamp(preview.cutoff)}.</>}
                      </span>
                      <button
                        onClick={() => setPreview(null)}
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', borderRadius: 6, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                      {preview.count > 0 && (
                        <button
                          disabled={isPurging}
                          onClick={confirmPurge}
                          style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', fontWeight: 600, borderRadius: 6, border: 'none', background: 'var(--error)', color: 'white', cursor: isPurging ? 'not-allowed' : 'pointer' }}
                        >
                          {isPurging ? 'Deleting…' : `Delete ${preview.count.toLocaleString()} telegrams`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
              )}

              {/* Optimize */}
              {info.supports_optimize && (
                <div>
                  <h3 style={sectionTitleStyle}>Reclaim space</h3>
                  <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', flex: 1, minWidth: 260 }}>
                      Deleting telegrams does not shrink the database on disk by itself. Reclaiming space compacts the
                      database (VACUUM); this can take a while and briefly blocks writes on large databases.
                    </div>
                    <button
                      disabled={busy}
                      onClick={runOptimize}
                      style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem', fontWeight: 600, borderRadius: 6, border: '1px solid var(--accent-primary)', background: 'transparent', color: 'var(--accent-primary)', cursor: busy ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                    >
                      <HardDrive size={14} /> {isOptimizing ? 'Reclaiming…' : 'Reclaim space'}
                    </button>
                  </div>
                </div>
              )}

              {/* Result / error messages */}
              {message && (
                <div style={{ padding: '0.75rem 1rem', borderRadius: 8, border: '1px solid var(--success)', color: 'var(--success)', fontSize: '0.85rem' }}>
                  {message}
                </div>
              )}
              {error && (
                <div style={{ padding: '0.75rem 1rem', borderRadius: 8, border: '1px solid var(--error)', color: 'var(--error)', fontSize: '0.85rem' }}>
                  {error}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
