import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Send } from 'lucide-react';

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
  /** Unit for the free-value field (e.g. °C), shown once a value is entered. */
  unit?: string | null;
  /** Extra props for the value-column wrapper (e.g. grid `data-wtb-col`). */
  valueColProps?: HTMLAttributes<HTMLDivElement> & { 'data-wtb-col'?: string };
  /** Extra props for the send-column wrapper (e.g. grid `data-wtb-col`). */
  sendColProps?: HTMLAttributes<HTMLDivElement> & { 'data-wtb-col'?: string };
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

const valueCell: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minWidth: 0,
  width: '100%',
};

/**
 * Send slot fills the shared column. Each button keeps its content width first;
 * leftover column space is shared via 1fr. Tracks are not forced equal — short
 * labels stay narrower than long ones when that is what fits the content.
 */
const sendCell = (count: number): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: `repeat(${Math.max(count, 1)}, minmax(max-content, 1fr))`,
  gap: '0.3rem',
  alignItems: 'center',
  width: '100%',
});

const fillBtn = (base: CSSProperties): CSSProperties => ({
  ...base,
  width: '100%',
  justifyContent: 'center',
  boxSizing: 'border-box',
});

const bareInput: CSSProperties = {
  border: 'none',
  outline: 'none',
  background: 'transparent',
  padding: 0,
  color: 'var(--text-main)',
  font: 'inherit',
  minWidth: 0,
};

/** Intrinsic text width so column measurement can size before the shell fills the track. */
function valueInputCh(value: string, placeholder: string): number {
  return Math.max(value.length, placeholder.length, 4) + 1;
}

/** glass-input shell fills the value track; unit sits as a flex sibling after the value. */
function ValueFieldShell({
  unit,
  showUnit,
  children,
  style,
}: {
  unit?: string | null;
  showUnit: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const unitVisible = Boolean(showUnit && unit);
  return (
    <div
      data-value-field
      className="glass-input"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
        padding: '0.2rem 0.35rem',
        gap: unitVisible ? '0.3rem' : undefined,
        ...style,
      }}
    >
      {children}
      {unitVisible && (
        <span
          style={{
            fontSize: '0.72rem',
            color: 'var(--text-dim)',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            pointerEvents: 'none',
          }}
        >
          {unit}
        </span>
      )}
    </div>
  );
}

/**
 * DPT-aware write controls, shared by every place that writes to the bus
 * (send bar, Last Seen Values) so the same GA renders identically everywhere
 * (#213): named value buttons for DPTs of at most 4 bits, time/date pickers
 * for DPT 10/11/19, and a recent values dropdown otherwise.
 *
 * Returns two siblings (value slot, send slot) so a parent CSS grid can place
 * them in separate columns.
 */
export function WriteControls({
  dptMain, dptKey, address, value, onValueChange, onWrite, disabled = false, unit = null,
  valueColProps, sendColProps,
}: Props) {
  const [focused, setFocused] = useState(false);
  // The select index belongs to one DPT. A different key reads as the first entry,
  // so changing the DPT does not need an effect to clear a stale pick.
  const [picked, setPicked] = useState({ key: dptKey, index: 0 });
  const recents = useMemo(() => getRecentValues(address, dptKey, dptMain), [address, dptKey, dptMain]);
  const choices = useMemo(() => discreteDptValues(dptKey), [dptKey]);

  if (choices && choices.length > 4) {
    const index = picked.key === dptKey && picked.index < choices.length ? picked.index : 0;
    return (
      <>
        <div {...valueColProps} style={{ ...valueCell, ...valueColProps?.style }}>
          <ValueChoiceSelect
            choices={choices.map(c => c.label)}
            index={index}
            disabled={disabled}
            onChange={i => setPicked({ key: dptKey, index: i })}
          />
        </div>
        <div {...sendColProps} style={{ ...sendCell(1), ...sendColProps?.style }}>
          <button
            type="button"
            onClick={() => onWrite(choices[index].payload)}
            disabled={disabled}
            style={fillBtn(primaryBtn(disabled))}
          >
            <Send size={14} /> Write
          </button>
        </div>
      </>
    );
  }

  if (choices && choices.length > 0) {
    return (
      <>
        <div {...valueColProps} style={{ ...valueCell, ...valueColProps?.style }} />
        <div {...sendColProps} style={{ ...sendCell(choices.length), ...sendColProps?.style }}>
          {choices.map(choice => (
            <button
              key={choice.label}
              type="button"
              disabled={disabled}
              onClick={() => onWrite(choice.payload)}
              style={fillBtn(boolBtn(disabled))}
              title={`Write ${choice.label}`}
            >
              <Send size={13} /> {choice.label}
            </button>
          ))}
        </div>
      </>
    );
  }

  if (dptMain === 1) {
    return (
      <>
        <div {...valueColProps} style={{ ...valueCell, ...valueColProps?.style }} />
        <div {...sendColProps} style={{ ...sendCell(2), ...sendColProps?.style }}>
          <button type="button" disabled={disabled} onClick={() => onWrite(true)} style={fillBtn(boolBtn(disabled))} title="Write on">
            <Send size={13} /> on
          </button>
          <button type="button" disabled={disabled} onClick={() => onWrite(false)} style={fillBtn(boolBtn(disabled))} title="Write off">
            <Send size={13} /> off
          </button>
        </div>
      </>
    );
  }

  if (dptMain === 10) {
    return (
      <>
        <div {...valueColProps} style={{ ...valueCell, ...valueColProps?.style }}>
          <ValueFieldShell unit={unit} showUnit={Boolean(value.trim())}>
            <input
              type="time"
              step="1"
              aria-label="Value"
              value={value}
              onChange={e => onValueChange(e.target.value)}
              disabled={disabled}
              style={{ ...bareInput, flex: '1 1 auto', width: 'auto', textAlign: 'left' }}
            />
          </ValueFieldShell>
        </div>
        <div {...sendColProps} style={{ ...sendCell(1), ...sendColProps?.style }}>
          <button
            onClick={() => {
              saveRecentValue(value, address, dptKey, dptMain);
              onWrite(value);
            }}
            disabled={disabled || value === ''}
            style={fillBtn(primaryBtn(disabled || value === ''))}
          >
            <Send size={14} /> Write
          </button>
        </div>
      </>
    );
  }

  if (dptMain === 11) {
    return (
      <>
        <div {...valueColProps} style={{ ...valueCell, ...valueColProps?.style }}>
          <ValueFieldShell unit={unit} showUnit={Boolean(value.trim())}>
            <input
              type="date"
              aria-label="Value"
              value={value}
              onChange={e => onValueChange(e.target.value)}
              disabled={disabled}
              style={{ ...bareInput, flex: '1 1 auto', width: 'auto', textAlign: 'left' }}
            />
          </ValueFieldShell>
        </div>
        <div {...sendColProps} style={{ ...sendCell(1), ...sendColProps?.style }}>
          <button
            onClick={() => {
              saveRecentValue(value, address, dptKey, dptMain);
              onWrite(value);
            }}
            disabled={disabled || value === ''}
            style={fillBtn(primaryBtn(disabled || value === ''))}
          >
            <Send size={14} /> Write
          </button>
        </div>
      </>
    );
  }

  if (dptMain === 19) {
    return (
      <>
        <div {...valueColProps} style={{ ...valueCell, ...valueColProps?.style }}>
          <ValueFieldShell unit={unit} showUnit={Boolean(value.trim())}>
            <input
              type="datetime-local"
              step="1"
              aria-label="Value"
              value={value}
              onChange={e => onValueChange(e.target.value)}
              disabled={disabled}
              style={{ ...bareInput, flex: '1 1 auto', width: 'auto', textAlign: 'left' }}
            />
          </ValueFieldShell>
        </div>
        <div {...sendColProps} style={{ ...sendCell(1), ...sendColProps?.style }}>
          <button
            onClick={() => {
              saveRecentValue(value, address, dptKey, dptMain);
              onWrite(value);
            }}
            disabled={disabled || value === ''}
            style={fillBtn(primaryBtn(disabled || value === ''))}
          >
            <Send size={14} /> Write
          </button>
        </div>
      </>
    );
  }

  // DPT 16 (14-byte string) and 28 (UTF-8 string) treat an empty string as a
  // valid payload (e.g. clearing a text display) — only block the send for
  // DPTs where an empty value isn't meaningful, e.g. because it can't be
  // coerced to a number (#410).
  const isTextDpt = dptMain === 16 || dptMain === 28;
  const writeDisabled = disabled || (!isTextDpt && value.trim() === '');
  // Short placeholder keeps the measured value track content-sized (like delay/every).
  const valuePlaceholder = 'Value';
  const inputCh = valueInputCh(value, valuePlaceholder);
  return (
    <>
      <div {...valueColProps} style={{ ...valueCell, ...valueColProps?.style }}>
        <ValueFieldShell unit={unit} showUnit={Boolean(value.trim())} style={{ position: 'relative' }}>
          <input
            aria-label="Value"
            placeholder={valuePlaceholder}
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
            style={{
              ...bareInput,
              flex: '1 1 auto',
              width: `${inputCh}ch`,
              minWidth: `${inputCh}ch`,
              // Numeric values sit against the unit at the right; text DPTs stay left.
              textAlign: isTextDpt ? 'left' : 'right',
            }}
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
                background: 'var(--bg-panel)',
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
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {val}
                </div>
              ))}
            </div>
          )}
        </ValueFieldShell>
      </div>
      <div {...sendColProps} style={{ ...sendCell(1), ...sendColProps?.style }}>
        <button
          onClick={() => {
            saveRecentValue(value, address, dptKey, dptMain);
            onWrite(coerceValue(value));
          }}
          disabled={writeDisabled}
          style={fillBtn(primaryBtn(writeDisabled))}
        >
          <Send size={14} /> Write
        </button>
      </div>
    </>
  );
}

/** Portaled value list matching the DPT suggestion menu look. */
function ValueChoiceSelect({
  choices,
  index,
  disabled,
  onChange,
}: {
  choices: string[];
  index: number;
  disabled: boolean;
  onChange: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(index);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = choices.length === 0 ? 0 : Math.min(highlight, choices.length - 1);
  const label = choices[index] ?? '';

  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 200);
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    setBox({ top: r.bottom + 4, left, width });
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, choices.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (i: number) => {
    onChange(i);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="glass-input"
        aria-label="Value"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setHighlight(index);
          setOpen(o => !o);
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          width: '100%',
          boxSizing: 'border-box',
          padding: '0.2rem 0.35rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.72rem',
          textAlign: 'left',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <ChevronDown size={13} style={{ flexShrink: 0, marginLeft: 'auto', color: 'var(--text-dim)' }} />
      </button>
      {open && !disabled && box && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label="Value"
          style={{
            position: 'fixed', top: box.top, left: box.left, width: box.width, zIndex: 80,
            maxHeight: 240, overflowY: 'auto',
            background: 'var(--bg-panel)', border: '1px solid var(--border-color)',
            borderRadius: 8, boxShadow: 'var(--shadow-lg)', padding: '0.25rem',
          }}
        >
          {choices.map((choice, i) => (
            <button
              type="button"
              key={choice}
              role="option"
              aria-selected={i === active}
              onMouseDown={e => { e.preventDefault(); pick(i); }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                display: 'block',
                width: '100%', textAlign: 'left', border: 'none', borderRadius: 6, cursor: 'pointer',
                padding: '0.3rem 0.45rem',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.75rem',
                color: 'var(--text-main)',
                background: i === active ? 'rgba(99,102,241,0.18)' : 'transparent',
              }}
            >
              {choice}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
