import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FolderInput, Upload, Download, AlertTriangle, Loader2, CheckCircle2,
  XCircle, Ban, FileArchive,
} from 'lucide-react';
import { apiUrl } from '../utils/basePath';

// Mirrors ImportJob.to_dict() in backend/telegram_import.py plus the read_only flag.
interface ImportStatus {
  state: 'idle' | 'running' | 'done' | 'failed' | 'cancelled';
  filename?: string;
  files_total?: number;
  files_done?: number;
  current_file?: string;
  telegrams_parsed?: number;
  telegrams_imported?: number;
  duplicates_skipped?: number;
  acks_skipped?: number;
  non_group_skipped?: number;
  errors?: number;
  error?: string | null;
  read_only?: boolean;
}

const POLL_INTERVAL_MS = 500;

const cardStyle: React.CSSProperties = {
  padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)',
  background: 'var(--bg-subtle)', display: 'flex', flexDirection: 'column', gap: '1rem',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)',
  display: 'flex', alignItems: 'center', gap: '0.5rem',
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

export function ImportExportView() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<ImportStatus>({ state: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<number | null>(null);

  // Export filter state
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [sourceAddress, setSourceAddress] = useState('');
  const [targetAddress, setTargetAddress] = useState('');
  const [telegramType, setTelegramType] = useState('');

  const readOnly = status.read_only === true;
  const isRunning = status.state === 'running';

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/import/status'));
      if (res.ok) setStatus(await res.json());
    } catch {
      // transient; next poll retries
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current !== null) return;
    pollRef.current = window.setInterval(fetchStatus, POLL_INTERVAL_MS);
  }, [fetchStatus]);

  // Pick up any already-running job on mount (page-reload safe) and read the mode.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStatus();
    return stopPolling;
  }, [fetchStatus, stopPolling]);

  // Poll only while a job is running.
  useEffect(() => {
    if (isRunning) startPolling();
    else stopPolling();
  }, [isRunning, startPolling, stopPolling]);

  const handleStart = async () => {
    if (!file) return;
    setError(null);
    setStarting(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch(apiUrl('/api/import'), { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data.detail === 'string' ? data.detail : 'Import failed to start');
      }
      setStatus(data);
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed to start');
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    try {
      await fetch(apiUrl('/api/import/cancel'), { method: 'POST' });
      fetchStatus();
    } catch {
      // ignore; job will finish or the next poll reflects state
    }
  };

  const handleFilePick = (picked: File | null) => {
    setError(null);
    if (picked && !/\.(xml|zip)$/i.test(picked.name)) {
      setError('File must be a .xml or .zip telegram log.');
      setFile(null);
      return;
    }
    setFile(picked);
  };

  const handleExport = () => {
    const params = new URLSearchParams();
    if (startTime) params.set('start_time', new Date(startTime).toISOString());
    if (endTime) params.set('end_time', new Date(endTime).toISOString());
    if (sourceAddress.trim()) params.set('source_address', sourceAddress.trim());
    if (targetAddress.trim()) params.set('target_address', targetAddress.trim());
    if (telegramType.trim()) params.set('telegram_type', telegramType.trim());
    const qs = params.toString();
    window.location.href = apiUrl(`/api/export${qs ? `?${qs}` : ''}`);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '0 1.25rem', height: '3.5rem', borderBottom: '1px solid var(--border-color)',
        display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0,
      }}>
        <FolderInput size={18} className="accent-primary" />
        <span style={{ fontWeight: 600 }}>Import / Export</span>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
          Offline analysis of ETS6 / Gira telegram logs
        </span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '1.5rem' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* ── Import card ── */}
          <div style={cardStyle}>
            <div style={labelStyle}><Upload size={16} /> Import telegram log</div>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>
              Upload an ETS6 group-monitor export (<code>.xml</code>) or a Gira data-logger
              dump (<code>.zip</code> of daily XML files). Telegrams are decoded, de-duplicated
              and added to the store, where every history and analysis feature works on them.
            </p>

            {readOnly ? (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.85rem 1rem',
                background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.3)',
                borderRadius: '8px', color: '#eab308', fontSize: '0.85rem',
              }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                <span>Import is unavailable in read-only companion mode.</span>
              </div>
            ) : (
              <>
                <label
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    handleFilePick(e.dataTransfer.files?.[0] || null);
                  }}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
                    padding: '1.75rem', borderRadius: '10px', cursor: isRunning ? 'not-allowed' : 'pointer',
                    border: `1.5px dashed ${isDragging ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: isDragging ? 'rgba(99,102,241,0.08)' : 'rgba(0,0,0,0.15)',
                    transition: 'all 0.15s ease', opacity: isRunning ? 0.5 : 1,
                  }}
                >
                  <FileArchive size={26} style={{ color: 'var(--text-dim)' }} />
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-main)', fontWeight: 500 }}>
                    {file ? file.name : 'Drop a file here, or click to browse'}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                    {file ? formatBytes(file.size) : '.xml or .zip'}
                  </span>
                  <input
                    type="file" accept=".xml,.zip" hidden disabled={isRunning}
                    onChange={(e) => handleFilePick(e.target.files?.[0] || null)}
                  />
                </label>

                <button
                  onClick={handleStart}
                  disabled={!file || isRunning || starting}
                  style={{
                    padding: '0.75rem', borderRadius: '8px', border: 'none',
                    background: !file || isRunning || starting ? 'rgba(99,102,241,0.5)' : 'var(--accent-primary)',
                    color: 'white', fontWeight: 600, fontSize: '0.95rem',
                    cursor: !file || isRunning || starting ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                  }}
                >
                  {starting
                    ? <><Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} /> Starting…</>
                    : <>Start import</>}
                </button>
              </>
            )}

            {error && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.75rem 1rem',
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: '8px', color: '#fca5a5', fontSize: '0.85rem',
              }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* ── Progress / result card ── */}
          {status.state !== 'idle' && (
            <div style={cardStyle}>
              <div style={{ ...labelStyle, justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {isRunning && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} className="accent-primary" />}
                  {status.state === 'done' && <CheckCircle2 size={16} style={{ color: 'var(--success, #22c55e)' }} />}
                  {status.state === 'failed' && <XCircle size={16} style={{ color: '#ef4444' }} />}
                  {status.state === 'cancelled' && <Ban size={16} style={{ color: 'var(--text-dim)' }} />}
                  {isRunning ? 'Importing' : `Import ${status.state}`}
                  {status.filename ? ` — ${status.filename}` : ''}
                </span>
                {isRunning && (
                  <button
                    onClick={handleCancel}
                    style={{
                      padding: '0.35rem 0.8rem', borderRadius: '6px', fontSize: '0.8rem',
                      border: '1px solid var(--border-color)', background: 'transparent',
                      color: 'var(--text-dim)', cursor: 'pointer', fontWeight: 500,
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>

              {isRunning && (status.files_total ?? 0) > 0 && (
                <div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: '0.35rem' }}>
                    {status.current_file || `File ${status.files_done ?? 0} / ${status.files_total}`}
                  </div>
                  <div style={{ height: 6, borderRadius: 999, background: 'rgba(0,0,0,0.25)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 999, background: 'var(--accent-primary)',
                      width: `${Math.round(((status.files_done ?? 0) / (status.files_total || 1)) * 100)}%`,
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                </div>
              )}

              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem',
              }}>
                <Stat label="Imported" value={status.telegrams_imported} accent />
                <Stat label="Parsed" value={status.telegrams_parsed} />
                <Stat label="Duplicates" value={status.duplicates_skipped} />
                <Stat label="ACKs skipped" value={status.acks_skipped} />
                <Stat label="Non-group" value={status.non_group_skipped} />
                <Stat label="Errors" value={status.errors} danger={(status.errors ?? 0) > 0} />
              </div>

              {status.state === 'failed' && status.error && (
                <div style={{ fontSize: '0.82rem', color: '#fca5a5' }}>{status.error}</div>
              )}
            </div>
          )}

          {/* ── Export card ── */}
          <div style={cardStyle}>
            <div style={labelStyle}><Download size={16} /> Export to ETS6 XML</div>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>
              Download stored telegrams as an ETS6-compatible <code>CommunicationLog</code>.
              Leave filters blank to export everything.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <Field label="Start time">
                <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                  className="glass-input" style={{ padding: '0.5rem', width: '100%' }} />
              </Field>
              <Field label="End time">
                <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                  className="glass-input" style={{ padding: '0.5rem', width: '100%' }} />
              </Field>
              <Field label="Source (PA)">
                <input value={sourceAddress} onChange={(e) => setSourceAddress(e.target.value)}
                  placeholder="e.g. 1.1.1" className="glass-input" style={{ padding: '0.5rem', width: '100%' }} />
              </Field>
              <Field label="Destination (GA)">
                <input value={targetAddress} onChange={(e) => setTargetAddress(e.target.value)}
                  placeholder="e.g. 1/2/3" className="glass-input" style={{ padding: '0.5rem', width: '100%' }} />
              </Field>
              <Field label="Type">
                <input value={telegramType} onChange={(e) => setTelegramType(e.target.value)}
                  placeholder="Write, Read, Response" className="glass-input" style={{ padding: '0.5rem', width: '100%' }} />
              </Field>
            </div>

            <button
              onClick={handleExport}
              style={{
                padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)',
                background: 'var(--bg-tag)', color: 'var(--text-main)', fontWeight: 600, fontSize: '0.95rem',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              }}
            >
              <Download size={17} /> Download ETS6 XML
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent, danger }: { label: string; value?: number; accent?: boolean; danger?: boolean }) {
  return (
    <div style={{
      padding: '0.65rem 0.85rem', borderRadius: '8px', background: 'rgba(0,0,0,0.18)',
      border: '1px solid var(--border-color)',
    }}>
      <div style={{
        fontSize: '1.15rem', fontWeight: 700,
        color: danger ? '#ef4444' : accent ? 'var(--accent-primary)' : 'var(--text-main)',
      }}>
        {(value ?? 0).toLocaleString()}
      </div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>{label}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dim)' }}>{label}</label>
      {children}
    </div>
  );
}
