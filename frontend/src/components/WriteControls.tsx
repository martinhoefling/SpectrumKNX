import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Send } from 'lucide-react';

import {
  isTextDptMain,
  payloadFromValue,
  textDptCharWidth,
  textDptWritePayload,
} from '../utils/knxSend';
import {
  discreteDptValues,
  formatDiscreteChoiceLabel,
  nextDiscreteLabelMode,
  type BusPayload,
  type DiscreteChoice,
  type DiscreteLabelMode,
} from '../utils/dptValues';
import { boolBtn, primaryBtn } from '../utils/buttonStyles';
import { focusVisible, useRetainFocusThroughDisabled } from '../hooks/useRetainFocusThroughDisabled';
import { ThemedDatetimePicker } from './ThemedDatetimePicker';

/** Leftmost write/send button in the send column (DOM order; skip Read / sendEnd). */
function firstWriteButton(col: HTMLElement | null | undefined): HTMLButtonElement | null {
  if (!col) return null;
  const marked = [...col.querySelectorAll<HTMLButtonElement>('button.wtb-write-btn:not(:disabled)')];
  if (marked.length > 0) return marked[0];
  const buttons = [...col.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    .filter(b => !/^\s*read\s*$/i.test((b.textContent || '').replace(/\s+/g, ' ').trim()));
  if (buttons.length === 0) return null;
  return buttons.find(b => /write/i.test(b.getAttribute('title') || '') || /write/i.test(b.textContent || ''))
    || buttons[0];
}

interface Props {
  /** DPT main number of the target GA, when known. */
  dptMain?: number | null;
  /** Full DPT key (e.g., "1.008"). A ≤4-bit subtype renders its own value names. */
  dptKey?: string | null;
  /** Target group address for scoping recent values. */
  address?: string | null;
  value: string;
  onValueChange: (value: string) => void;
  /** Fires with the payload to write: a boolean or named value for ≤4-bit DPTs, the coerced free value otherwise. */
  onWrite: (payload: BusPayload) => void;
  /** A free-value entry that cannot be sent (bad `0x`/`0b`, or outside a bare main's range). */
  onError?: (message: string) => void;
  /** Disables all controls (busy, invalid address, active scheduled job). */
  disabled?: boolean;
  /** Unit for the free-value field (e.g. °C), shown once a value is entered. */
  unit?: string | null;
  /** Extra props for the value-column wrapper (e.g. grid `data-wtb-col`). */
  valueColProps?: HTMLAttributes<HTMLDivElement> & { 'data-wtb-col'?: string };
  /** Extra props for the send-column wrapper (e.g. grid `data-wtb-col`). */
  sendColProps?: HTMLAttributes<HTMLDivElement> & { 'data-wtb-col'?: string };
  /**
   * Keep an empty value cell when this DPT uses send buttons only, so sibling
   * rows in a shared grid stay aligned. False omits that cell (and its track).
   */
  reserveValueSlot?: boolean;
  /**
   * `fill` (default): buttons share leftover column width via 1fr (send panel).
   * `hug`: content-sized buttons in a wrapping flex row (send popover).
   */
  sendFit?: 'fill' | 'hug';
  /** Appended after the send buttons (e.g. popover Read). */
  sendEnd?: ReactNode;
  /**
   * Bump to programmatically focus: value input (recents may open) when
   * available, otherwise the first enabled write/send button.
   */
  focusToken?: number | null;
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

/** Filter recents by the current input; exact/prefix before infix, MRU within a rank. */
function filterRecentValues(recents: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return recents;
  const rank = (v: string) => {
    const s = v.toLowerCase();
    if (s === q) return 0;
    if (s.startsWith(q)) return 1;
    return 2;
  };
  return recents
    .filter(v => v.toLowerCase().includes(q))
    .sort((a, b) => rank(a) - rank(b));
}

/** True when the key names a subtype ("1.001"), not a bare main ("1"). */
function dptHasSubtype(dptKey?: string | null): boolean {
  return Boolean(dptKey && /^\d+\.\d+$/.test(dptKey.trim()));
}

/**
 * True when this DPT renders a value field or choice list.
 * Button-only DPTs (on/off, short named lists) do not.
 * A bare main or empty key still uses the free value field.
 */
export function needsValueColumn(dptKey?: string | null, dptMain?: number | null): boolean {
  const choices = discreteDptValues(dptKey);
  const subtype = dptHasSubtype(dptKey);
  if (subtype && choices && choices.length > 4) return true;
  if (subtype && choices && choices.length > 0) return false;
  if (subtype && dptMain === 1) return false;
  return true;
}

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
const sendCellFill = (count: number): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: `repeat(${Math.max(count, 1)}, minmax(max-content, 1fr))`,
  gap: '0.3rem',
  alignItems: 'center',
  width: '100%',
});

/** Content-sized send buttons that wrap when the host is narrower than the row. */
const sendCellHug: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.3rem',
  alignItems: 'center',
  width: 'max-content',
};

const sendCell = (fit: 'fill' | 'hug', count: number): CSSProperties => (
  fit === 'hug' ? sendCellHug : sendCellFill(count)
);

const fillBtn = (base: CSSProperties): CSSProperties => ({
  ...base,
  width: '100%',
  justifyContent: 'center',
  boxSizing: 'border-box',
});

const sendBtn = (fit: 'fill' | 'hug', base: CSSProperties): CSSProperties => (
  fit === 'hug' ? base : fillBtn(base)
);

/** Above the send popover (z-index 1000) so a portaled value list stays visible. */
const PORTAL_MENU_Z = 1100;

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

/** glass-input shell fills the value track; unit then optional trailing (e.g. chevron). */
function ValueFieldShell({
  unit,
  showUnit,
  trailing,
  children,
  style,
  onMouseDown,
  shellRef,
}: {
  unit?: string | null;
  showUnit: boolean;
  trailing?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  onMouseDown?: (e: MouseEvent) => void;
  shellRef?: Ref<HTMLDivElement>;
}) {
  const unitVisible = Boolean(showUnit && unit);
  return (
    <div
      ref={shellRef}
      data-value-field
      className="glass-input"
      onMouseDown={onMouseDown}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
        padding: trailing ? '0.2rem 0.3rem 0.2rem 0.35rem' : '0.2rem 0.35rem',
        gap: unitVisible || trailing ? '0.3rem' : undefined,
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
      {trailing}
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
  dptMain, dptKey, address, value, onValueChange, onWrite, onError, disabled = false, unit = null,
  valueColProps, sendColProps, reserveValueSlot = true, sendFit = 'fill', sendEnd,
  focusToken = null,
}: Props) {
  const [recentsOpen, setRecentsOpen] = useState(false);
  const [recentsHighlight, setRecentsHighlight] = useState(0);
  const [recentsTick, setRecentsTick] = useState(0);
  const [recentsBox, setRecentsBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const valueInputRef = useRef<HTMLInputElement>(null);
  const valueShellRef = useRef<HTMLDivElement>(null);
  const sendColRef = useRef<HTMLDivElement>(null);
  const recentsOptionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const { retainFocusOn, retainClickFocus, setBeforeRestore } = useRetainFocusThroughDisabled(disabled);
  const recentsKeyboardNav = useRef(false);
  const skipRecentsFocusOpen = useRef(false);
  const appliedFocusToken = useRef<number | null>(null);
  // The select index belongs to one DPT. A different key reads as the first entry,
  // so changing the DPT does not need an effect to clear a stale pick.
  const [picked, setPicked] = useState({ key: dptKey, index: 0 });
  /** Decoded / 0x / 0b labels for ≤4-bit named send buttons (Ctrl-click cycles; survives DPT changes). */
  const [labelMode, setLabelMode] = useState<DiscreteLabelMode>('name');
  const cycleLabelMode = (e: MouseEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return false;
    e.preventDefault();
    e.stopPropagation();
    setLabelMode(prev => nextDiscreteLabelMode(prev));
    return true;
  };
  const discreteButtonLabel = (choice: DiscreteChoice) => (
    formatDiscreteChoiceLabel(choice, dptKey, labelMode)
  );
  const recents = useMemo(
    () => getRecentValues(address, dptKey, dptMain),
    [address, dptKey, dptMain, recentsTick],
  );
  const filteredRecents = useMemo(() => filterRecentValues(recents, value), [recents, value]);
  const choices = useMemo(() => discreteDptValues(dptKey), [dptKey]);
  // -1 = no highlight (cleared by typing); otherwise clamp into the filtered list.
  const recentsActive = recentsHighlight < 0 || filteredRecents.length === 0
    ? -1
    : Math.min(recentsHighlight, filteredRecents.length - 1);

  // Recent values are portaled so the send panel's overflow:hidden cannot clip them.
  // Re-place after open (rAF ×2 + ResizeObserver) so popover layout settles below the value.
  useLayoutEffect(() => {
    if (!recentsOpen) return;
    const place = () => {
      const el = valueShellRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.max(r.width, 120);
      let left = r.left;
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
      setRecentsBox({ top: r.bottom + 4, left, width });
    };
    place();
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      place();
      raf2 = requestAnimationFrame(place);
    });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    if (valueShellRef.current) ro?.observe(valueShellRef.current);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      ro?.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [recentsOpen, filteredRecents.length]);

  useEffect(() => {
    if (!recentsOpen || recentsActive < 0) return;
    recentsOptionRefs.current[recentsActive]?.scrollIntoView?.({ block: 'nearest' });
  }, [recentsOpen, recentsActive]);

  useLayoutEffect(() => {
    if (focusToken == null || appliedFocusToken.current === focusToken) return;
    appliedFocusToken.current = focusToken;
    // Allow recents to open on this programmatic focus (panel insert / popover open).
    skipRecentsFocusOpen.current = false;

    const applyFocus = () => {
      // Only prefer the free-value input when this DPT actually shows one —
      // button-only DPTs must land on the leftmost write button.
      const input = valueInputRef.current;
      if (needsValueColumn(dptKey, dptMain) && input && !input.disabled) {
        focusVisible(input);
        return true;
      }
      const btn = firstWriteButton(sendColRef.current);
      if (btn) {
        focusVisible(btn);
        return true;
      }
      return false;
    };

    if (applyFocus()) return;
    // Refs / button branch may not be committed yet (popover open) — retry once.
    const raf = requestAnimationFrame(() => { applyFocus(); });
    return () => cancelAnimationFrame(raf);
  }, [focusToken, dptKey, dptMain]);

  // Value Enter must not reopen the recents list when we re-focus after write.
  useLayoutEffect(() => {
    setBeforeRestore(el => {
      if (el === valueInputRef.current) skipRecentsFocusOpen.current = true;
    });
    return () => setBeforeRestore(null);
  }, [setBeforeRestore]);

  const retainWriteButtonFocus = (e: MouseEvent<HTMLButtonElement>) => {
    retainClickFocus(e);
  };

  /** Capture Write/Read clicks in sendEnd so busy→disabled can restore focus. */
  const onSendColClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
      'button.wtb-write-btn, button.wtb-read-btn',
    );
    if (!btn || !sendColRef.current?.contains(btn)) return;
    retainClickFocus({ currentTarget: btn });
  };

  const sendCol = (columns: number): HTMLAttributes<HTMLDivElement> & { ref: typeof sendColRef } => ({
    ...sendColProps,
    ref: sendColRef,
    onClickCapture: e => {
      onSendColClickCapture(e);
      sendColProps?.onClickCapture?.(e);
    },
    style: { ...sendCell(sendFit, columns), ...sendColProps?.style },
  });

  const rememberValue = (val: string = value) => {
    if (!val.trim()) return;
    saveRecentValue(val, address, dptKey, dptMain);
    setRecentsTick(t => t + 1);
  };

  // Named buttons, lists, and time/date pickers belong to a full key.
  // A bare main ("1", "10") always gets the free value field and one Write.
  const subtype = dptHasSubtype(dptKey);
  // Button rows keep an empty cell only while some sibling still needs the column.
  const keepValueSlot = needsValueColumn(dptKey, dptMain) || reserveValueSlot;
  const valueSlot = keepValueSlot
    ? <div {...valueColProps} style={{ ...valueCell, ...valueColProps?.style }} />
    : null;

  if (subtype && choices && choices.length > 4) {
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
        <div {...sendCol(1)}>
          <button
            type="button"
            className="wtb-write-btn"
            onClick={e => { onWrite(choices[index].payload); retainWriteButtonFocus(e); }}
            disabled={disabled}
            style={sendBtn(sendFit, primaryBtn(disabled))}
          >
            <Send size={14} /> Write
          </button>
          {sendEnd}
        </div>
      </>
    );
  }

  if (subtype && choices && choices.length > 0) {
    return (
      <>
        {valueSlot}
        <div {...sendCol(choices.length)}>
          {choices.map(choice => {
            const shown = discreteButtonLabel(choice);
            return (
              <button
                key={choice.label}
                type="button"
                className="wtb-write-btn"
                disabled={disabled}
                onClick={e => {
                  if (cycleLabelMode(e)) return;
                  onWrite(choice.payload);
                  retainWriteButtonFocus(e);
                }}
                style={sendBtn(sendFit, boolBtn(disabled))}
                title={`Write ${choice.label}${labelMode === 'name' ? '' : ` (${shown})`} · ctrl/cmd-click to cycle name / hex / bin`}
              >
                <Send size={13} /> {shown}
              </button>
            );
          })}
          {sendEnd}
        </div>
      </>
    );
  }

  if (subtype && dptMain === 1) {
    const onChoice: DiscreteChoice = { label: 'on', payload: true };
    const offChoice: DiscreteChoice = { label: 'off', payload: false };
    const onShown = discreteButtonLabel(onChoice);
    const offShown = discreteButtonLabel(offChoice);
    return (
      <>
        {valueSlot}
        <div {...sendCol(2)}>
          <button
            type="button"
            className="wtb-write-btn"
            disabled={disabled}
            onClick={e => {
              if (cycleLabelMode(e)) return;
              onWrite(true);
              retainWriteButtonFocus(e);
            }}
            style={sendBtn(sendFit, boolBtn(disabled))}
            title={`Write on${labelMode === 'name' ? '' : ` (${onShown})`} · ctrl/cmd-click to cycle name / hex / bin`}
          >
            <Send size={13} /> {onShown}
          </button>
          <button
            type="button"
            className="wtb-write-btn"
            disabled={disabled}
            onClick={e => {
              if (cycleLabelMode(e)) return;
              onWrite(false);
              retainWriteButtonFocus(e);
            }}
            style={sendBtn(sendFit, boolBtn(disabled))}
            title={`Write off${labelMode === 'name' ? '' : ` (${offShown})`} · ctrl/cmd-click to cycle name / hex / bin`}
          >
            <Send size={13} /> {offShown}
          </button>
          {sendEnd}
        </div>
      </>
    );
  }

  if (subtype && dptMain === 10) {
    return (
      <>
        <div {...valueColProps} style={{ ...valueCell, ...valueColProps?.style }}>
          <ValueFieldShell unit={unit} showUnit={Boolean(value.trim())}>
            <ThemedDatetimePicker
              variant="bare"
              mode="time"
              withSeconds
              inputRef={valueInputRef}
              aria-label="Value"
              value={value}
              onChange={onValueChange}
              onBlur={() => rememberValue()}
              disabled={disabled}
              style={{ ...bareInput, flex: '1 1 auto', width: 'auto', textAlign: 'left' }}
            />
          </ValueFieldShell>
        </div>
        <div {...sendCol(1)}>
          <button
            type="button"
            className="wtb-write-btn"
            onClick={e => {
              rememberValue();
              onWrite(value);
              retainWriteButtonFocus(e);
            }}
            disabled={disabled || value === ''}
            style={sendBtn(sendFit, primaryBtn(disabled || value === ''))}
          >
            <Send size={14} /> Write
          </button>
          {sendEnd}
        </div>
      </>
    );
  }

  if (subtype && dptMain === 11) {
    return (
      <>
        <div {...valueColProps} style={{ ...valueCell, ...valueColProps?.style }}>
          <ValueFieldShell unit={unit} showUnit={Boolean(value.trim())}>
            <ThemedDatetimePicker
              variant="bare"
              mode="date"
              inputRef={valueInputRef}
              aria-label="Value"
              value={value}
              onChange={onValueChange}
              onBlur={() => rememberValue()}
              disabled={disabled}
              style={{ ...bareInput, flex: '1 1 auto', width: 'auto', textAlign: 'left' }}
            />
          </ValueFieldShell>
        </div>
        <div {...sendCol(1)}>
          <button
            type="button"
            className="wtb-write-btn"
            onClick={e => {
              rememberValue();
              onWrite(value);
              retainWriteButtonFocus(e);
            }}
            disabled={disabled || value === ''}
            style={sendBtn(sendFit, primaryBtn(disabled || value === ''))}
          >
            <Send size={14} /> Write
          </button>
          {sendEnd}
        </div>
      </>
    );
  }

  if (subtype && dptMain === 19) {
    return (
      <>
        <div {...valueColProps} style={{ ...valueCell, ...valueColProps?.style }}>
          <ValueFieldShell unit={unit} showUnit={Boolean(value.trim())}>
            <ThemedDatetimePicker
              variant="bare"
              mode="datetime"
              withSeconds
              inputRef={valueInputRef}
              aria-label="Value"
              value={value}
              onChange={onValueChange}
              onBlur={() => rememberValue()}
              disabled={disabled}
              style={{ ...bareInput, flex: '1 1 auto', width: 'auto', textAlign: 'left' }}
            />
          </ValueFieldShell>
        </div>
        <div {...sendCol(1)}>
          <button
            type="button"
            className="wtb-write-btn"
            onClick={e => {
              rememberValue();
              onWrite(value);
              retainWriteButtonFocus(e);
            }}
            disabled={disabled || value === ''}
            style={sendBtn(sendFit, primaryBtn(disabled || value === ''))}
          >
            <Send size={14} /> Write
          </button>
          {sendEnd}
        </div>
      </>
    );
  }

  const isTextDpt = isTextDptMain(dptMain);
  const textWidth = textDptCharWidth(dptMain);
  const textDptKey = dptKey?.trim() || (dptMain != null ? String(dptMain) : '');

  const commitFreeValue = () => {
    let payload: BusPayload;
    try {
      payload = isTextDpt
        ? textDptWritePayload(value, textDptKey)
        : payloadFromValue(value, dptKey);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Invalid value');
      return;
    }
    rememberValue(typeof payload === 'string' ? payload : value);
    onWrite(payload);
  };

  // Text DPTs (4/16/28) may send an empty field as space-padded / UTF-8 text
  // (#410). Other DPTs still require a non-empty value.
  const writeDisabled = disabled || (!isTextDpt && value.trim() === '');
  // Short placeholder keeps the measured value track content-sized (like delay/every).
  const valuePlaceholder = 'Value';
  const inputCh = isTextDpt && textWidth != null
    ? textWidth
    : valueInputCh(value, valuePlaceholder);
  const hasRecents = recents.length > 0;
  const valueEmpty = !value.trim();

  const openRecents = () => {
    if (!hasRecents) return;
    setRecentsHighlight(0);
    recentsKeyboardNav.current = false;
    setRecentsOpen(true);
  };

  const pickRecent = (val: string) => {
    onValueChange(val);
    setRecentsOpen(false);
  };

  const onValueKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (recentsOpen) { e.preventDefault(); setRecentsOpen(false); }
      return;
    }
    if (hasRecents && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      recentsKeyboardNav.current = true;
      if (!recentsOpen) { openRecents(); return; }
      if (filteredRecents.length === 0) return;
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      setRecentsHighlight(h => {
        if (h < 0) return dir > 0 ? 0 : filteredRecents.length - 1;
        return Math.max(0, Math.min(filteredRecents.length - 1, h + dir));
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (recentsOpen && recentsActive >= 0 && filteredRecents[recentsActive] != null) {
        pickRecent(filteredRecents[recentsActive]);
        return;
      }
      if (recentsOpen) setRecentsOpen(false);
      if (!writeDisabled) {
        commitFreeValue();
        // Keep focus on the value field after Enter-to-write without reopening recents.
        retainFocusOn(valueInputRef.current);
      }
    }
  };

  return (
    <>
      <div {...valueColProps} style={{ ...valueCell, ...valueColProps?.style }}>
        <ValueFieldShell
          shellRef={valueShellRef}
          unit={unit}
          showUnit={Boolean(value.trim())}
          onMouseDown={e => {
            if (disabled || !hasRecents) return;
            const target = e.target as HTMLElement;
            if (target.closest('[data-value-chevron]')) return;
            if (e.target !== valueInputRef.current) e.preventDefault();
            if (recentsOpen) {
              skipRecentsFocusOpen.current = true;
              setRecentsOpen(false);
            } else {
              openRecents();
            }
            valueInputRef.current?.focus();
          }}
          trailing={hasRecents ? (
            <button
              type="button"
              className="icon-button"
              data-value-chevron
              aria-label="Toggle recent values"
              disabled={disabled}
              tabIndex={disabled ? -1 : 0}
              onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
              onClick={() => {
                if (disabled) return;
                if (recentsOpen) {
                  skipRecentsFocusOpen.current = true;
                  setRecentsOpen(false);
                  valueInputRef.current?.blur();
                } else {
                  openRecents();
                  valueInputRef.current?.focus();
                }
              }}
              style={{
                color: 'var(--text-dim)',
                padding: '0.05rem',
                flexShrink: 0,
                marginLeft: 'auto',
                pointerEvents: disabled ? 'none' : undefined,
              }}
            >
              <ChevronDown size={13} />
            </button>
          ) : undefined}
        >
          <input
            ref={valueInputRef}
            aria-label="Value"
            aria-expanded={hasRecents ? recentsOpen : undefined}
            aria-haspopup={hasRecents ? 'listbox' : undefined}
            placeholder={valuePlaceholder}
            value={value}
            maxLength={textWidth ?? undefined}
            onChange={e => {
              recentsKeyboardNav.current = false;
              setRecentsHighlight(-1);
              onValueChange(e.target.value);
              if (hasRecents) setRecentsOpen(true);
            }}
            onKeyDown={onValueKeyDown}
            onFocus={() => {
              if (skipRecentsFocusOpen.current) {
                skipRecentsFocusOpen.current = false;
                return;
              }
              if (hasRecents) openRecents();
            }}
            onBlur={() => {
              setRecentsOpen(false);
              rememberValue();
            }}
            disabled={disabled}
            style={{
              ...bareInput,
              flex: '1 1 auto',
              width: `${inputCh}ch`,
              minWidth: `${inputCh}ch`,
              // Empty placeholder and text DPTs stay left; filled numerics sit against the unit.
              textAlign: valueEmpty || isTextDpt ? 'left' : 'right',
              ...(isTextDpt ? {
                fontFamily: "'JetBrains Mono', monospace",
                whiteSpace: 'pre',
              } : null),
            }}
          />
        </ValueFieldShell>
        {recentsOpen && filteredRecents.length > 0 && recentsBox && createPortal(
          <div
            data-portaled-menu
            role="listbox"
            aria-label="Recent values"
            className="glass"
            style={{
              position: 'fixed',
              top: recentsBox.top,
              left: recentsBox.left,
              width: recentsBox.width,
              maxHeight: '150px',
              overflowY: 'auto',
              zIndex: PORTAL_MENU_Z,
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              boxShadow: 'var(--shadow-lg)',
              background: 'var(--bg-panel)',
              padding: '0.25rem',
            }}
          >
            {filteredRecents.map((val, i) => (
              <div
                key={val}
                ref={el => { recentsOptionRefs.current[i] = el; }}
                role="option"
                aria-selected={i === recentsActive}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickRecent(val);
                }}
                onMouseEnter={() => {
                  recentsKeyboardNav.current = false;
                  setRecentsHighlight(i);
                }}
                style={{
                  padding: '0.4rem 0.6rem',
                  fontSize: '0.78rem',
                  color: 'var(--text-main)',
                  cursor: 'pointer',
                  borderRadius: 6,
                  background: i === recentsActive ? 'rgba(99,102,241,0.18)' : 'transparent',
                }}
              >
                {val}
              </div>
            ))}
          </div>,
          document.body,
        )}
      </div>
      <div {...sendCol(1)}>
        <button
          type="button"
          className="wtb-write-btn"
          onClick={e => { commitFreeValue(); retainWriteButtonFocus(e); }}
          disabled={writeDisabled}
          style={sendBtn(sendFit, primaryBtn(writeDisabled))}
        >
          <Send size={14} /> Write
        </button>
        {sendEnd}
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

  const onKeyDown = (e: KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Escape') {
      if (open) { e.preventDefault(); setOpen(false); }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setHighlight(index);
        setOpen(true);
        return;
      }
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      setHighlight(h => {
        const current = Math.min(h, Math.max(choices.length - 1, 0));
        return Math.max(0, Math.min(choices.length - 1, current + dir));
      });
      return;
    }
    if (e.key === 'Enter' && open) {
      e.preventDefault();
      pick(active);
    }
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
        onKeyDown={onKeyDown}
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
          cursor: disabled ? 'default' : 'pointer',
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
          data-portaled-menu
          role="listbox"
          aria-label="Value"
          style={{
            position: 'fixed', top: box.top, left: box.left, width: box.width, zIndex: PORTAL_MENU_Z,
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
