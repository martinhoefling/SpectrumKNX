import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type Ref,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Play } from 'lucide-react';

export type DatetimeMode = 'datetime' | 'date' | 'time';
/**
 * Popover action row:
 * - standard: Clear | Now | OK
 * - since: Since… | Clear  (TIME filter "von")
 * - before: Before… | Live | Clear  (TIME filter "bis")
 */
export type DatetimeActions = 'standard' | 'since' | 'before';

interface Props {
  value: string;
  onChange: (value: string) => void;
  mode?: DatetimeMode;
  /** Include seconds in datetime/time values (default true). */
  withSeconds?: boolean;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  'aria-label'?: string;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  onBlur?: () => void;
  autoFocus?: boolean;
  /** Open the popover when the field receives focus (default true). */
  openOnFocus?: boolean;
  onKeyDown?: (e: KeyboardEvent) => void;
  /** bare = no chrome (inside ValueFieldShell); field = glass-like standalone input. */
  variant?: 'bare' | 'field';
  /** Inclusive local calendar day bounds from telegram DB (YYYY-MM-DD). */
  minDate?: string;
  maxDate?: string;
  /** Inclusive local instants for field clamp (YYYY-MM-DDTHH:mm[:ss]). */
  minDateTime?: string;
  maxDateTime?: string;
  /** Which action chips to show under the time column (default standard). */
  actions?: DatetimeActions;
  /** Optional Live action (before variant) — e.g. resume list follow. */
  onLive?: () => void;
  /** Decorative field chevron (default true for variant=field). */
  showChevron?: boolean;
}

type Parts = { y: number; mo: number; d: number; h: number; mi: number; s: number };
type SegKey = 'year' | 'month' | 'day' | 'h' | 'mi' | 's';
type FieldSeg = { key: SegKey; start: number; end: number; maxLen: number };

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const CELL = 28;

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function dateKey(y: number, mo: number, d: number) {
  return `${String(y).padStart(4, '0')}-${pad(mo + 1)}-${pad(d)}`;
}

function parseDateKey(s: string | undefined): { y: number; mo: number; d: number } | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]) - 1, d: Number(m[3]) };
}

function parseParts(value: string, mode: DatetimeMode): Parts | null {
  const now = new Date();
  if (!value.trim()) {
    return {
      y: now.getFullYear(), mo: now.getMonth(), d: now.getDate(),
      h: now.getHours(), mi: now.getMinutes(), s: now.getSeconds(),
    };
  }
  if (mode === 'time') {
    const m = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    return {
      y: now.getFullYear(), mo: now.getMonth(), d: now.getDate(),
      h: Number(m[1]), mi: Number(m[2]), s: Number(m[3] ?? 0),
    };
  }
  if (mode === 'date') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return {
      y: Number(m[1]), mo: Number(m[2]) - 1, d: Number(m[3]),
      h: 0, mi: 0, s: 0,
    };
  }
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return {
    y: Number(m[1]), mo: Number(m[2]) - 1, d: Number(m[3]),
    h: Number(m[4]), mi: Number(m[5]), s: Number(m[6] ?? 0),
  };
}

function formatParts(p: Parts, mode: DatetimeMode, withSeconds: boolean): string {
  const date = dateKey(p.y, p.mo, p.d);
  const time = withSeconds
    ? `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`
    : `${pad(p.h)}:${pad(p.mi)}`;
  if (mode === 'date') return date;
  if (mode === 'time') return time;
  return `${date}T${time}`;
}

function daysInMonth(y: number, mo: number) {
  return new Date(y, mo + 1, 0).getDate();
}

function inRange(y: number, mo: number, d: number, minDate?: string, maxDate?: string) {
  const key = dateKey(y, mo, d);
  if (minDate && key < minDate) return false;
  if (maxDate && key > maxDate) return false;
  return true;
}

function clampDay(y: number, mo: number, d: number) {
  return Math.min(d, daysInMonth(y, mo));
}

function fieldSegKeys(mode: DatetimeMode, withSeconds: boolean): SegKey[] {
  if (mode === 'time') return withSeconds ? ['h', 'mi', 's'] : ['h', 'mi'];
  if (mode === 'date') return ['year', 'month', 'day'];
  return withSeconds
    ? ['year', 'month', 'day', 'h', 'mi', 's']
    : ['year', 'month', 'day', 'h', 'mi'];
}

function fieldSegments(text: string, mode: DatetimeMode, withSeconds: boolean): FieldSeg[] {
  const keys = fieldSegKeys(mode, withSeconds);
  const out: FieldSeg[] = [];
  if (mode === 'time') {
    out.push({ key: 'h', start: 0, end: 2, maxLen: 2 });
    out.push({ key: 'mi', start: 3, end: 5, maxLen: 2 });
    if (withSeconds) out.push({ key: 's', start: 6, end: 8, maxLen: 2 });
    return out.filter(s => keys.includes(s.key));
  }
  out.push({ key: 'year', start: 0, end: 4, maxLen: 4 });
  out.push({ key: 'month', start: 5, end: 7, maxLen: 2 });
  out.push({ key: 'day', start: 8, end: 10, maxLen: 2 });
  if (mode === 'datetime') {
    out.push({ key: 'h', start: 11, end: 13, maxLen: 2 });
    out.push({ key: 'mi', start: 14, end: 16, maxLen: 2 });
    if (withSeconds) out.push({ key: 's', start: 17, end: 19, maxLen: 2 });
  }
  return out.filter(s => keys.includes(s.key) && s.end <= text.length);
}

function segAtCaret(segs: FieldSeg[], caret: number): FieldSeg | null {
  if (!segs.length) return null;
  for (const s of segs) {
    if (caret >= s.start && caret <= s.end) return s;
  }
  for (const s of segs) {
    if (caret < s.start) return s;
  }
  return segs[segs.length - 1];
}

const popoverPanel: CSSProperties = {
  position: 'fixed',
  zIndex: 1100,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
  padding: '0.55rem 0.65rem',
  background: 'var(--bg-panel)',
  backdropFilter: 'var(--glass-blur)',
  WebkitBackdropFilter: 'var(--glass-blur)',
  border: '1px solid var(--border-color)',
  borderRadius: 10,
  boxShadow: 'var(--shadow-lg)',
  color: 'var(--text-main)',
  fontSize: '0.75rem',
  boxSizing: 'border-box',
  userSelect: 'none',
};

const iconBtn = (disabled = false): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: disabled ? 'var(--text-dim)' : 'var(--text-main)',
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.35 : 1,
});

const dayBtn = (selected: boolean, muted: boolean, disabled: boolean): CSSProperties => ({
  width: CELL,
  height: CELL,
  padding: 0,
  border: 'none',
  borderRadius: '50%',
  background: selected ? 'var(--accent-primary)' : 'transparent',
  color: selected
    ? 'white'
    : muted || disabled
      ? 'var(--text-dim)'
      : 'var(--text-main)',
  cursor: disabled ? 'default' : 'pointer',
  font: 'inherit',
  fontSize: '0.72rem',
  fontWeight: selected ? 600 : 400,
  opacity: disabled ? 0.35 : 1,
  // Disabled native buttons swallow hits in some browsers; let the dialog keep the event.
  pointerEvents: disabled ? 'none' : undefined,
});

/** Day-cell look for Now / Clear / OK. */
const chipBtn = (accent = false, disabled = false): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: CELL,
  height: CELL,
  padding: '0 0.4rem',
  border: 'none',
  borderRadius: CELL / 2,
  background: accent ? 'var(--accent-primary)' : 'transparent',
  color: accent ? 'white' : disabled ? 'var(--text-dim)' : 'var(--text-main)',
  cursor: disabled ? 'default' : 'pointer',
  font: 'inherit',
  fontSize: '0.65rem',
  fontWeight: accent ? 600 : 500,
  opacity: disabled ? 0.35 : 1,
  pointerEvents: disabled ? 'none' : undefined,
});

const iconBtnStyle = (disabled = false): CSSProperties => ({
  ...iconBtn(disabled),
  pointerEvents: disabled ? 'none' : undefined,
});

function partsInBounds(p: Parts, minDate?: string, maxDate?: string) {
  return inRange(p.y, p.mo, p.d, minDate, maxDate);
}

/** Comparable local instant string for clamping (date / datetime / time). */
function partsCompareKey(p: Parts, mode: DatetimeMode, withSeconds: boolean): string {
  return formatParts(p, mode === 'time' ? 'datetime' : mode, withSeconds);
}

/**
 * Clamp to telegram DB span: before oldest → oldest; after newest → newest.
 * Field entry itself is unrestricted; callers apply this on blur/OK.
 */
function clampPartsToDb(
  p: Parts,
  mode: DatetimeMode,
  withSeconds: boolean,
  minDateTime?: string,
  maxDateTime?: string,
  minDate?: string,
  maxDate?: string,
): Parts {
  if (mode === 'time') return p;
  const minBound = minDateTime ?? minDate;
  const maxBound = maxDateTime ?? maxDate;
  if (!minBound && !maxBound) return p;

  if (mode === 'date') {
    const key = dateKey(p.y, p.mo, p.d);
    if (minBound) {
      const minDay = minBound.slice(0, 10);
      if (key < minDay) return parseParts(minDay, 'date') ?? p;
    }
    if (maxBound) {
      const maxDay = maxBound.slice(0, 10);
      if (key > maxDay) return parseParts(maxDay, 'date') ?? p;
    }
    return p;
  }

  const cur = partsCompareKey(p, 'datetime', withSeconds);
  const toInstant = (bound: string, which: 'min' | 'max') => {
    if (bound.includes('T')) return bound;
    return which === 'min' ? `${bound}T00:00:00` : `${bound}T23:59:59`;
  };
  const norm = (bound: string) => {
    if (withSeconds) {
      return bound.length >= 19 ? bound.slice(0, 19) : `${bound}:00`.slice(0, 19);
    }
    return bound.slice(0, 16);
  };
  if (minBound) {
    const minInst = toInstant(minBound, 'min');
    if (cur < norm(minInst)) return parseParts(minInst, 'datetime') ?? p;
  }
  if (maxBound) {
    const maxInst = toInstant(maxBound, 'max');
    if (cur > norm(maxInst)) return parseParts(maxInst, 'datetime') ?? p;
  }
  return p;
}

/** One step of a field segment; wraps within natural ranges (year free, month/day/time cyclic). */
function stepParts(p: Parts, key: SegKey, dir: 1 | -1): Parts {
  const next = { ...p };
  if (key === 'year') {
    next.y = next.y + dir;
    next.d = clampDay(next.y, next.mo, next.d);
  } else if (key === 'month') {
    let mo = next.mo + dir;
    let y = next.y;
    if (mo > 11) { mo = 0; y += 1; }
    if (mo < 0) { mo = 11; y -= 1; }
    next.mo = mo;
    next.y = y;
    next.d = clampDay(y, mo, next.d);
  } else if (key === 'day') {
    const dim = daysInMonth(next.y, next.mo);
    let d = next.d + dir;
    if (d > dim) d = 1;
    if (d < 1) d = dim;
    next.d = d;
  } else if (key === 'h') {
    next.h = (next.h + dir + 24) % 24;
  } else if (key === 'mi') {
    next.mi = (next.mi + dir + 60) % 60;
  } else if (key === 's') {
    next.s = (next.s + dir + 60) % 60;
  }
  return next;
}

/**
 * Themed Chromium-style date/time picker.
 * - Field: segmented edit (Tab / click / digits / arrows) like native datetime-local.
 * - Popover: mouse-only calendar + time spins (no keyboard/focus navigation).
 */
export function ThemedDatetimePicker({
  value,
  onChange,
  mode = 'datetime',
  withSeconds = true,
  className,
  style,
  disabled = false,
  'aria-label': ariaLabel,
  placeholder,
  inputRef,
  onBlur,
  autoFocus,
  openOnFocus = true,
  onKeyDown,
  variant = 'field',
  minDate,
  maxDate,
  minDateTime,
  maxDateTime,
  actions = 'standard',
  onLive,
  showChevron,
}: Props) {
  const [open, setOpen] = useState(false);
  const [fieldFocused, setFieldFocused] = useState(false);
  /** After Clear: keep the input blank while focused (draft still seeds the calendar). */
  const [cleared, setCleared] = useState(false);
  const [activeSeg, setActiveSeg] = useState<SegKey>(() => fieldSegKeys(mode, withSeconds)[0]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const localInputRef = useRef<HTMLInputElement>(null);
  const skipFocusOpen = useRef(false);
  const digitBuf = useRef('');
  const pendingSelect = useRef<SegKey | null>(null);
  const ignoreSelect = useRef(false);
  const valueAtFocus = useRef(value);
  const dirty = useRef(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const markDirty = () => {
    dirty.current = true;
    setCleared(false);
  };

  const base = useMemo(() => parseParts(value, mode) ?? parseParts('', mode)!, [value, mode]);
  const [viewY, setViewY] = useState(base.y);
  const [viewMo, setViewMo] = useState(base.mo);
  const [draft, setDraft] = useState(base);

  const shown = cleared
    ? ''
    : (fieldFocused || open)
      ? formatParts(draft, mode, withSeconds)
      : value;
  const segs = useMemo(
    () => fieldSegments(shown, mode, withSeconds),
    [shown, mode, withSeconds],
  );

  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    const p = parseParts(value, mode) ?? parseParts('', mode)!;
    setDraft(p);
    setViewY(p.y);
    setViewMo(p.mo);
    if (!wasOpen.current) {
      wasOpen.current = true;
    }
  }, [open, value, mode]);

  const place = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = mode === 'time' ? 160 : mode === 'date' ? 240 : 360;
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    let top = r.bottom + 4;
    const estH = mode === 'time' ? 160 : 320;
    if (top + estH > window.innerHeight - 8) top = Math.max(8, r.top - estH - 4);
    setPos({ top, left });
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!cardRef.current?.contains(n) && !wrapRef.current?.contains(n)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const closePicker = () => setOpen(false);
  const openPicker = () => {
    if (disabled) return;
    setOpen(true);
  };

  const commitDraft = (p: Parts = draft) => {
    const clamped = clampPartsToDb(
      { ...p, d: clampDay(p.y, p.mo, p.d) },
      mode,
      withSeconds,
      minDateTime,
      maxDateTime,
      minDate,
      maxDate,
    );
    setDraft(clamped);
    setViewY(clamped.y);
    setViewMo(clamped.mo);
    const formatted = formatParts(clamped, mode, withSeconds);
    onChange(formatted);
    valueAtFocus.current = formatted;
    dirty.current = false;
  };

  const selectSeg = (key: SegKey, keepDigits = false) => {
    if (!keepDigits) digitBuf.current = '';
    pendingSelect.current = key;
    setActiveSeg(key);
    const el = localInputRef.current;
    const text = formatParts(draft, mode, withSeconds);
    const list = fieldSegments(text, mode, withSeconds);
    const seg = list.find(s => s.key === key);
    if (el && seg) {
      ignoreSelect.current = true;
      el.setSelectionRange(seg.start, seg.end);
      queueMicrotask(() => { ignoreSelect.current = false; });
    }
  };

  useLayoutEffect(() => {
    const key = pendingSelect.current ?? activeSeg;
    if (!fieldFocused) return;
    const el = localInputRef.current;
    if (!el) return;
    const list = fieldSegments(shown, mode, withSeconds);
    const seg = list.find(s => s.key === key);
    if (!seg) return;
    ignoreSelect.current = true;
    el.setSelectionRange(seg.start, seg.end);
    pendingSelect.current = null;
    queueMicrotask(() => { ignoreSelect.current = false; });
  }, [shown, activeSeg, fieldFocused, mode, withSeconds]);

  const applySegmentDigits = (key: SegKey, digits: string) => {
    const maxLen = key === 'year' ? 4 : 2;
    const raw = digits.replace(/\D/g, '').slice(-maxLen);
    if (!raw) return;
    let n = Number(raw);
    const next = { ...draft };
    if (key === 'year') {
      next.y = Math.min(9999, Math.max(0, n));
      setViewY(next.y);
      next.d = clampDay(next.y, next.mo, next.d);
    } else if (key === 'month') {
      n = Math.min(12, Math.max(1, n));
      next.mo = n - 1;
      setViewMo(next.mo);
      next.d = clampDay(next.y, next.mo, next.d);
    } else if (key === 'day') {
      const dim = daysInMonth(next.y, next.mo);
      next.d = Math.min(dim, Math.max(1, n));
    } else if (key === 'h') {
      next.h = Math.min(23, Math.max(0, n));
    } else if (key === 'mi') {
      next.mi = Math.min(59, Math.max(0, n));
    } else if (key === 's') {
      next.s = Math.min(59, Math.max(0, n));
    }
    markDirty();
    setDraft(next);
    pendingSelect.current = key;
  };

  /** ArrowUp/Down: free segment scroll in the field (DB clamp happens on blur/OK). */
  const bumpSeg = (key: SegKey, dir: 1 | -1) => {
    const candidate = stepParts(draft, key, dir);
    markDirty();
    setDraft(candidate);
    setViewY(candidate.y);
    setViewMo(candidate.mo);
    pendingSelect.current = key;
  };

  const shiftFieldSeg = (dir: 1 | -1): boolean => {
    const keys = fieldSegKeys(mode, withSeconds);
    const idx = keys.indexOf(activeSeg);
    const next = keys[idx + dir];
    if (!next) return false;
    selectSeg(next);
    return true;
  };

  const todayParts = () => {
    const n = new Date();
    return {
      y: n.getFullYear(), mo: n.getMonth(), d: n.getDate(),
      h: n.getHours(), mi: n.getMinutes(), s: n.getSeconds(),
    };
  };
  const todayAllowed = (() => {
    const t = todayParts();
    return inRange(t.y, t.mo, t.d, minDate, maxDate);
  })();

  const canShiftMonth = (dir: 1 | -1) => {
    let mo = viewMo + dir;
    let y = viewY;
    if (mo > 11) { mo = 0; y += 1; }
    if (mo < 0) { mo = 11; y -= 1; }
    const dim = daysInMonth(y, mo);
    const first = dateKey(y, mo, 1);
    const last = dateKey(y, mo, dim);
    if (minDate && last < minDate) return false;
    if (maxDate && first > maxDate) return false;
    return true;
  };

  const shiftMonth = (dir: 1 | -1) => {
    if (!canShiftMonth(dir)) return;
    let mo = viewMo + dir;
    let y = viewY;
    if (mo > 11) { mo = 0; y += 1; }
    if (mo < 0) { mo = 11; y -= 1; }
    setViewMo(mo);
    setViewY(y);
  };

  const pickDay = (y: number, mo: number, d: number) => {
    const next = { ...draft, y, mo, d };
    markDirty();
    setDraft(next);
    setViewY(y);
    setViewMo(mo);
    selectSeg('day');
  };

  const setTimePart = (key: 'h' | 'mi' | 's', n: number) => {
    const next = { ...draft };
    if (key === 'h') next.h = ((n % 24) + 24) % 24;
    if (key === 'mi') next.mi = ((n % 60) + 60) % 60;
    if (key === 's') next.s = ((n % 60) + 60) % 60;
    markDirty();
    setDraft(next);
    selectSeg(key);
  };

  const runClear = () => {
    setCleared(true);
    dirty.current = false;
    valueAtFocus.current = '';
    onChange('');
    const p = parseParts('', mode)!;
    setDraft(p);
    setViewY(p.y);
    setViewMo(p.mo);
    closePicker();
  };

  /** Set draft to current local now (does not commit — use OK). */
  const runNow = () => {
    if (!todayAllowed) return;
    const p = todayParts();
    markDirty();
    setDraft(p);
    setViewY(p.y);
    setViewMo(p.mo);
  };

  const runOk = () => {
    commitDraft();
    closePicker();
  };

  const calendarCells = useMemo(() => {
    const first = new Date(viewY, viewMo, 1).getDay();
    const dim = daysInMonth(viewY, viewMo);
    const prevDim = daysInMonth(viewY, viewMo === 0 ? 11 : viewMo - 1);
    const cells: { day: number; mo: number; y: number; inMonth: boolean; enabled: boolean }[] = [];
    for (let i = first - 1; i >= 0; i--) {
      const mo = viewMo === 0 ? 11 : viewMo - 1;
      const y = viewMo === 0 ? viewY - 1 : viewY;
      const day = prevDim - i;
      cells.push({ day, mo, y, inMonth: false, enabled: inRange(y, mo, day, minDate, maxDate) });
    }
    for (let d = 1; d <= dim; d++) {
      cells.push({
        day: d, mo: viewMo, y: viewY, inMonth: true,
        enabled: inRange(viewY, viewMo, d, minDate, maxDate),
      });
    }
    let next = 1;
    const nextMo = viewMo === 11 ? 0 : viewMo + 1;
    const nextY = viewMo === 11 ? viewY + 1 : viewY;
    while (cells.length % 7 !== 0) {
      const day = next++;
      cells.push({
        day, mo: nextMo, y: nextY, inMonth: false,
        enabled: inRange(nextY, nextMo, day, minDate, maxDate),
      });
    }
    return cells;
  }, [viewY, viewMo, minDate, maxDate]);

  const displayPlaceholder = placeholder
    ?? (mode === 'date'
      ? 'YYYY-MM-DD'
      : mode === 'time'
        ? (withSeconds ? 'HH:mm:ss' : 'HH:mm')
        : (withSeconds ? 'YYYY-MM-DDTHH:mm:ss' : 'YYYY-MM-DDTHH:mm'));

  const setInputRef = (el: HTMLInputElement | null) => {
    localInputRef.current = el;
    if (typeof inputRef === 'function') inputRef(el);
    else if (inputRef && 'current' in inputRef) (inputRef as { current: HTMLInputElement | null }).current = el;
  };

  const useHostChrome = Boolean(className) && variant === 'field';
  const chevronVisible = showChevron ?? variant === 'field';
  const fieldStyle: CSSProperties = variant === 'bare'
    ? {
        ...style,
        border: 'none',
        outline: 'none',
        background: 'transparent',
        padding: 0,
        color: 'inherit',
        font: 'inherit',
        width: '100%',
        minWidth: 0,
        cursor: disabled ? 'default' : 'text',
      }
    : useHostChrome
      ? {
          width: '100%',
          boxSizing: 'border-box',
          outline: 'none',
          cursor: disabled ? 'default' : 'text',
          ...(chevronVisible ? { paddingRight: '1.4rem' } : null),
          ...style,
        }
      : {
          width: '100%',
          boxSizing: 'border-box',
          background: 'var(--bg-inset)',
          border: '1px solid var(--border-color)',
          borderRadius: 6,
          padding: '0.25rem 0.45rem',
          ...(chevronVisible ? { paddingRight: '1.4rem' } : null),
          color: 'var(--text-main)',
          fontSize: '0.75rem',
          fontFamily: "'JetBrains Mono', monospace",
          outline: 'none',
          cursor: disabled ? 'default' : 'text',
          ...style,
        };

  const onFieldKeyDown = (e: KeyboardEvent) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;

    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        skipFocusOpen.current = true;
        // Discard in-progress edits (same as invalid blur revert).
        const p = parseParts(valueAtFocus.current, mode) ?? parseParts('', mode)!;
        setDraft(p);
        setViewY(p.y);
        setViewMo(p.mo);
        dirty.current = false;
        closePicker();
      }
      return;
    }

    if (e.key === 'Tab') {
      const keys = fieldSegKeys(mode, withSeconds);
      const idx = keys.indexOf(activeSeg);
      if (!e.shiftKey && idx >= 0 && idx < keys.length - 1) {
        e.preventDefault();
        if (!open && openOnFocus) openPicker();
        selectSeg(keys[idx + 1]);
        return;
      }
      if (e.shiftKey && idx > 0) {
        e.preventDefault();
        if (!open && openOnFocus) openPicker();
        selectSeg(keys[idx - 1]);
        return;
      }
      return;
    }

    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      if (!open && openOnFocus) openPicker();
      const key = activeSeg;
      const maxLen = key === 'year' ? 4 : 2;
      digitBuf.current = (digitBuf.current + e.key).slice(-maxLen);
      applySegmentDigits(key, digitBuf.current);
      if (digitBuf.current.length >= maxLen) {
        const keys = fieldSegKeys(mode, withSeconds);
        const i = keys.indexOf(key);
        digitBuf.current = '';
        if (i >= 0 && i < keys.length - 1) {
          pendingSelect.current = keys[i + 1];
          setActiveSeg(keys[i + 1]);
        } else {
          pendingSelect.current = key;
        }
      } else {
        pendingSelect.current = key;
      }
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (!open && openOnFocus) openPicker();
      shiftFieldSeg(e.key === 'ArrowRight' ? 1 : -1);
      return;
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open && openOnFocus) openPicker();
      digitBuf.current = '';
      bumpSeg(activeSeg, e.key === 'ArrowDown' ? 1 : -1);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      runOk();
    }
  };

  const onInputMouseUp = () => {
    if (ignoreSelect.current) return;
    const el = localInputRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? 0;
    const hit = segAtCaret(segs, caret);
    if (hit) selectSeg(hit.key);
  };

  const onWrapMouseDown = (e: ReactMouseEvent) => {
    if (disabled) return;
    const target = e.target as HTMLElement;
    if (target === localInputRef.current || localInputRef.current?.contains(target)) {
      if (!open) openPicker();
      return;
    }
    e.preventDefault();
    if (open) {
      skipFocusOpen.current = true;
      commitDraft();
      closePicker();
    } else {
      openPicker();
    }
    localInputRef.current?.focus();
  };

  const keepFieldFocus = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const timeSpin = (key: 'h' | 'mi' | 's', label: string, cur: number, max: number) => (
    <div
      key={key}
      data-time-spin={key}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, width: 40 }}
    >
      <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)' }}>{label}</div>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Increase ${label}`}
        style={iconBtn()}
        onClick={() => setTimePart(key, cur + 1)}
      >
        <ChevronUp size={14} />
      </button>
      <div
        role="spinbutton"
        aria-label={label === 'HH' ? 'hour' : label === 'MM' ? 'minute' : 'second'}
        aria-valuenow={cur}
        aria-valuemin={0}
        aria-valuemax={max}
        onWheel={(e: ReactWheelEvent) => {
          e.preventDefault();
          setTimePart(key, cur + (e.deltaY < 0 ? 1 : -1));
        }}
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.85rem',
          fontWeight: 600,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          borderRadius: 4,
          background: 'var(--bg-inset)',
        }}
      >
        {pad(cur)}
      </div>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Decrease ${label}`}
        style={iconBtn()}
        onClick={() => setTimePart(key, cur - 1)}
      >
        <ChevronDown size={14} />
      </button>
    </div>
  );

  return (
    <>
      <div
        ref={wrapRef}
        style={{ display: 'inline-flex', alignItems: 'center', width: '100%', minWidth: 0, position: 'relative', flex: variant === 'bare' ? '1 1 auto' : undefined }}
        onMouseDown={onWrapMouseDown}
      >
        <input
          ref={setInputRef}
          type="text"
          disabled={disabled}
          className={className}
          style={fieldStyle}
          value={shown}
          placeholder={displayPlaceholder}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          autoFocus={autoFocus}
          spellCheck={false}
          onFocus={() => {
            if (disabled) return;
            setFieldFocused(true);
            valueAtFocus.current = value;
            dirty.current = false;
            setCleared(!value.trim());
            const p = parseParts(value, mode) ?? parseParts('', mode)!;
            setDraft(p);
            setViewY(p.y);
            setViewMo(p.mo);
            const first = fieldSegKeys(mode, withSeconds)[0];
            pendingSelect.current = first;
            setActiveSeg(first);
            digitBuf.current = '';
            if (skipFocusOpen.current) {
              skipFocusOpen.current = false;
              return;
            }
            if (openOnFocus) openPicker();
          }}
          onChange={e => {
            const v = e.target.value;
            markDirty();
            const p = parseParts(v, mode);
            if (p) {
              setDraft(p);
              setViewY(p.y);
              setViewMo(p.mo);
              onChange(formatParts(p, mode, withSeconds));
            } else {
              onChange(v);
            }
          }}
          onMouseUp={onInputMouseUp}
          onBlur={() => {
            setFieldFocused(false);
            digitBuf.current = '';
            if (cleared) {
              onChange('');
              dirty.current = false;
            } else if (dirty.current) {
              commitDraft();
            }
            closePicker();
            onBlur?.();
          }}
          onKeyDown={onFieldKeyDown}
        />
        {chevronVisible && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              right: 4,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-dim)',
              padding: 2,
              pointerEvents: 'none',
              display: 'inline-flex',
            }}
          >
            <ChevronDown size={14} />
          </span>
        )}
      </div>
      {open && pos && createPortal(
        <div
          ref={cardRef}
          role="dialog"
          aria-label="Date and time picker"
          data-themed-datetime-picker
          data-active-seg={activeSeg}
          style={{ ...popoverPanel, top: pos.top, left: pos.left }}
          onMouseDown={keepFieldFocus}
        >
          <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'stretch' }}>
            {mode !== 'time' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Previous month"
                    disabled={!canShiftMonth(-1)}
                    style={iconBtnStyle(!canShiftMonth(-1))}
                    onClick={() => shiftMonth(-1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <div
                    data-cal-heading
                    style={{ fontWeight: 600, fontSize: '0.78rem', textAlign: 'center', minWidth: 120 }}
                  >
                    {MONTHS[viewMo]} {viewY}
                  </div>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Next month"
                    disabled={!canShiftMonth(1)}
                    style={iconBtnStyle(!canShiftMonth(1))}
                    onClick={() => shiftMonth(1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
                <div
                  role="grid"
                  aria-label="Calendar"
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}
                >
                  {WEEKDAYS.map(w => (
                    <div
                      key={w}
                      style={{
                        width: CELL,
                        height: 20,
                        textAlign: 'center',
                        fontSize: '0.6rem',
                        color: 'var(--text-dim)',
                        lineHeight: '20px',
                      }}
                    >
                      {w}
                    </div>
                  ))}
                  {calendarCells.map((c, i) => {
                    const selected = c.y === draft.y && c.mo === draft.mo && c.day === draft.d;
                    return (
                      <button
                        key={`${c.y}-${c.mo}-${c.day}-${i}`}
                        type="button"
                        tabIndex={-1}
                        disabled={!c.enabled}
                        aria-label={`${c.y}-${pad(c.mo + 1)}-${pad(c.day)}`}
                        aria-pressed={selected}
                        style={dayBtn(selected, !c.inMonth, !c.enabled)}
                        onClick={() => {
                          if (c.enabled) pickDay(c.y, c.mo, c.day);
                        }}
                      >
                        {c.day}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div
              data-side-block
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: '0.35rem',
                paddingLeft: mode === 'time' ? 0 : 4,
                borderLeft: mode === 'time' ? 'none' : '1px solid var(--border-subtle)',
                minWidth: 56,
                alignSelf: 'stretch',
              }}
            >
              {mode !== 'date' && (
                <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', marginBottom: '0.15rem' }}>
                  {timeSpin('h', 'HH', draft.h, 23)}
                  <span style={{ color: 'var(--text-dim)', marginTop: 18 }}>:</span>
                  {timeSpin('mi', 'MM', draft.mi, 59)}
                  {withSeconds && (
                    <>
                      <span style={{ color: 'var(--text-dim)', marginTop: 18 }}>:</span>
                      {timeSpin('s', 'SS', draft.s, 59)}
                    </>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {actions === 'since' && (
                  <>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="Since"
                      style={chipBtn(true)}
                      onClick={runOk}
                    >
                      Since…
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="Clear"
                      style={chipBtn(false)}
                      onClick={runClear}
                    >
                      Clear
                    </button>
                  </>
                )}
                {actions === 'before' && (
                  <>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="Before"
                      style={chipBtn(true)}
                      onClick={runOk}
                    >
                      Before…
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="Live"
                      title="Live"
                      style={{
                        ...chipBtn(false),
                        color: '#22c55e',
                        minWidth: CELL,
                        padding: 0,
                      }}
                      onClick={() => {
                        runClear();
                        onLive?.();
                      }}
                    >
                      <Play size={14} fill="currentColor" />
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="Clear"
                      style={chipBtn(false)}
                      onClick={runClear}
                    >
                      Clear
                    </button>
                  </>
                )}
                {actions === 'standard' && (
                  <>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="Clear"
                      style={chipBtn(false)}
                      onClick={runClear}
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="Now"
                      disabled={!todayAllowed}
                      style={chipBtn(false, !todayAllowed)}
                      onClick={runNow}
                    >
                      Now
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="OK"
                      style={chipBtn(true)}
                      onClick={runOk}
                    >
                      OK
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
