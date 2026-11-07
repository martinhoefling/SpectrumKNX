import { useEffect, useState, useMemo } from 'react';
import { Send } from 'lucide-react';

import { coerceValue } from '../utils/knxSend';
import { discreteDptValues, type BusPayload } from '../utils/dptValues';
import { boolBtn, primaryBtn } from '../utils/buttonStyles';

interface Props {
  /** DPT main number of the target GA, when known. DPT 1 without a subtype renders On/Off. */
  dptMain?: number | null;
  /** Full DPT key (e.g., "1.008"). A ≤4-bit subtype renders its own value names. */
  dptKey?: string | null;
  /** Target group address for scoping recent values. */
  address?: string | null;
  value: string;
  onValueChange: (value: string) => void;
  /** Fires with the payload to write: a boolean or named value for ≤4-bit DPTs, the coerced free value otherwise. */
  onWrite: (payload: BusPayload) => void;
  /** Disables all controls (busy, invalid address, active scheduled job). */
  disabled?: boolean;
}

const getRecentValues = (address?: string | null, dptKey?: string | null, dptMain?: number | null): string[] => {
  const list: string[] = [];
  const addFromKey = (storeKey: string) => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          list.push(...parsed);
        }
      }
    } catch {
      // ignore
    }
  };

  if (address) {
    addFromKey(`recent_val_ga_${address}`);
  }
  if (dptKey) {
    addFromKey(`recent_val_dpt_${dptKey}`);
  } else if (dptMain != null) {
    addFromKey(`recent_val_dpt_${dptMain}`);
  }
  return [...new Set(list)].slice(0, 10);
};

const saveRecentValue = (val: string, address?: string | null, dptKey?: string | null, dptMain?: number | null) => {
  if (!val || val.trim() === '') return;
  const trimmed = val.trim();
  const saveToKey = (storeKey: string) => {
    try {
      const raw = localStorage.getItem(storeKey);
      const cur: string[] = raw ? JSON.parse(raw) : [];
      const updated = [trimmed, ...cur.filter(v => v !== trimmed)].slice(0, 10);
      localStorage.setItem(storeKey, JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  if (address) {
    saveToKey(`recent_val_ga_${address}`);
  }
  if (dptKey) {
    saveToKey(`recent_val_dpt_${dptKey}`);
  } else if (dptMain != null) {
    saveToKey(`recent_val_dpt_${dptMain}`);
  }
};

/**
 * DPT-aware write controls, shared by every place that writes to the bus
 * (send bar, Last Seen Values) so the same GA renders identically everywhere
 * (#213): named value buttons for DPTs of at most 4 bits, time/date pickers
 * for DPT 10/11/19, and a recent values dropdown otherwise.
 */
export function WriteControls({ dptMain, dptKey, address, value, onValueChange, onWrite, disabled = false }: Props) {
  const [focused, setFocused] = useState(false);
  const [picked, setPicked] = useState(0);
  const recents = useMemo(() => getRecentValues(address, dptKey, dptMain), [address, dptKey, dptMain]);
  const choices = useMemo(() => discreteDptValues(dptKey), [dptKey]);

  useEffect(() => { setPicked(0); }, [dptKey]);

  if (choices && choices.length > 4) {
    const index = picked < choices.length ? picked : 0;
    return (
      <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
        <select
          aria-label="Value"
          className="glass-input"
          value={index}
          onChange={e => setPicked(Number(e.target.value))}
          disabled={disabled}
          style={{ width: 170 }}
        >
          {choices.map((choice, i) => (
            <option key={choice.label} value={i}>{choice.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onWrite(choices[index].payload)}
          disabled={disabled}
          style={primaryBtn(disabled)}
        >
          <Send size={14} /> Write
        </button>
      </div>
    );
  }

  if (choices && choices.length > 0) {
    return (
      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
        {choices.map(choice => (
          <button
            key={choice.label}
            type="button"
            disabled={disabled}
            onClick={() => onWrite(choice.payload)}
            style={boolBtn(disabled)}
            title={`Write ${choice.label}`}
          >
            <Send size={13} /> {choice.label}
          </button>
        ))}
      </div>
    );
  }

  if (dptMain === 1) {
    return (
      <div style={{ display: 'flex', gap: '0.3rem' }}>
        <button type="button" disabled={disabled} onClick={() => onWrite(true)} style={boolBtn(disabled)} title="Write On">
          <Send size={13} /> On
        </button>
        <button type="button" disabled={disabled} onClick={() => onWrite(false)} style={boolBtn(disabled)} title="Write Off">
          <Send size={13} /> Off
        </button>
      </div>
    );
  }

  if (dptMain === 10) {
    return (
      <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
        <input
          type="time"
          step="1"
          className="glass-input"
          value={value}
          onChange={e => onValueChange(e.target.value)}
          disabled={disabled}
          style={{ width: 170 }}
        />
        <button
          onClick={() => {
            saveRecentValue(value, address, dptKey, dptMain);
            onWrite(value);
          }}
          disabled={disabled || value === ''}
          style={primaryBtn(disabled || value === '')}
        >
          <Send size={14} /> Write
        </button>
      </div>
    );
  }

  if (dptMain === 11) {
    return (
      <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
        <input
          type="date"
          className="glass-input"
          value={value}
          onChange={e => onValueChange(e.target.value)}
          disabled={disabled}
          style={{ width: 170 }}
        />
        <button
          onClick={() => {
            saveRecentValue(value, address, dptKey, dptMain);
            onWrite(value);
          }}
          disabled={disabled || value === ''}
          style={primaryBtn(disabled || value === '')}
        >
          <Send size={14} /> Write
        </button>
      </div>
    );
  }

  if (dptMain === 19) {
    return (
      <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
        <input
          type="datetime-local"
          step="1"
          className="glass-input"
          value={value}
          onChange={e => onValueChange(e.target.value)}
          disabled={disabled}
          style={{ width: 170 }}
        />
        <button
          onClick={() => {
            saveRecentValue(value, address, dptKey, dptMain);
            onWrite(value);
          }}
          disabled={disabled || value === ''}
          style={primaryBtn(disabled || value === '')}
        >
          <Send size={14} /> Write
        </button>
      </div>
    );
  }

  // DPT 16 (14-byte string) and 28 (UTF-8 string) treat an empty string as a
  // valid payload (e.g. clearing a text display) — only block the send for
  // DPTs where an empty value isn't meaningful, e.g. because it can't be
  // coerced to a number (#410).
  const isTextDpt = dptMain === 16 || dptMain === 28;
  const writeDisabled = disabled || (!isTextDpt && value.trim() === '');
  return (
    <div style={{ position: 'relative', display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}>
      <div style={{ position: 'relative' }}>
        <input
          className="glass-input"
          placeholder="Value (e.g. 50, 21.5, on)"
          value={value}
          onChange={e => onValueChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !writeDisabled) {
              saveRecentValue(value, address, dptKey, dptMain);
              onWrite(coerceValue(value));
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={disabled}
          style={{ width: 170 }}
        />
        {focused && recents.length > 0 && (
          <div
            className="glass"
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              width: '100%',
              maxHeight: '150px',
              overflowY: 'auto',
              zIndex: 100,
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              boxShadow: 'var(--shadow-lg)',
              marginTop: '0.25rem',
              background: 'var(--bg-panel)'
            }}
          >
            {recents.map(val => (
              <div
                key={val}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onValueChange(val);
                  setFocused(false);
                }}
                style={{
                  padding: '0.4rem 0.6rem',
                  fontSize: '0.78rem',
                  color: 'var(--text-main)',
                  cursor: 'pointer',
                  transition: 'background 0.1s'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {val}
              </div>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={() => {
          saveRecentValue(value, address, dptKey, dptMain);
          onWrite(coerceValue(value));
        }}
        disabled={writeDisabled}
        style={primaryBtn(writeDisabled)}
      >
        <Send size={14} /> Write
      </button>
    </div>
  );
}
