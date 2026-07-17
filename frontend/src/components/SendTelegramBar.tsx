import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Radio, X, AlertTriangle, CheckCircle2, Timer } from 'lucide-react';

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
  /** Address to start with (row shortcut, #187). Remount via `key` to re-apply. */
  initialAddress?: string;
  onClose: () => void;
}

const GA_RE = /^\d{1,2}\/\d{1,2}\/\d{1,3}$|^\d{1,2}\/\d{1,4}$|^\d{1,5}$/;

const POLL_INTERVAL_MS = 1000;

/**
 * Group-monitor send bar: write a value to a group address or trigger a
 * GroupValueRead. Optionally delays the send or repeats it cyclically (#167).
 * Shown above the telegram table in live mode only, and only when the backend
 * reports the bus is writable.
 */
export function SendTelegramBar({ targets, initialAddress, onClose }: Props) {
  const [address, setAddress] = useState(initialAddress ?? '');
  const [dpt, setDpt] = useState(() => {
    const known = targets.find(t => t.address === initialAddress);
    return known && known.main != null ? formatDpt(known.main, known.sub) : '';
  });
  const [value, setValue] = useState('');
  const [delay, setDelay] = useState('');
  const [every, setEvery] = useState('');
  const [recentGas, setRecentGas] = useState<string[]>(loadRecentGas);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [job, setJob] = useState<ScheduledSendStatus | null>(null);
  const pollRef = useRef<number | null>(null);
  const watchingRef = useRef(false);

  const byAddress = useMemo(() => {
    const m = new Map<string, FilterOption>();
    for (const t of targets) if (t.address) m.set(t.address, t);
    return m;
  }, [targets]);

  const known = byAddress.get(address.trim());
  const dptMain = known?.main ?? undefined;
  const addressValid = GA_RE.test(address.trim());

  const delaySeconds = parseFloat(delay) || 0;
  const intervalSeconds = parseFloat(every) || 0;
  const isScheduled = delaySeconds > 0 || intervalSeconds > 0;
  const jobActive = job != null && (job.state === 'waiting' || job.state === 'running');
  const sendDisabled = busy || jobActive || !addressValid;

  // Pick up an already-active job (e.g. after a page reload) and clean up the poller.
  useEffect(() => {
    void refreshJob();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAddressChange = (next: string, option?: FilterOption) => {
    setAddress(next);
    setFeedback(null);
    // Prefill the DPT from the project when a known GA is picked/typed.
    const match = option ?? byAddress.get(next.trim());
    if (match && match.main != null) setDpt(formatDpt(match.main, match.sub));
  };

  const write = async (payload: boolean | number | string) => {
    setBusy(true);
    setFeedback(null);
    try {
      if (isScheduled) {
        await startScheduled(payload);
      } else {
        await sendTelegram(address.trim(), payload, dpt.trim() || undefined);
        const shown = typeof payload === 'boolean' ? (payload ? 'on' : 'off') : value || '(raw)';
        setFeedback({ ok: true, msg: `Sent ${shown} to ${address.trim()}` });
      }
      setRecentGas(pushRecentGa(address.trim()));
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setBusy(false);
    }
  };

  const read = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      await readTelegram(address.trim());
      setFeedback({ ok: true, msg: `Read request sent to ${address.trim()}` });
      setRecentGas(pushRecentGa(address.trim()));
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setBusy(false);
    }
  };

  const label = known?.name;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '0.5rem',
      padding: '0.6rem 0.85rem', marginBottom: '0.6rem',
      background: 'var(--bg-subtle)', border: '1px solid var(--border-color)', borderRadius: '8px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-primary)' }}>
          <Send size={15} /> Send to bus
        </span>

        <GaCombobox
          value={address}
          onChange={onAddressChange}
          options={targets}
          recentAddresses={recentGas}
          placeholder="Group address (e.g. 1/2/3)"
          width={200}
        />

        <input
          className="glass-input"
          placeholder="DPT (e.g. 1.001)"
          value={dpt}
          onChange={e => { setDpt(e.target.value); setFeedback(null); }}
          title="Datapoint type used to encode the value. Prefilled from the project when known."
          style={{ width: 110, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem' }}
        />

        <WriteControls
          dptMain={dptMain}
          value={value}
          onValueChange={v => { setValue(v); setFeedback(null); }}
          onWrite={payload => void write(payload)}
          disabled={sendDisabled}
        />

        <input
          className="glass-input"
          placeholder="Delay s"
          value={delay}
          onChange={e => { setDelay(e.target.value); setFeedback(null); }}
          title="Wait this many seconds before sending"
          style={{ width: 70 }}
        />

        <input
          className="glass-input"
          placeholder="Every s"
          value={every}
          onChange={e => { setEvery(e.target.value); setFeedback(null); }}
          title="Repeat the send at this interval in seconds (min 1) until cancelled"
          style={{ width: 70 }}
        />

        <button
          onClick={() => void read()}
          disabled={busy || !addressValid}
          style={secondaryBtn(busy || !addressValid)}
          title="Send a GroupValueRead; the response updates the last value"
        >
          <Radio size={14} /> Read
        </button>

        <button className="icon-button" onClick={onClose} title="Close send bar" style={{ marginLeft: 'auto', color: 'var(--text-dim)' }}>
          <X size={16} />
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

      {(label || feedback) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.72rem', minHeight: '1rem' }}>
          {label && <span style={{ color: 'var(--text-dim)' }}>{address.trim()} — {label}</span>}
          {feedback && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginLeft: label ? 'auto' : 0, color: feedback.ok ? 'var(--success)' : 'var(--error)' }}>
              {feedback.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {feedback.msg}
            </span>
          )}
        </div>
      )}
    </div>
  );

  async function startScheduled(payload: unknown) {
    if (intervalSeconds > 0 && intervalSeconds < 1) {
      setFeedback({ ok: false, msg: 'Interval must be at least 1 second' });
      return;
    }
    const status = await startScheduledSend(address.trim(), payload, dpt.trim() || undefined, {
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
    if (watchingRef.current) {
      watchingRef.current = false;
      if (status.state === 'done') {
        setFeedback({ ok: true, msg: `Sent to ${status.address}` });
      } else if (status.state === 'cancelled') {
        setFeedback({ ok: true, msg: `Scheduled send to ${status.address} cancelled after ${status.sends_done ?? 0} send(s)` });
      } else if (status.state === 'failed') {
        setFeedback({ ok: false, msg: status.error || 'Scheduled send failed' });
      }
    }
  }

  async function cancelJob() {
    try {
      await cancelScheduledSend();
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Cancel failed' });
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

