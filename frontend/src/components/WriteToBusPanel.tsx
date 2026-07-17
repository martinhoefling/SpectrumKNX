import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Radio, X, Plus, AlertTriangle, CheckCircle2, Timer } from 'lucide-react';

import type { FilterOption } from '../types/filters';
import {
  formatDpt,
  readTelegram,
  sendTelegram,
  startScheduledSend,
  getScheduledSendStatus,
  cancelScheduledSend,
  type ScheduledSendStatus,
} from '../utils/knxSend';
import { GaCombobox } from './GaCombobox';
import { WriteControls } from './WriteControls';
import { secondaryBtn } from '../utils/buttonStyles';
import { loadRecentGas, pushRecentGa } from '../utils/recentGas';

interface Props {
  /** Group addresses from the loaded project (with optional DPT main/sub). */
  targets: FilterOption[];
  onClose: () => void;
}

interface Row {
  id: string;
  address: string;
  dpt: string;
  value: string;
  delay: string;
  every: string;
  busy: boolean;
  feedback: { ok: boolean; msg: string } | null;
}

const GA_RE = /^\d{1,2}\/\d{1,2}\/\d{1,3}$|^\d{1,2}\/\d{1,4}$|^\d{1,5}$/;
const POLL_INTERVAL_MS = 1000;

let rowSeq = 0;
const newRow = (): Row => ({
  id: `row-${rowSeq++}`, address: '', dpt: '', value: '', delay: '', every: '', busy: false, feedback: null,
});

/**
 * "Write to bus" panel: send to several group addresses from stacked rows,
 * each with its own GA/DPT/value/Write/Read and optional delay/cyclic
 * scheduling, plus per-row add/remove (#215).
 *
 * The backend runs a single scheduled (delayed/cyclic) job at a time, so at
 * most one row can have an active timer; immediate writes/reads work on any
 * row regardless. Removing the row that owns the active job cancels it first.
 */
export function WriteToBusPanel({ targets, onClose }: Props) {
  const [rows, setRows] = useState<Row[]>(() => [newRow()]);
  const [recentGas, setRecentGas] = useState<string[]>(loadRecentGas);
  const [job, setJob] = useState<ScheduledSendStatus | null>(null);
  const pollRef = useRef<number | null>(null);
  const watchingRef = useRef(false);

  const byAddress = useMemo(() => {
    const m = new Map<string, FilterOption>();
    for (const t of targets) if (t.address) m.set(t.address, t);
    return m;
  }, [targets]);

  const jobActive = job != null && (job.state === 'waiting' || job.state === 'running');

  // Pick up an already-active job (e.g. after a page reload) and clean up the poller.
  useEffect(() => {
    void refreshJob();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateRow = (id: string, patch: Partial<Row>) =>
    setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));

  const addRow = () => setRows(rs => [...rs, newRow()]);

  const removeRow = async (id: string) => {
    const row = rows.find(r => r.id === id);
    // Removing the row that owns the running timer must cancel it, so we don't
    // leave an untracked cyclic send firing (TabSel, forum post #130).
    if (row && jobActive && job?.address === row.address.trim()) {
      await cancelScheduledSend().catch(() => {});
      await refreshJob();
    }
    setRows(rs => (rs.length > 1 ? rs.filter(r => r.id !== id) : rs));
  };

  const onAddressChange = (id: string, next: string, option?: FilterOption) => {
    const match = option ?? byAddress.get(next.trim());
    updateRow(id, {
      address: next,
      feedback: null,
      ...(match && match.main != null ? { dpt: formatDpt(match.main, match.sub) } : {}),
    });
  };

  const write = async (row: Row, payload: boolean | number | string) => {
    const delaySeconds = parseFloat(row.delay) || 0;
    const intervalSeconds = parseFloat(row.every) || 0;
    const scheduled = delaySeconds > 0 || intervalSeconds > 0;
    updateRow(row.id, { busy: true, feedback: null });
    try {
      if (scheduled) {
        await startScheduled(row, payload, delaySeconds, intervalSeconds);
      } else {
        await sendTelegram(row.address.trim(), payload, row.dpt.trim() || undefined);
        const shown = typeof payload === 'boolean' ? (payload ? 'on' : 'off') : row.value || '(raw)';
        updateRow(row.id, { feedback: { ok: true, msg: `Sent ${shown} to ${row.address.trim()}` } });
      }
      setRecentGas(pushRecentGa(row.address.trim()));
    } catch (err) {
      updateRow(row.id, { feedback: { ok: false, msg: err instanceof Error ? err.message : 'Request failed' } });
    } finally {
      updateRow(row.id, { busy: false });
    }
  };

  const read = async (row: Row) => {
    updateRow(row.id, { busy: true, feedback: null });
    try {
      await readTelegram(row.address.trim());
      updateRow(row.id, { feedback: { ok: true, msg: `Read request sent to ${row.address.trim()}` } });
      setRecentGas(pushRecentGa(row.address.trim()));
    } catch (err) {
      updateRow(row.id, { feedback: { ok: false, msg: err instanceof Error ? err.message : 'Request failed' } });
    } finally {
      updateRow(row.id, { busy: false });
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '0.5rem',
      padding: '0.6rem 0.85rem', marginBottom: '0.6rem',
      background: 'var(--bg-subtle)', border: '1px solid var(--border-color)', borderRadius: '8px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-primary)' }}>
          <Send size={15} /> Write to bus
        </span>
        <button className="icon-button" onClick={onClose} title="Close write panel" style={{ marginLeft: 'auto', color: 'var(--text-dim)' }}>
          <X size={16} />
        </button>
      </div>

      {rows.map(row => {
        const known = byAddress.get(row.address.trim());
        const dptMain = known?.main ?? undefined;
        const addressValid = GA_RE.test(row.address.trim());
        const scheduledDisabled = row.busy || !addressValid;
        return (
          <div key={row.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <GaCombobox
                value={row.address}
                onChange={(next, option) => onAddressChange(row.id, next, option)}
                options={targets}
                recentAddresses={recentGas}
                placeholder="Group address (e.g. 1/2/3)"
                width={200}
              />

              <input
                className="glass-input"
                placeholder="DPT (e.g. 1.001)"
                value={row.dpt}
                onChange={e => updateRow(row.id, { dpt: e.target.value, feedback: null })}
                title="Datapoint type used to encode the value. Prefilled from the project when known."
                style={{ width: 110, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem' }}
              />

              <WriteControls
                dptMain={dptMain}
                value={row.value}
                onValueChange={v => updateRow(row.id, { value: v, feedback: null })}
                onWrite={payload => void write(row, payload)}
                disabled={scheduledDisabled}
              />

              <input
                className="glass-input"
                placeholder="Delay s"
                value={row.delay}
                onChange={e => updateRow(row.id, { delay: e.target.value, feedback: null })}
                title="Wait this many seconds before sending"
                style={{ width: 70 }}
              />

              <input
                className="glass-input"
                placeholder="Every s"
                value={row.every}
                onChange={e => updateRow(row.id, { every: e.target.value, feedback: null })}
                title="Repeat the send at this interval in seconds (min 1) until cancelled"
                style={{ width: 70 }}
              />

              <button
                onClick={() => void read(row)}
                disabled={row.busy || !addressValid}
                style={secondaryBtn(row.busy || !addressValid)}
                title="Send a GroupValueRead; the response updates the last value"
              >
                <Radio size={14} /> Read
              </button>

              <button
                className="icon-button"
                onClick={() => void removeRow(row.id)}
                disabled={rows.length === 1}
                title={rows.length === 1 ? 'At least one row is required' : 'Remove this row'}
                style={{ color: 'var(--text-dim)', opacity: rows.length === 1 ? 0.4 : 1 }}
              >
                <X size={15} />
              </button>
            </div>

            {row.feedback && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', color: row.feedback.ok ? 'var(--success)' : 'var(--error)' }}>
                {row.feedback.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {row.feedback.msg}
              </div>
            )}
          </div>
        );
      })}

      <div>
        <button onClick={addRow} style={secondaryBtn(false)} title="Add another send row">
          <Plus size={14} /> Add row
        </button>
      </div>

      {jobActive && job && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.72rem', color: 'var(--accent-primary)' }}>
          <Timer size={13} />
          <span>{describeJob(job)}</span>
          <button onClick={() => void cancelJob()} style={secondaryBtn(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );

  async function startScheduled(row: Row, payload: unknown, delaySeconds: number, intervalSeconds: number) {
    if (jobActive) {
      updateRow(row.id, { feedback: { ok: false, msg: 'A scheduled send is already active — cancel it first' } });
      return;
    }
    if (intervalSeconds > 0 && intervalSeconds < 1) {
      updateRow(row.id, { feedback: { ok: false, msg: 'Interval must be at least 1 second' } });
      return;
    }
    const status = await startScheduledSend(row.address.trim(), payload, row.dpt.trim() || undefined, {
      delaySeconds: delaySeconds > 0 ? delaySeconds : undefined,
      intervalSeconds: intervalSeconds > 0 ? intervalSeconds : undefined,
    });
    watchingRef.current = true;
    setJob(status);
    startPolling();
  }

  async function refreshJob() {
    let status: ScheduledSendStatus;
    try {
      status = await getScheduledSendStatus();
    } catch {
      return; // transient fetch error — keep polling
    }
    if (status.state === 'waiting' || status.state === 'running') {
      watchingRef.current = true;
      setJob(status);
      if (pollRef.current == null) startPolling();
      return;
    }
    stopPolling();
    setJob(null);
  }

  async function cancelJob() {
    try {
      await cancelScheduledSend();
    } catch {
      // ignore — refreshJob reflects the real state
    }
    await refreshJob();
  }

  function startPolling() {
    stopPolling();
    pollRef.current = window.setInterval(() => void refreshJob(), POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }
}

function describeJob(job: ScheduledSendStatus): string {
  if (job.state === 'waiting') {
    const at = job.next_send_at ? ` at ${new Date(job.next_send_at).toLocaleTimeString()}` : '';
    return `Delayed send to ${job.address} — first send${at}`;
  }
  if (job.interval_seconds) {
    const skipped = job.sends_skipped ? ` (${job.sends_skipped} skipped)` : '';
    return `Cyclic send to ${job.address} every ${job.interval_seconds}s — ${job.sends_done ?? 0} sent${skipped}`;
  }
  return `Sending to ${job.address}…`;
}
