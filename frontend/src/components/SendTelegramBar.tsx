import { useMemo, useState } from 'react';
import { Send, Radio, X, AlertTriangle, CheckCircle2 } from 'lucide-react';

import type { FilterOption } from '../types/filters';
import { coerceValue, formatDpt, readTelegram, sendTelegram } from '../utils/knxSend';
import { GaCombobox } from './GaCombobox';

interface Props {
  /** Group addresses from the loaded project (with optional DPT main/sub). */
  targets: FilterOption[];
  onClose: () => void;
}

const GA_RE = /^\d{1,2}\/\d{1,2}\/\d{1,3}$|^\d{1,2}\/\d{1,4}$|^\d{1,5}$/;

/**
 * Group-monitor send bar: write a value to a group address or trigger a
 * GroupValueRead. Shown above the telegram table in live mode only, and only
 * when the backend reports the bus is writable.
 */
export function SendTelegramBar({ targets, onClose }: Props) {
  const [address, setAddress] = useState('');
  const [dpt, setDpt] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const byAddress = useMemo(() => {
    const m = new Map<string, FilterOption>();
    for (const t of targets) if (t.address) m.set(t.address, t);
    return m;
  }, [targets]);

  const known = byAddress.get(address.trim());
  const dptMain = known?.main ?? undefined;
  const addressValid = GA_RE.test(address.trim());

  const onAddressChange = (next: string, option?: FilterOption) => {
    setAddress(next);
    setFeedback(null);
    // Prefill the DPT from the project when a known GA is picked/typed.
    const match = option ?? byAddress.get(next.trim());
    if (match && match.main != null) setDpt(formatDpt(match.main, match.sub));
  };

  const run = async (action: 'send' | 'read') => {
    setBusy(true);
    setFeedback(null);
    try {
      if (action === 'read') {
        await readTelegram(address.trim());
        setFeedback({ ok: true, msg: `Read request sent to ${address.trim()}` });
      } else {
        await sendTelegram(address.trim(), coerceValue(value), dpt.trim() || undefined);
        setFeedback({ ok: true, msg: `Sent ${value || '(raw)'} to ${address.trim()}` });
      }
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

        {dptMain === 1 ? (
          <div style={{ display: 'flex', gap: '0.3rem' }}>
            <button disabled={busy || !addressValid} onClick={() => void sendBoolean(true)} style={boolBtn(busy || !addressValid)}>On</button>
            <button disabled={busy || !addressValid} onClick={() => void sendBoolean(false)} style={boolBtn(busy || !addressValid)}>Off</button>
          </div>
        ) : (
          <input
            className="glass-input"
            placeholder="Value (e.g. 50, 21.5, on)"
            value={value}
            onChange={e => { setValue(e.target.value); setFeedback(null); }}
            style={{ width: 170 }}
          />
        )}

        {dptMain !== 1 && (
          <button
            onClick={() => run('send')}
            disabled={busy || !addressValid || value.trim() === ''}
            style={primaryBtn(busy || !addressValid || value.trim() === '')}
          >
            <Send size={14} /> Write
          </button>
        )}

        <button
          onClick={() => run('read')}
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

  async function sendBoolean(on: boolean) {
    setBusy(true);
    setFeedback(null);
    try {
      await sendTelegram(address.trim(), on, dpt.trim() || undefined);
      setFeedback({ ok: true, msg: `Sent ${on ? 'on' : 'off'} to ${address.trim()}` });
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setBusy(false);
    }
  }
}

function boolBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '0.35rem 0.85rem', fontSize: '0.78rem', fontWeight: 600,
    background: 'var(--bg-tag)', color: 'var(--text-main)',
    border: '1px solid var(--border-color)', borderRadius: '6px',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  };
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: '0.35rem',
    padding: '0.35rem 0.8rem', fontSize: '0.78rem', fontWeight: 600,
    background: 'var(--accent-primary)', color: 'white',
    border: 'none', borderRadius: '6px',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  };
}

function secondaryBtn(disabled: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: '0.35rem',
    padding: '0.35rem 0.8rem', fontSize: '0.78rem', fontWeight: 600,
    background: 'transparent', color: 'var(--accent-primary)',
    border: '1px solid var(--accent-primary)', borderRadius: '6px',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  };
}
