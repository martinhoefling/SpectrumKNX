import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Send, Radio, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';

import { apiUrl } from '../utils/basePath';
import { formatDpt, readTelegram, sendTelegram } from '../utils/knxSend';
import { WriteControls } from './WriteControls';
import { secondaryBtn } from '../utils/buttonStyles';

interface Props {
  address: string;
  name?: string | null;
  dptMain?: number | null;
  dptSub?: number | null;
  /** Small icon-button label; defaults to the paper-plane send icon. */
  title?: string;
  /** Extra className for the trigger button (to match host styling). */
  buttonClassName?: string;
  /** Inline style for the trigger button. */
  buttonStyle?: React.CSSProperties;
}

/**
 * A "Send to this GA" affordance: a small trigger button that opens a compact
 * popover for a quick GroupValueWrite/Read on one group address, showing its
 * last seen value (#214). Deliberately *quick* — no delayed/cyclic scheduling,
 * which lives in the multi-GA "write to bus" panel (#215). The popover is
 * portalled to <body> and fixed-positioned so it is never clipped by scroll
 * containers (e.g. the virtualized telegram table).
 */
export function SendToGaPopover({ address, name, dptMain, dptSub, title = 'Send to this GA', buttonClassName, buttonStyle }: Props) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [last, setLast] = useState<{ value: string; at: string } | null>(null);

  const dpt = formatDpt(dptMain ?? undefined, dptSub ?? undefined);

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    // Prefer below-right of the button; clamp into the viewport.
    const width = 320;
    const left = Math.min(Math.max(8, b.left), window.innerWidth - width - 8);
    setPos({ top: b.bottom + 6, left });
  };

  const toggle = () => {
    if (open) { setOpen(false); return; }
    place();
    setOpen(true);
    setFeedback(null);
    void loadLast();
  };

  const loadLast = async () => {
    try {
      const res = await fetch(apiUrl(`/api/telegrams?target_address=${encodeURIComponent(address)}&limit=1`));
      const json = await res.json();
      const t = json.telegrams?.[0];
      if (t) {
        const shown = t.value_formatted ?? (t.value_numeric != null ? String(t.value_numeric) : '—');
        setLast({ value: `${shown}${t.unit ? ' ' + t.unit : ''}`, at: t.timestamp });
      } else {
        setLast(null);
      }
    } catch {
      setLast(null);
    }
  };

  // Reposition on scroll/resize and close on outside interaction / Escape.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onScroll = () => place();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!cardRef.current?.contains(n) && !btnRef.current?.contains(n)) setOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const write = async (payload: boolean | number | string) => {
    setBusy(true);
    setFeedback(null);
    try {
      await sendTelegram(address, payload, dpt || undefined);
      const shown = typeof payload === 'boolean' ? (payload ? 'on' : 'off') : String(payload);
      setFeedback({ ok: true, msg: `Sent ${shown}` });
      setTimeout(() => void loadLast(), 700);
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Send failed' });
    } finally {
      setBusy(false);
    }
  };

  const read = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      await readTelegram(address);
      setFeedback({ ok: true, msg: 'Read request sent' });
      setTimeout(() => void loadLast(), 700);
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Read failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        className={buttonClassName}
        style={{
          ...buttonStyle,
          color: hovered ? 'var(--accent-primary)' : (buttonStyle?.color || 'var(--text-dim)')
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={e => { e.stopPropagation(); toggle(); }}
        title={title}
      >
        <Send size={12} />
      </button>

      {open && pos && createPortal(
        <div
          ref={cardRef}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 1000, width: 320,
            background: 'var(--bg-panel)', backdropFilter: 'var(--glass-blur)',
            border: '1px solid var(--border-color)', borderRadius: 10, boxShadow: 'var(--shadow-lg)',
            padding: '0.7rem 0.8rem', display: 'flex', flexDirection: 'column', gap: '0.55rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent-primary)' }}>{address}</span>
            {name && <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>{name}</span>}
            {dpt && <span style={{ marginLeft: 'auto', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.68rem', color: 'var(--text-dim)' }}>DPT {dpt}</span>}
          </div>

          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
            Last value:{' '}
            <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{last ? last.value : '—'}</span>
            {last && (
              <span style={{ marginLeft: '0.4rem', color: 'var(--text-dim)', fontSize: '0.68rem' }}>
                ({format(new Date(last.at), 'yyyy-MM-dd HH:mm:ss')})
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <WriteControls
              dptMain={dptMain}
              dptKey={dpt}
              address={address}
              value={value}
              onValueChange={v => { setValue(v); setFeedback(null); }}
              onWrite={payload => void write(payload)}
              disabled={busy}
            />
            <button onClick={() => void read()} disabled={busy} style={secondaryBtn(busy)} title="Send a GroupValueRead">
              <Radio size={13} /> Read
            </button>
          </div>

          {feedback && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', color: feedback.ok ? 'var(--success)' : 'var(--error)' }}>
              {feedback.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {feedback.msg}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
