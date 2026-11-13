import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode, type UIEvent as ReactUIEvent } from 'react';
import { Plus, Minus, AlertTriangle, CheckCircle2, Timer, RotateCcw, X, Send } from 'lucide-react';

import type { FilterOption } from '../types/filters';
import type { Telegram } from '../hooks/useWebSocket';
import { useLastSeenValues } from '../hooks/useLastSeenValues';
import {
  formatDpt,
  parseDptMain,
  readTelegram,
  sendTelegram,
  startScheduledSend,
  getScheduledSendStatus,
  cancelScheduledSend,
  cancelAllScheduledSends,
  type ScheduledSendStatus,
} from '../utils/knxSend';
import { GaCombobox } from './GaCombobox';
import { DptField } from './DptField';
import { WriteControls, needsValueColumn } from './WriteControls';
import { TelegramWhenJump, telegramEventType } from './TelegramWhenJump';
import { EventTypeLabel } from './EventTypeLabel';
import { useGaReadPhase, useReadAnswered } from './GaReadPhase';
import { secondaryBtn } from '../utils/buttonStyles';
import { loadRecentGas, pushRecentGa } from '../utils/recentGas';
import { buildWriteDptOptions, dptUnit } from '../utils/dpt';
import { describeBusPayload, formatBusValueForDpt, type BusPayload } from '../utils/dptValues';
import { BusValueText } from './BusValueText';
import { getPref, setPref } from '../utils/prefs';
import {
  ROW_OUTLINE_FLASH_CLASS,
  ROW_OUTLINE_FLASH_CSS,
  ROW_OUTLINE_FLASH_MS,
} from '../utils/rowOutlineFlash';
import { useRetainFocusThroughDisabled } from '../hooks/useRetainFocusThroughDisabled';
import { SecondsField } from './SecondsField';
import {
  sanitizeSecondsInput,
  rowsEqualForCorrespondence,
  type SendCorrespondenceKey,
  type SendPanelCommand,
  type SendPanelCommandResult,
  type LinkedRowStatus,
} from '../utils/sendCorrespondence';

export type { SendCorrespondenceKey, SendPanelCommand, SendPanelCommandResult, LinkedRowStatus };

/** Panel Read button: keeps visible focus through the row busy→disabled cycle. */
function RetainFocusReadButton({
  disabled,
  muted = false,
  respond = false,
  onRead,
  onToggle,
  title,
  address,
  'data-wtb-col': dataWtbCol,
}: {
  disabled: boolean;
  /** Stronger fade when a write job owns the row. A read job keeps the normal disabled tone. */
  muted?: boolean;
  /** Mode flag: Write buttons send a GroupValueResponse instead of a Write. */
  respond?: boolean;
  onRead: () => void;
  /** Ctrl/cmd-click switches Read ↔ Response mode. Ignored while the button is disabled. */
  onToggle?: () => void;
  title: string;
  address: string;
  'data-wtb-col'?: string;
}) {
  const { retainClickFocus } = useRetainFocusThroughDisabled(disabled);
  const phase = useGaReadPhase(address);
  return (
    <button
      type="button"
      className="wtb-read-btn"
      data-wtb-col={dataWtbCol}
      disabled={disabled}
      style={secondaryBtn(disabled, muted)}
      title={title}
      onClick={e => {
        retainClickFocus(e);
        if ((e.ctrlKey || e.metaKey) && onToggle) {
          onToggle();
          return;
        }
        onRead();
      }}
    >
      <EventTypeLabel
        kind={respond ? 'Response' : 'Read'}
        showIcon
        phase={phase}
        iconDim={disabled ? (muted ? 'muted' : 'disabled') : undefined}
        iconSize={14}
      />
    </button>
  );
}

/** Top send-panel row hint for TT send-icon blue state (GA + DPT; delay/every empty). */
export type SendPanelTopRowHint = { address: string; dpt: string };

/** Ctrl-click send-icon request: clear matching top row or insert at top. */
export type CtrlSendRequest = {
  nonce: number;
  address: string;
  name?: string | null;
  dptMain?: number | null;
  dptSub?: number | null;
};

interface Props {
  /** Group addresses from the loaded project (with optional DPT main/sub). */
  targets: FilterOption[];
  /** Newest telegram from the live feed; keeps each row's last value current (#439). */
  latestTelegram?: Telegram | null;
  /** Project DPT catalog (`label` is "5.001 - Percent") so hints can name types the project uses. */
  dptCatalog?: FilterOption[];
  /** Jump the telegram list to the telegram that carried this row's last value. */
  onGotoTelegram?: (telegram: Telegram) => void;
  /** Reports the top row's GA/DPT when delay/every are empty (legacy hint). */
  onTopRowHintChange?: (hint: SendPanelTopRowHint | null) => void;
  /** Every unique non-empty GA currently in the panel (TT send-icon opaque/blue). */
  onPanelAddressesChange?: (addresses: string[]) => void;
  /** Ctrl-click from TT send icon: clear matching top row or insert at top. */
  ctrlSendRequest?: CtrlSendRequest | null;
  /** Called after a ctrlSendRequest has been applied. */
  onCtrlSendHandled?: () => void;
  /** Popover ↔ panel correspondence commands (ensure / cancel / write). */
  sendPanelCommand?: SendPanelCommand | null;
  /** Called after a sendPanelCommand has been applied. */
  onSendPanelCommandHandled?: (result: SendPanelCommandResult) => void;
  /** Emits live status for rows (popover mirrors linked row). */
  onLinkedRowStatusesChange?: (statuses: Record<string, LinkedRowStatus>) => void;
  /**
   * Live send-job status keyed by GA address (TT send-icon + popover status).
   * One entry per address that currently owns a waiting/running job.
   */
  onGaJobStatusesChange?: (byAddress: Record<string, LinkedRowStatus>) => void;
  /** Fill the workspace tabpanel (no docked height chrome). */
  embedded?: boolean;
}

interface Row {
  id: string;
  address: string;
  /** Shown in the name field. Filled from the project when an address resolves. */
  name: string;
  dpt: string;
  value: string;
  delay: string;
  every: string;
  /** When true, Write buttons send a GroupValueResponse instead of a Write. */
  respond: boolean;
  busy: boolean;
  feedback: { ok: boolean; msg: string } | null;
  /**
   * Set by Read: timestamp of the value shown when the request went out
   * ('' when none). Waiting itself is driven by statusWatch === 'read'.
   */
  readBaseline: string | null;
  /**
   * After a send/read, bind the matching bus telegram on the live feed.
   * 'read' keeps the Read event until a Response replaces it. Writes never clear it.
   */
  statusWatch: 'write' | 'read' | null;
  /** Bus telegram currently shown in Status (time + jump). */
  statusTelegram: Telegram | null;
  /**
   * This row sent a Read and is waiting to show that Read.
   * Other rows on the same GA keep their own read event. Not persisted.
   */
  claimOwnRead?: boolean;
  /**
   * Last Write this row caused on the bus. Survives Read waits / Clear so a
   * later Write or idle fallback can reuse it — Cancel never restores it over
   * an unanswered Read.
   */
  lastSentTelegram: Telegram | null;
  /**
   * Server UUID of this row's scheduled job (not the GA). Survives panel toggle
   * so refreshJobs can reattach by id when several rows share an address.
   */
  scheduledJobId: string | null;
}

const GA_RE = /^\d{1,2}\/\d{1,2}\/\d{1,3}$|^\d{1,2}\/\d{1,4}$|^\d{1,5}$/;

/**
 * Name typed into the name field → one project GA.
 * `'ambiguous'` means several GAs share that name, so the caller must not guess.
 */
function resolveName(text: string, options: FilterOption[]): FilterOption | 'ambiguous' | null {
  const q = text.trim().toLowerCase();
  if (!q) return null;
  const named = options.filter(o => o.address && (o.name ?? '').toLowerCase() === q);
  if (named.length === 1) return named[0];
  if (named.length > 1) return 'ambiguous';
  return options.find(o => (o.address ?? '').toLowerCase() === q) ?? null;
}
const POLL_INTERVAL_MS = 1000;

let rowSeq = 0;
const newRow = (): Row => ({
  id: `row-${rowSeq++}`, address: '', name: '', dpt: '', value: '', delay: '', every: '', respond: false, busy: false, feedback: null,
  readBaseline: null, statusWatch: null, statusTelegram: null, lastSentTelegram: null,
  scheduledJobId: null,
});

/** Stable floor so the status track does not jump / overflow into Delete. */
const STATUS_SHELL_MIN_WIDTH = '9.75rem';
/** Floor with Clear-only action (no Cancel label). */
const STATUS_SHELL_MIN_WIDTH_CLEAR = '6.75rem';
/** Floor without the Cancel/Clear track — keeps empty/idle shells compact. */
const STATUS_SHELL_MIN_WIDTH_COMPACT = '5.75rem';
/** Fits the Cancel label + divider; used when any row shows Cancel. */
export const STATUS_ACTION_WIDTH = '4.25rem';
/** Fits the Clear X / empty spacer when no Cancel is on the panel. */
export const STATUS_CLEAR_WIDTH = '11px';
/** Send-count column. Same width on every row that shows the column. */
const STATUS_COUNT_TRACK = '4ch';
/** `yyyy-MM-dd HH:mm:ss`, the gap, and the clock button. */
const STATUS_WHEN_TRACK = 'calc(19ch + 0.35rem + 13px + 0.3rem)';
/** RESPONSE is the longest event word. */
const STATUS_EVENT_TRACK = '8ch';
/**
 * Clock button in the status jump: 13px icon + 0.15rem padding each side.
 * The shell is always this tall, so clearing the status does not shrink it.
 */
const STATUS_SHELL_HEIGHT = 'calc(0.7rem + 2px + max(14px, 1.2em, 13px + 0.3rem))';

/** Row has anything that warrants Cancel/Clear or fills the status body. */
function rowHasStatusChrome(
  row: Pick<Row, 'feedback' | 'statusWatch' | 'statusTelegram' | 'lastSentTelegram'>,
  job: ScheduledSendStatus | null | undefined,
): boolean {
  return Boolean(
    isLiveJob(job)
    || row.feedback
    || row.statusWatch
    || row.statusTelegram
    || row.lastSentTelegram,
  );
}

function measureStatusShell(shell: HTMLElement): number {
  // measureIntrinsicWidth forces minWidth:max-content and would drop the CSS
  // floor, leaving the track too narrow so the shell paints over Delete.
  // Error copy is tooltip + ellipsis only — zero it during measure so a long
  // message cannot widen the status track (tracks only grow).
  const errorText = shell.querySelector('[data-status-error]') as HTMLElement | null;
  const prev = {
    width: shell.style.width,
    maxWidth: shell.style.maxWidth,
    errorWidth: errorText?.style.width ?? '',
    errorMaxWidth: errorText?.style.maxWidth ?? '',
    errorMinWidth: errorText?.style.minWidth ?? '',
  };
  if (errorText) {
    errorText.style.width = '0';
    errorText.style.minWidth = '0';
    errorText.style.maxWidth = '0';
  }
  shell.style.width = 'max-content';
  shell.style.maxWidth = 'none';
  const w = Math.ceil(shell.getBoundingClientRect().width || shell.scrollWidth);
  shell.style.width = prev.width;
  shell.style.maxWidth = prev.maxWidth;
  if (errorText) {
    errorText.style.width = prev.errorWidth;
    errorText.style.minWidth = prev.errorMinWidth;
    errorText.style.maxWidth = prev.errorMaxWidth;
  }
  return w;
}

/** Clear transient status; keeps lastSentTelegram so the row remembers its last Write. */
function clearStatusPatch(): Pick<Row, 'feedback' | 'readBaseline' | 'statusWatch' | 'statusTelegram'> {
  return { feedback: null, readBaseline: null, statusWatch: null, statusTelegram: null };
}

/** Full status reset including the remembered last Write (Clear button). */
function clearAllStatusPatch(): Pick<
  Row,
  'feedback' | 'readBaseline' | 'statusWatch' | 'statusTelegram' | 'lastSentTelegram'
> {
  return { ...clearStatusPatch(), lastSentTelegram: null };
}

function isWriteTelegram(tg: Telegram | null | undefined): boolean {
  if (!tg) return false;
  return tg.simplified_type === 'Write' || Boolean(tg.telegram_type?.includes('Write'));
}

function isReadTelegram(tg: Telegram | null | undefined): boolean {
  if (!tg) return false;
  if (tg.simplified_type === 'Read') return true;
  return Boolean(tg.telegram_type?.includes('Read')) && !tg.telegram_type?.includes('Response');
}

function isResponseTelegram(tg: Telegram | null | undefined): boolean {
  if (!tg) return false;
  return tg.simplified_type === 'Response' || Boolean(tg.telegram_type?.includes('Response'));
}

/** True when this telegram is one this row's job put on the bus, not another device's echo. */
function telegramFromRowJob(job: ScheduledSendStatus, tg: Telegram): boolean {
  // A read job's own Read may arrive Incoming or Outgoing.
  if (job.read) return isReadTelegram(tg);
  if (tg.direction === 'Incoming') return false;
  if (job.response) return isResponseTelegram(tg);
  if (!isWriteTelegram(tg) || isResponseTelegram(tg)) return false;
  return payloadMatchesJob(job.payload, tg);
}

/** Telegram currently drawn in the status jump, or null while an error or a send owns the row. */
function visibleStatusTelegram(
  row: Pick<Row, 'feedback' | 'busy' | 'statusWatch' | 'statusTelegram' | 'lastSentTelegram'>,
  rowJob: ScheduledSendStatus | null,
  lastTelegram: Telegram | undefined,
): Telegram | null {
  const showJob = isLiveJob(rowJob);
  const unansweredRead = row.statusWatch === 'read' || isReadRequestFeedback(row.feedback);
  const jobTelegram = showJob && rowJob && row.statusTelegram && telegramFromRowJob(rowJob, row.statusTelegram)
    ? row.statusTelegram
    : null;
  if ((row.feedback && !row.feedback.ok) || row.busy) return null;
  if (showJob) return jobTelegram;
  return row.statusTelegram
    ?? (!unansweredRead ? row.lastSentTelegram : null)
    ?? (row.statusWatch === 'write' && lastTelegram && isWriteTelegram(lastTelegram) ? lastTelegram : null);
}

function payloadMatchesJob(payload: unknown, tg: Telegram): boolean {
  if (payload == null) return true;
  const shown = (tg.value_formatted ?? '').trim();
  if (typeof payload === 'boolean') {
    if (tg.value_numeric === 0 || tg.value_numeric === 1) return payload === (tg.value_numeric === 1);
    const text = shown.toLowerCase();
    return payload ? /^(on|true|yes|1)$/.test(text) : /^(off|false|no|0)$/.test(text);
  }
  if (typeof payload === 'number') {
    if (typeof tg.value_numeric === 'number' && Math.abs(tg.value_numeric - payload) < 1e-6) return true;
    return shown === String(payload) || shown.startsWith(`${payload} `);
  }
  if (typeof payload === 'string') return shown === payload;
  return true;
}

function isReadRequestFeedback(feedback: Row['feedback']): boolean {
  return Boolean(feedback?.ok && /^Read request/i.test(feedback.msg));
}

/** Active wait or leftover Read feedback / Read telegram — do not restore Write over this. */
function hasUnansweredRead(
  row: Pick<Row, 'feedback' | 'statusWatch' | 'statusTelegram'>,
): boolean {
  return row.statusWatch === 'read'
    || isReadRequestFeedback(row.feedback)
    || isReadTelegram(row.statusTelegram);
}

function telegramValue(tg: Telegram | null | undefined, fallback = '', dpt?: string): string {
  if (!tg) return fallback;
  const shown = formatBusValueForDpt(tg, dpt);
  if (shown.text && shown.text !== '—') {
    return shown.unit ? `${shown.text} ${shown.unit}` : shown.text;
  }
  return fallback;
}

/** Shared write-panel grid: addr | name | last | event | delay | every | dpt | value | send | read | status | del | add. */
const WTB_COLS = 13;
const WTB_NAME_COL = 1;
const WTB_VALUE_COL = 7;
const WTB_SEND_COL = 8;
const WTB_STATUS_COL = 10;
/** Middle pane scrolls horizontally: name … value. GA stays pinned left. */
const WTB_MID_START = 1;
const WTB_MID_END = 8; // exclusive
/** Write, read, status, delete, add stay pinned and scroll only vertically. */
const WTB_RIGHT_START = 8;
const WTB_COL_GAP = '0.45rem';
/** Address, DPT, delay, every, value — measured content + small typing buffer. */
const WTB_BUFFER_COLS = new Set([0, 4, 5, 6, 7]);
const WTB_INPUT_BUFFER_PX = 10;

const WTB_FALLBACK_RIGHT_TRACKS = 'max-content max-content max-content max-content max-content';

/**
 * Mid-pane tracks (name … value). The name track is `minmax(w, 1fr)`, which
 * contains a space — drop the value track by column index, not by splitting
 * the template string, or the DPT track is removed instead and the field
 * paints under the send buttons.
 */
// eslint-disable-next-line react-refresh/only-export-components -- unit-tested layout helper
export function midTracksTemplate(colTracks: number[] | null, showValueCol: boolean): string {
  const tracks = colTracks
    ? colTracks.slice(WTB_MID_START, WTB_MID_END).map((w, i) => (
      WTB_MID_START + i === WTB_NAME_COL ? `minmax(${w}px, 1fr)` : `${w}px`
    ))
    : [
      'minmax(0, 1fr)',
      ...Array.from({ length: WTB_MID_END - WTB_MID_START - 1 }, () => 'max-content'),
    ];
  const visible = showValueCol
    ? tracks
    : tracks.filter((_, i) => WTB_MID_START + i !== WTB_VALUE_COL);
  return visible.join(' ');
}

function rightTracksTemplate(colTracks: number[] | null): string {
  if (!colTracks) return WTB_FALLBACK_RIGHT_TRACKS;
  return colTracks.slice(WTB_RIGHT_START).map(w => `${w}px`).join(' ');
}

function leftColWidth(colTracks: number[] | null): string {
  return colTracks ? `${colTracks[0]}px` : 'max-content';
}

function rightPaneWidth(colTracks: number[] | null): string {
  if (!colTracks) return 'max-content';
  const tracks = colTracks.slice(WTB_RIGHT_START);
  const gaps = Math.max(0, tracks.length - 1);
  return `calc(${tracks.map(w => `${w}px`).join(' + ')} + ${gaps} * ${WTB_COL_GAP})`;
}

function measureIntrinsicWidth(el: HTMLElement): number {
  // Read the CSS floor first — temporarily setting minWidth:max-content would
  // otherwise drop shells like DPT (5.75rem) and let them paint over Value.
  const minRaw = getComputedStyle(el).minWidth;
  const floor = (() => {
    if (!minRaw || minRaw === '0px' || minRaw === 'auto' || minRaw === 'none') return 0;
    const n = parseFloat(minRaw);
    return Number.isFinite(n) ? n : 0;
  })();
  const prev = {
    width: el.style.width,
    minWidth: el.style.minWidth,
    maxWidth: el.style.maxWidth,
  };
  el.style.width = 'max-content';
  el.style.minWidth = 'max-content';
  el.style.maxWidth = 'none';
  const w = Math.ceil(el.getBoundingClientRect().width || el.scrollWidth);
  el.style.width = prev.width;
  el.style.minWidth = prev.minWidth;
  el.style.maxWidth = prev.maxWidth;
  return Math.max(w, Math.ceil(floor));
}

/** Natural width of send buttons (ignores 1fr stretch) so the column fits every row. */
function measureSendNatural(cell: HTMLElement): number {
  const buttons = Array.from(cell.querySelectorAll(':scope > button')) as HTMLElement[];
  if (buttons.length === 0) return measureIntrinsicWidth(cell);
  const gap = parseFloat(getComputedStyle(cell).columnGap || getComputedStyle(cell).gap) || 0;
  let sum = 0;
  for (const btn of buttons) {
    sum += measureIntrinsicWidth(btn);
  }
  return Math.ceil(sum + gap * Math.max(0, buttons.length - 1));
}

function measureColumnCell(cell: HTMLElement, col: number): number {
  if (col === WTB_SEND_COL) return measureSendNatural(cell);
  // Shells first; then combobox/select glass-input. Never drill into nested
  // buttons (Event jump / Status cancel) — those would under-size the track
  // and let label text paint over DPT. Composite cells and Read/Del/Add
  // (where the cell IS the button) measure as the whole cell.
  const statusShell = cell.querySelector('[data-status-field]') as HTMLElement | null;
  if (statusShell) return measureStatusShell(statusShell);
  const shell = cell.querySelector(
    '[data-value-field], [data-seconds-field], [data-dpt-field]',
  ) as HTMLElement | null;
  if (shell) return measureIntrinsicWidth(shell);
  const glass = cell.querySelector('.glass-input') as HTMLElement | null;
  if (glass) return measureIntrinsicWidth(glass);
  return measureIntrinsicWidth(cell);
}

function sameTracks(a: number[] | null, b: number[]): boolean {
  return a != null && a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Merge measured column tracks. While the panel stays open, content-driven
 * updates only grow tracks; a full replace (shrink allowed) happens on remount
 * or when the available panel width changes. `noShrinkCols` still floors those
 * indices even during a shrink pass (e.g. status while an error is showing).
 */
// eslint-disable-next-line react-refresh/only-export-components -- unit-tested layout helper
export function mergeColTracks(
  prev: number[] | null,
  next: number[],
  opts: { allowShrink?: boolean; noShrinkCols?: number[] } = {},
): number[] {
  if (prev == null) return next.slice();
  const protect = new Set(opts.noShrinkCols ?? []);
  if (!opts.allowShrink) {
    return next.map((w, i) => Math.max(prev[i] ?? 0, w));
  }
  return next.map((w, i) => (protect.has(i) ? Math.max(prev[i] ?? 0, w) : w));
}

/** Thumb within this many pixels of max scroll counts as the right stop. */
const SCROLL_STOP_EPS_PX = 1;

/**
 * Horizontal mid-pane scroll after the clip width changes.
 * Shift left only when shrinking makes the scrollbar appear, or when the
 * thumb is already at the right stop — both keep the content's right edge.
 * Otherwise keep scrollLeft and only clamp it into the new range. Growing
 * does not shift; a thumb already at the stop stays there via the clamp.
 */
// eslint-disable-next-line react-refresh/only-export-components -- unit-tested layout helper
export function scrollLeftOnViewportResize(
  scrollLeft: number,
  prevViewport: number,
  nextViewport: number,
  contentWidth: number,
): number {
  const prevMax = Math.max(0, contentWidth - prevViewport);
  const nextMax = Math.max(0, contentWidth - nextViewport);
  const shrinking = nextViewport < prevViewport;
  const hadScrollbar = prevMax > 0;
  const atRightStop = scrollLeft >= prevMax - SCROLL_STOP_EPS_PX;
  if (shrinking && (!hadScrollbar || atRightStop)) {
    const rightEdge = scrollLeft + prevViewport;
    return Math.min(nextMax, Math.max(0, rightEdge - nextViewport));
  }
  return Math.min(nextMax, Math.max(0, scrollLeft));
}

const HEIGHT_PREF_KEY = 'send-panel-height';
const HEIGHT_HANDLE_PX = 3;
/** Matches global scrollbar thickness; reserved so H/V bars don't jump layout. */
const SCROLLBAR_GUTTER_PX = 8;
/** While ≤ this many send rows, grow the panel with content if it was already at max. */
const AUTO_GROW_ROW_LIMIT = 8;
function readHeightPref(): number | null {
  const n = Number(getPref(HEIGHT_PREF_KEY));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function clampPanelHeight(h: number, min: number, max: number): number {
  if (!(max > 0)) return h;
  return Math.min(max, Math.max(min > 0 ? min : 0, h));
}

/**
 * Host height: no pref → fit all content; otherwise honor the dragged/remembered
 * size (clamped). Min is header + first row (+ padding with H-scrollbar gutter).
 */
// eslint-disable-next-line react-refresh/only-export-components -- unit-tested layout helper
export function resolvePanelHeight(
  panelHeightPx: number | null,
  bounds: { min: number; max: number },
): number | undefined {
  const { min, max } = bounds;
  if (!(max > 0)) return undefined;
  if (panelHeightPx == null) return max;
  return clampPanelHeight(panelHeightPx, min, max);
}

/** Grow with a new row while ≤8 rows if the panel was already fully expanded. */
// eslint-disable-next-line react-refresh/only-export-components -- unit-tested layout helper
export function shouldAutoGrowPanelHeight(opts: {
  height: number;
  prevMax: number;
  nextMax: number;
  rowCount: number;
  dragging: boolean;
}): boolean {
  const { height, prevMax, nextMax, rowCount, dragging } = opts;
  return (
    !dragging
    && rowCount <= AUTO_GROW_ROW_LIMIT
    && nextMax > height
    && prevMax > 0
    && height >= prevMax - 1
  );
}

// ── Row persistence (#254) ───────────────────────────────────────────────────
// The panel unmounts when toggled off; without this every configured row would
// be lost. Inputs and Status (feedback / wait / bus telegram) are stored —
// busy stays transient; scheduled jobs live server-side (status poll).

const ROWS_STORAGE_KEY = 'spectrumknx-write-panel-rows';
const MAX_STORED_ROWS = 20;

type StoredRow = Pick<
  Row,
  | 'address' | 'name' | 'dpt' | 'value' | 'delay' | 'every' | 'respond' | 'feedback' | 'readBaseline'
  | 'statusWatch' | 'statusTelegram' | 'lastSentTelegram' | 'scheduledJobId'
>;

function parseFeedback(v: unknown): Row['feedback'] {
  if (!v || typeof v !== 'object') return null;
  const f = v as { ok?: unknown; msg?: unknown };
  if (typeof f.ok !== 'boolean' || typeof f.msg !== 'string') return null;
  return { ok: f.ok, msg: f.msg };
}

function parseStatusWatch(v: unknown): Row['statusWatch'] {
  return v === 'write' || v === 'read' ? v : null;
}

function parseStatusTelegram(v: unknown): Telegram | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Partial<Telegram>;
  if (typeof t.timestamp !== 'string' || typeof t.target_address !== 'string') return null;
  if (typeof t.source_address !== 'string' || typeof t.telegram_type !== 'string') return null;
  return t as Telegram;
}

function loadStoredRows(): Row[] | null {
  try {
    const raw = localStorage.getItem(ROWS_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    return parsed.slice(0, MAX_STORED_ROWS).map(p => {
      const s = p as Partial<StoredRow> | null;
      return {
        ...newRow(),
        address: str(s?.address),
        name: str(s?.name),
        dpt: str(s?.dpt),
        value: str(s?.value),
        delay: str(s?.delay),
        every: str(s?.every),
        respond: s?.respond === true,
        feedback: parseFeedback(s?.feedback),
        readBaseline: typeof s?.readBaseline === 'string' ? s.readBaseline : null,
        statusWatch: parseStatusWatch(s?.statusWatch),
        statusTelegram: parseStatusTelegram(s?.statusTelegram),
        lastSentTelegram: parseStatusTelegram(s?.lastSentTelegram),
        scheduledJobId: typeof s?.scheduledJobId === 'string' && s.scheduledJobId
          ? s.scheduledJobId
          : null,
      };
    });
  } catch {
    return null;
  }
}

/** Expected panel DPT for a telegram/project GA (or empty when unknown). */
export function expectedPanelDpt(dptMain?: number | null, dptSub?: number | null): string {
  return dptMain != null ? formatDpt(dptMain, dptSub) : '';
}

/** Top-row hint when GA is set and delay/every are empty; otherwise null. */
export function topRowHintFromRow(
  row: Pick<Row, 'address' | 'dpt' | 'delay' | 'every'> | null | undefined,
): SendPanelTopRowHint | null {
  if (!row) return null;
  const address = row.address.trim();
  if (!address || row.delay.trim() || row.every.trim()) return null;
  return { address, dpt: row.dpt.trim() };
}

/** True when a top-row hint matches this GA + expected DPT. */
export function topRowHintMatches(
  hint: SendPanelTopRowHint | null | undefined,
  address: string,
  dptMain?: number | null,
  dptSub?: number | null,
): boolean {
  if (!hint) return false;
  return hint.address === address.trim()
    && hint.dpt === expectedPanelDpt(dptMain, dptSub);
}

/** Unique trimmed GAs present in send-panel rows (order of first appearance). */
export function panelAddressesFromRows(
  rows: Array<{ address: string }>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const address = row.address.trim();
    if (!address || seen.has(address)) continue;
    seen.add(address);
    out.push(address);
  }
  return out;
}

function saveRows(rows: Row[]): void {
  try {
    const stored: StoredRow[] = rows.map(({
      address, name, dpt, value, delay, every, respond, feedback, readBaseline, statusWatch, statusTelegram, lastSentTelegram,
      scheduledJobId,
    }) => ({
      address, name, dpt, value, delay, every, respond, feedback, readBaseline, statusWatch, statusTelegram, lastSentTelegram,
      scheduledJobId,
    }));
    localStorage.setItem(ROWS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage unavailable — the rows just won't survive the next toggle.
  }
}

function isLiveJob(j: ScheduledSendStatus | null | undefined): boolean {
  return j != null && (j.state === 'waiting' || j.state === 'running');
}

function isPendingJobId(id: string | undefined): boolean {
  return Boolean(id?.startsWith('pending-'));
}

/**
 * "Write to bus" panel: send to several group addresses from stacked rows,
 * each with its own GA/DPT/value/Write/Read and optional delay/cyclic
 * scheduling, plus per-row add/remove (#215).
 *
 * Each row can run its own scheduled (delayed/cyclic) job concurrently.
 * Removing a row that owns an active job cancels that job first.
 *
 * Rows persist to localStorage so toggling the panel keeps its state (#254).
 */
export function WriteToBusPanel({
  targets, latestTelegram, dptCatalog = [], onGotoTelegram,
  onTopRowHintChange,
  onPanelAddressesChange,
  ctrlSendRequest = null,
  onCtrlSendHandled,
  sendPanelCommand = null,
  onSendPanelCommandHandled,
  onLinkedRowStatusesChange,
  onGaJobStatusesChange,
  embedded = false,
}: Props) {
  const [rows, setRows] = useState<Row[]>(() => loadStoredRows() ?? [newRow()]);
  const [recentGas, setRecentGas] = useState<string[]>(loadRecentGas);
  const [flashRowId, setFlashRowId] = useState<string | null>(null);
  const [flashNonce, setFlashNonce] = useState(0);
  /** Bumped so WriteControls focuses value/write (ctrl-insert or DPT pick). */
  const [focusToken, setFocusToken] = useState<number | null>(null);
  /** Which row should receive the focusToken bump. */
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  const bumpValueFocus = (rowId: string) => {
    setFocusRowId(rowId);
    setFocusToken(t => (t ?? 0) + 1);
  };
  /** Active scheduled job per row id (optimistic pending-* ids until POST returns). */
  const [jobsByRowId, setJobsByRowId] = useState<Record<string, ScheduledSendStatus>>({});
  const [colTracks, setColTracks] = useState<number[] | null>(null);
  /** null = natural max height (all rows); otherwise a remembered/dragged host height. */
  const [panelHeightPx, setPanelHeightPx] = useState<number | null>(() => readHeightPref());
  const [heightBounds, setHeightBounds] = useState({ min: 0, max: 0 });
  const [heightDragging, setHeightDragging] = useState(false);
  /** Bump on panel reset so the body grid host remounts and drops orphaned row DOM. */
  const [bodyEpoch, setBodyEpoch] = useState(0);
  /** Shared horizontal offset for the mid pane (name … value). */
  const [midScrollLeft, setMidScrollLeft] = useState(0);
  const [midContentWidth, setMidContentWidth] = useState(0);
  const [midViewportWidth, setMidViewportWidth] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  /** Padded column host (no full-width H-scroll). */
  const hScrollRef = useRef<HTMLDivElement>(null);
  /** Inner: vertical scroll for send rows only. */
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerGridRef = useRef<HTMLDivElement>(null);
  /** Rows host: 3-pane grid (GA | mid | status+actions). */
  const gridRef = useRef<HTMLDivElement>(null);
  const midClipRef = useRef<HTMLDivElement>(null);
  const midInnerRef = useRef<HTMLDivElement>(null);
  const midBarRef = useRef<HTMLDivElement>(null);
  const hostWidthRef = useRef<number | null>(null);
  /** Last id+DPT signature. A change reoptimizes tracks (shrink), not only grows them. */
  const dptSigRef = useRef<string | null>(null);
  /** Visible mid offset, including clamp, so a resize does not read a stale render. */
  const midScrollLeftRef = useRef(0);
  /** Previous mid-clip clientWidth. Null until the first measure (stay left-aligned). */
  const prevMidViewportRef = useRef<number | null>(null);
  const heightMaxRef = useRef(0);
  const heightDraggingRef = useRef(heightDragging);
  const pollRef = useRef<number | null>(null);
  const watchingRef = useRef(false);
  const rowsRef = useRef(rows);
  const jobsByRowIdRef = useRef(jobsByRowId);
  /** Newest Read per GA, so a job can claim the Read it just sent. */
  const latestReadByAddressRef = useRef<Map<string, Telegram>>(new Map());
  /** Pre-edit GA/name/dpt per row, captured when the GA field focuses (blur revert). */
  const gaFocusSnapshotRef = useRef<Map<string, { address: string; name: string; dpt: string }>>(new Map());
  /** Pre-edit name per row, captured when the name field focuses (unknown-name revert). */
  const nameFocusSnapshotRef = useRef<Map<string, string>>(new Map());
  /** Row ids whose pending start should be cancelled once the server returns a real UUID. */
  const cancelWhenStartedRef = useRef<Set<string>>(new Set());
  // Keep callback/poll closures current without reading refs during render.
  useLayoutEffect(() => {
    heightDraggingRef.current = heightDragging;
    rowsRef.current = rows;
    jobsByRowIdRef.current = jobsByRowId;
  });

  const byAddress = useMemo(() => {
    const m = new Map<string, FilterOption>();
    for (const t of targets) if (t.address) m.set(t.address, t);
    return m;
  }, [targets]);

  // Persisted rows store the address only. Fill the name field once the project
  // list is available, without putting a name back after the user clears it.
  const namesSeeded = useRef(false);
  useEffect(() => {
    if (namesSeeded.current || byAddress.size === 0) return;
    namesSeeded.current = true;
    setRows(rs => rs.map(r => {
      const match = byAddress.get(r.address.trim());
      return match?.name && !r.name ? { ...r, name: match.name } : r;
    }));
  }, [byAddress]);

  // DPT hints for the editable DPT field (#342): common types plus every DPT
  // present in the loaded project, each with its designation.
  const dptOptions = useMemo(
    () => buildWriteDptOptions(dptCatalog, targets),
    [targets, dptCatalog],
  );

  // Last value per row (#439): fetched once per entered GA, then kept current
  // from the live feed — which keeps flowing while the telegram list is paused,
  // so a read's response shows up here without hunting for it in the list.
  const rowAddresses = useMemo(
    () => rows.map(r => r.address.trim()).filter(a => GA_RE.test(a)),
    [rows],
  );
  const lastValues = useLastSeenValues(rowAddresses, latestTelegram, { ignoreReads: true });

  const anyJobActive = Object.values(jobsByRowId).some(isLiveJob);
  // Metric / action columns are panel-wide: keep every row's status shell
  // aligned, but only reserve space while some row actually needs it.
  // Countdown for delayed wait and cyclic interval gaps; count only once a
  // cyclic job has actually sent at least once (sends_done > 0).
  const showCountdownCol = Object.values(jobsByRowId).some(
    j => isLiveJob(j) && Boolean(j.next_send_at || j.state === 'waiting'),
  );
  const showSendCountCol = Object.values(jobsByRowId).some(
    j => isLiveJob(j)
      && Boolean(j.interval_seconds)
      && j.state === 'running'
      && (j.sends_done ?? 0) > 0,
  );
  // When any row shows a telegram, every status row reserves the same
  // date/time/jump and event-type tracks so those values line up.
  const showEventCols = rows.some(r => {
    const addr = r.address.trim();
    const last = GA_RE.test(addr) ? lastValues[addr] : undefined;
    return visibleStatusTelegram(r, jobsByRowId[r.id] ?? null, last) != null;
  });
  const showActionCol = anyJobActive || rows.some(r => rowHasStatusChrome(r, jobsByRowId[r.id]));
  // Action track width follows panel content: Cancel-wide only while some row
  // actually shows Cancel; otherwise Clear-icon narrow.
  const anyCancelAction = anyJobActive;
  const actionWidth = anyCancelAction ? STATUS_ACTION_WIDTH : STATUS_CLEAR_WIDTH;
  // Header Cancel only when more than one row shows a job Cancel.
  const cancelRowCount = rows.filter(r => isLiveJob(jobsByRowId[r.id])).length;
  const showCancelAll = cancelRowCount > 1;

  const showValueCol = rows.some(r => needsValueColumn(r.dpt || null, parseDptMain(r.dpt)));
  const midTemplateColumns = useMemo(
    () => midTracksTemplate(colTracks, showValueCol),
    [colTracks, showValueCol],
  );
  const rightTemplateColumns = useMemo(() => rightTracksTemplate(colTracks), [colTracks]);
  const leftWidth = useMemo(() => leftColWidth(colTracks), [colTracks]);
  const rightWidth = useMemo(() => rightPaneWidth(colTracks), [colTracks]);
  const paneTemplateColumns = useMemo(
    () => `${leftWidth} minmax(0, 1fr) ${rightWidth}`,
    [leftWidth, rightWidth],
  );
  const midMaxScroll = Math.max(0, midContentWidth - midViewportWidth);

  const appliedPanelHeight = useMemo(
    () => resolvePanelHeight(panelHeightPx, heightBounds),
    [panelHeightPx, heightBounds],
  );

  const clampMidScroll = useCallback((next: number) => {
    const max = Math.max(0, midContentWidth - midViewportWidth);
    return Math.min(max, Math.max(0, next));
  }, [midContentWidth, midViewportWidth]);

  const onMidBarScroll = useCallback((e: ReactUIEvent<HTMLDivElement>) => {
    midScrollLeftRef.current = e.currentTarget.scrollLeft;
    setMidScrollLeft(e.currentTarget.scrollLeft);
  }, []);

  // Derive a clamped offset so content-width changes never need a setState-in-effect.
  const midScrollLeftApplied = clampMidScroll(midScrollLeft);

  // Keep the under-mid scrollbar thumb in sync when wheel/programmatic scroll moves.
  useLayoutEffect(() => {
    midScrollLeftRef.current = midScrollLeftApplied;
    const bar = midBarRef.current;
    if (bar && Math.abs(bar.scrollLeft - midScrollLeftApplied) > 0.5) {
      bar.scrollLeft = midScrollLeftApplied;
    }
  }, [midScrollLeftApplied]);

  // Non-passive wheel on mid clips so shift/trackpad horizontal scroll can preventDefault.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const onWheel = (e: WheelEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest?.('.wtb-mid-clip')) return;
      const horiz = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
      if (!horiz) return;
      const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
      if (dx === 0) return;
      e.preventDefault();
      setMidScrollLeft(prev => {
        const next = clampMidScroll(prev + dx);
        midScrollLeftRef.current = next;
        return next;
      });
    };
    grid.addEventListener('wheel', onWheel, { passive: false });
    return () => grid.removeEventListener('wheel', onWheel);
  }, [clampMidScroll, bodyEpoch, rows.length]);

  // Measure column tracks + height bounds. Content changes grow tracks only;
  // a host-width change, a DPT change, or a remount fully reoptimizes.
  useLayoutEffect(() => {
    const headerGrid = headerGridRef.current;
    const grid = gridRef.current;
    const host = hostRef.current;
    const hScroll = hScrollRef.current;
    const scroll = scrollRef.current;
    // Header row is omitted for a single send row; measurement still runs.
    if (!grid || !host || !hScroll || !scroll) return;

    const dptSig = rows.map(r => `${r.id}\0${r.dpt}`).join('\n');
    const dptChanged = dptSigRef.current !== null && dptSigRef.current !== dptSig;
    dptSigRef.current = dptSig;

    const measureCols = (allowShrink: boolean) => {
      const next = Array.from({ length: WTB_COLS }, () => 0);
      for (let col = 0; col < WTB_COLS; col++) {
        host.querySelectorAll(`[data-wtb-col="${col}"]`).forEach(node => {
          next[col] = Math.max(next[col], measureColumnCell(node as HTMLElement, col));
        });
      }
      for (const c of WTB_BUFFER_COLS) next[c] += WTB_INPUT_BUFFER_PX;
      // Error text is ellipsized / zeroed in measureStatusShell so it never grows
      // the track — but once a width is established, do not shrink status while
      // any row still shows an error (host reoptimize / remount).
      const statusHasError = Boolean(host.querySelector('[data-status-error]'));
      setColTracks(prev => {
        const merged = mergeColTracks(prev, next, {
          allowShrink,
          noShrinkCols: statusHasError ? [WTB_STATUS_COL] : undefined,
        });
        return sameTracks(prev, merged) ? prev : merged;
      });
    };

    const measureMidScroll = () => {
      const clip = midClipRef.current;
      const inner = midInnerRef.current;
      const view = clip ? clip.clientWidth : null;
      const content = inner ? Math.ceil(inner.scrollWidth) : null;
      if (view != null) {
        const prev = prevMidViewportRef.current;
        // First measure stays left-aligned. A later shrink shifts left only
        // when the scrollbar appears or the thumb is already at the right stop.
        if (prev != null && content != null && view !== prev) {
          const next = scrollLeftOnViewportResize(
            midScrollLeftRef.current,
            prev,
            view,
            content,
          );
          if (next !== midScrollLeftRef.current) {
            midScrollLeftRef.current = next;
            setMidScrollLeft(next);
          }
        }
        prevMidViewportRef.current = view;
        setMidViewportWidth(view);
      }
      if (content != null) setMidContentWidth(content);
    };

    const measureHeightBounds = () => {
      const addrCells = grid.querySelectorAll('[data-wtb-col="0"]');
      if (addrCells.length === 0) return;
      const first = addrCells[0] as HTMLElement;
      // Status (and mid) can be taller than GA — measure full first-row panes / grid
      // scrollHeight so the last row's status border is not clipped by the scrollport.
      const panes = Array.from(grid.children) as HTMLElement[];
      const firstRowPanes = panes.slice(0, 3);
      const oneRowH = addrCells.length > 1
        ? Math.max(1, (addrCells[1] as HTMLElement).offsetTop - first.offsetTop)
        : Math.max(1, ...firstRowPanes.map(c => c.offsetHeight));
      const rowsH = Math.max(oneRowH, grid.scrollHeight);
      // Header wrapper includes title + actions and the gap under the header row.
      const headerWrap = headerGrid?.parentElement as HTMLElement | null;
      const headerBlockH = headerWrap?.offsetHeight ?? headerGrid?.offsetHeight ?? 0;
      const hCs = getComputedStyle(hScroll);
      const padTop = parseFloat(hCs.paddingTop) || 0;
      // Gap below the V-scrollport (not inside it) + mid H-scrollbar gutter + resize handle.
      const belowRowsGap = parseFloat(getComputedStyle(scroll).marginBottom) || 0;
      const chrome = padTop + headerBlockH + belowRowsGap + SCROLLBAR_GUTTER_PX + HEIGHT_HANDLE_PX;
      // The host border sits inside the border-box, under the resize handle.
      // The first row still clears without that pixel, so the drag floor is one shorter.
      const min = Math.ceil(chrome + oneRowH) - 1;
      const max = Math.ceil(chrome + rowsH);
      const prevMax = heightMaxRef.current;
      heightMaxRef.current = max;
      setHeightBounds(prev => (prev.min === min && prev.max === max ? prev : { min, max }));
      setPanelHeightPx(h => {
        if (h == null) return null;
        if (shouldAutoGrowPanelHeight({
          height: h,
          prevMax,
          nextMax: max,
          rowCount: addrCells.length,
          dragging: heightDraggingRef.current,
        })) {
          setPref(HEIGHT_PREF_KEY, String(max));
          return max;
        }
        const clamped = clampPanelHeight(h, min, max);
        return clamped === h ? h : clamped;
      });
    };

    const measureContent = () => {
      measureCols(false);
      measureMidScroll();
      measureHeightBounds();
    };

    // DPT edits swap the write widget and the designation width. Reoptimize
    // once here; later content observation stays grow-only so typing does not
    // shrink a track mid-edit.
    measureCols(dptChanged);
    measureMidScroll();
    measureHeightBounds();
    if (typeof ResizeObserver === 'undefined') return;

    hostWidthRef.current = host.clientWidth;

    const contentRo = new ResizeObserver(() => measureContent());
    if (headerGrid) contentRo.observe(headerGrid);
    contentRo.observe(grid);
    const midClip = midClipRef.current;
    const midInner = midInnerRef.current;
    if (midClip) contentRo.observe(midClip);
    if (midInner) contentRo.observe(midInner);
    host.querySelectorAll('[data-wtb-col]').forEach(el => contentRo.observe(el));

    // Observe the outer host — not the scrollport — so a vertical scrollbar
    // inside the scrollport cannot look like a width change / reoptimize.
    const widthRo = new ResizeObserver(() => {
      const w = host.clientWidth;
      if (hostWidthRef.current === w) return;
      hostWidthRef.current = w;
      measureCols(true);
      measureMidScroll();
      measureHeightBounds();
    });
    widthRo.observe(host);

    return () => {
      contentRo.disconnect();
      widthRo.disconnect();
    };
  }, [
    rows, bodyEpoch, lastValues, dptOptions, anyJobActive, jobsByRowId,
    showCountdownCol, showSendCountCol, showActionCol, anyCancelAction, actionWidth,
    showValueCol,
  ]);

  const onHeightResizeStart = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = hostRef.current?.getBoundingClientRect().height
      ?? appliedPanelHeight
      ?? heightBounds.max
      ?? 0;
    let latest = startH;
    const onMove = (ev: MouseEvent) => {
      latest = clampPanelHeight(
        startH + (ev.clientY - startY),
        heightBounds.min,
        heightBounds.max,
      );
      setPanelHeightPx(latest);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setHeightDragging(false);
      if (latest !== startH) setPref(HEIGHT_PREF_KEY, String(latest));
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
    setHeightDragging(true);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [appliedPanelHeight, heightBounds.min, heightBounds.max]);

  const onHeightResizeReset = useCallback(() => {
    setPanelHeightPx(null);
    setPref(HEIGHT_PREF_KEY, '');
  }, []);

  // Pick up already-active jobs (e.g. after a page reload) and clean up the poller.
  useEffect(() => {
    void refreshJobs();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveRows(rows);
  }, [rows]);

  useEffect(() => {
    if (!flashRowId) return;
    const t = window.setTimeout(() => setFlashRowId(null), ROW_OUTLINE_FLASH_MS);
    return () => window.clearTimeout(t);
  }, [flashRowId, flashNonce]);

  // Keep the telegram-table send-icon blue state in sync with the top row.
  useEffect(() => {
    onTopRowHintChange?.(topRowHintFromRow(rows[0]));
  }, [rows, onTopRowHintChange]);

  useEffect(() => () => {
    onTopRowHintChange?.(null);
  }, [onTopRowHintChange]);

  // Every panel GA lights the matching TT send icon (panel open/closed irrelevant).
  useEffect(() => {
    onPanelAddressesChange?.(panelAddressesFromRows(rows));
  }, [rows, onPanelAddressesChange]);

  useEffect(() => () => {
    onPanelAddressesChange?.([]);
  }, [onPanelAddressesChange]);

  const updateRow = (id: string, patch: Partial<Row>) =>
    setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));

  /**
   * Detach this row from any scheduled job in local state. Returns the prior
   * job so the caller can cancel it on the server without deferring the UI
   * update behind an `await` (tests and clicks expect sync row changes).
   */
  const detachRowJob = (id: string): ScheduledSendStatus | undefined => {
    const owned = jobsByRowIdRef.current[id];
    setJobsByRowId(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    return owned;
  };

  const cancelDetachedJob = async (rowId: string, owned: ScheduledSendStatus | undefined) => {
    if (!owned) return;
    // Optimistic pending-* has no server UUID yet — cancel when startScheduled returns.
    if (isPendingJobId(owned.id)) {
      cancelWhenStartedRef.current.add(rowId);
      return;
    }
    if (isLiveJob(owned) && owned.id) {
      await cancelScheduledSend(owned.id).catch(() => {});
      await refreshJobs();
    }
  };

  /**
   * Status error owns the row. Drop its live job (countdown and Cancel) and
   * keep the message — do not restore a successful Write over it.
   */
  const failRow = (rowId: string, msg: string) => {
    const owned = jobsByRowIdRef.current[rowId];
    setJobsByRowId(prev => {
      if (!(rowId in prev)) return prev;
      const next = { ...prev };
      delete next[rowId];
      if (!Object.values(next).some(isLiveJob)) watchingRef.current = false;
      return next;
    });
    updateRow(rowId, {
      feedback: { ok: false, msg },
      statusWatch: null,
      statusTelegram: null,
      readBaseline: null,
      scheduledJobId: null,
    });
    void cancelDetachedJob(rowId, owned);
  };

  const addRowAfter = (id: string, opts?: { copy?: boolean }) => {
    setRows(rs => {
      const index = rs.findIndex(r => r.id === id);
      const source = index >= 0 ? rs[index] : undefined;
      // Ctrl/cmd-click duplicates field values without status or a live job.
      const next = opts?.copy && source
        ? {
            ...newRow(),
            address: source.address,
            name: source.name,
            dpt: source.dpt,
            value: source.value,
            delay: source.delay,
            every: source.every,
            respond: source.respond,
          }
        : newRow();
      if (index < 0) return [...rs, next];
      return [...rs.slice(0, index + 1), next, ...rs.slice(index + 1)];
    });
  };

  /** Insert a blank row at the top (header Plus). */
  const addRowAtTop = () => {
    setRows(rs => [newRow(), ...rs]);
  };

  const resetRow = (id: string) => {
    // A live job owns the row fields. Reset stays blocked; delete cancels the job.
    if (isLiveJob(jobsByRowIdRef.current[id])) return;
    const owned = detachRowJob(id);
    setRows(rs => rs.map(r => (r.id === id ? { ...newRow(), id: r.id } : r)));
    void cancelDetachedJob(id, owned);
  };

  const removeRow = (id: string) => {
    // Removing the row that owns a running timer must cancel it, so we don't
    // leave an untracked cyclic send firing (TabSel, forum post #130).
    const owned = detachRowJob(id);
    setRows(rs => (rs.length > 1 ? rs.filter(r => r.id !== id) : rs));
    void cancelDetachedJob(id, owned);
  };

  const rememberGa = (address: string) => {
    const trimmed = address.trim();
    if (!trimmed) return;
    setRecentGas(pushRecentGa(trimmed));
  };

  // Ctrl-click from TT: only when the panel has exactly one row.
  // Then: clear matching top, fill empty top, otherwise insert + flash + focus.
  useEffect(() => {
    if (!ctrlSendRequest) return;
    if (rowsRef.current.length !== 1) {
      onCtrlSendHandled?.();
      return;
    }
    const { address, name, dptMain, dptSub } = ctrlSendRequest;
    const trimmed = address.trim();
    const top = rowsRef.current[0];
    const expectedDpt = expectedPanelDpt(dptMain, dptSub);
    const matches = Boolean(
      top
      && top.address.trim() === trimmed
      && top.dpt.trim() === expectedDpt
      && !top.delay.trim()
      && !top.every.trim(),
    );
    const known = byAddress.get(trimmed);
    const resolved = {
      address: trimmed,
      name: (known?.name ?? name ?? '').toString(),
      dpt: known && known.main != null ? formatDpt(known.main, known.sub) : expectedDpt,
    };
    if (top && isLiveJob(jobsByRowIdRef.current[top.id]) && (matches || !top.address.trim())) {
      onCtrlSendHandled?.();
      return;
    }
    if (matches && top) {
      resetRow(top.id);
    } else if (top && !top.address.trim()) {
      // Empty first row → fill in place (no extra row).
      setRows(rs => rs.map(r => (r.id === top.id ? { ...r, ...resolved, ...clearStatusPatch() } : r)));
      setFlashRowId(top.id);
      setFlashNonce(n => n + 1);
      bumpValueFocus(top.id);
      if (trimmed) rememberGa(trimmed);
    } else {
      const next: Row = { ...newRow(), ...resolved };
      setRows(rs => [next, ...rs]);
      setFlashRowId(next.id);
      setFlashNonce(n => n + 1);
      bumpValueFocus(next.id);
      if (trimmed) rememberGa(trimmed);
    }
    onCtrlSendHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drive only on request nonce
  }, [ctrlSendRequest?.nonce]);

  const writeRef = useRef<(row: Row, payload: BusPayload, response?: boolean) => Promise<void>>(async () => {});
  const readRef = useRef<(row: Row) => Promise<void>>(async () => {});
  const cancelJobRef = useRef<(rowId: string) => Promise<void>>(async () => {});

  // Popover correspondence: ensure / cancel / write via panel rows.
  useEffect(() => {
    if (!sendPanelCommand) return;
    const cmd = sendPanelCommand;
    const finish = (result: Omit<SendPanelCommandResult, 'nonce'>) => {
      onSendPanelCommandHandled?.({ nonce: cmd.nonce, ...result });
    };

    if (cmd.type === 'ensureRow') {
      const key = cmd.key;
      const rowsNow = rowsRef.current;
      const matched = rowsNow.find(r => rowsEqualForCorrespondence({
        address: r.address.trim(),
        dpt: r.dpt.trim(),
        value: r.value,
        delay: sanitizeSecondsInput(r.delay),
        every: sanitizeSecondsInput(r.every),
      }, key));
      if (matched) {
        finish({ rowId: matched.id, created: false, matched: true });
        return;
      }
      const known = byAddress.get(key.address);
      const next: Row = {
        ...newRow(),
        address: key.address,
        name: (known?.name ?? cmd.name ?? '').toString(),
        dpt: key.dpt || (known && known.main != null ? formatDpt(known.main, known.sub) : ''),
        value: key.value,
        delay: key.delay,
        every: key.every,
      };
      setRows(rs => [...rs, next]);
      if (key.address) rememberGa(key.address);
      finish({ rowId: next.id, created: true, matched: false });
      return;
    }

    if (cmd.type === 'cancelRow') {
      void cancelJobRef.current(cmd.rowId).finally(() => {
        finish({ rowId: cmd.rowId, created: false, matched: true });
      });
      return;
    }

    if (cmd.type === 'writeViaRow') {
      const row = rowsRef.current.find(r => r.id === cmd.rowId);
      if (!row) {
        finish({ rowId: null, created: false, matched: false });
        return;
      }
      // Apply draft fields already ensured; write uses current row delay/every.
      void writeRef.current(row, cmd.payload, Boolean(cmd.response)).finally(() => {
        finish({ rowId: row.id, created: false, matched: true });
      });
      return;
    }

    if (cmd.type === 'readViaRow') {
      const row = rowsRef.current.find(r => r.id === cmd.rowId);
      if (!row) {
        finish({ rowId: null, created: false, matched: false });
        return;
      }
      void readRef.current(row).finally(() => {
        finish({ rowId: row.id, created: false, matched: true });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drive only on command nonce
  }, [sendPanelCommand?.nonce]);

  const onLinkedRowStatusesChangeRef = useRef(onLinkedRowStatusesChange);
  onLinkedRowStatusesChangeRef.current = onLinkedRowStatusesChange;
  const onGaJobStatusesChangeRef = useRef(onGaJobStatusesChange);
  onGaJobStatusesChangeRef.current = onGaJobStatusesChange;
  useEffect(() => {
    const emit = onLinkedRowStatusesChangeRef.current;
    const emitGaJobs = onGaJobStatusesChangeRef.current;
    if (!emit && !emitGaJobs) return;
    const statuses: Record<string, LinkedRowStatus> = {};
    const byAddress: Record<string, LinkedRowStatus> = {};
    for (const r of rows) {
      const job = jobsByRowId[r.id] ?? null;
      const live = job && (job.state === 'waiting' || job.state === 'running') ? job : null;
      const projection: LinkedRowStatus = {
        rowId: r.id,
        job: live,
        feedback: r.feedback,
        busy: r.busy,
        statusWatch: r.statusWatch,
        statusTelegram: r.statusTelegram,
        address: r.address,
        name: r.name,
        value: r.value,
        dpt: r.dpt,
      };
      statuses[r.id] = projection;
      const addr = r.address.trim();
      if (live && addr && !byAddress[addr]) byAddress[addr] = projection;
    }
    emit?.(statuses);
    emitGaJobs?.(byAddress);
  }, [rows, jobsByRowId]);

  const applyResolved = (id: string, option: FilterOption) => {
    updateRow(id, {
      address: option.address ?? '',
      name: option.name ?? '',
      ...clearStatusPatch(),
      dpt: option.main != null ? formatDpt(option.main, option.sub) : '',
    });
    if (option.address) rememberGa(option.address);
  };

  // Typing updates only the field being edited. The other field follows when
  // editing finishes: blur, Enter, or a suggestion pick (the pick passes `option`).
  const onAddressChange = (id: string, next: string, option?: FilterOption) => {
    if (option) {
      applyResolved(id, option);
      return;
    }
    const match = byAddress.get(next.trim());
    updateRow(id, {
      address: next,
      ...clearStatusPatch(),
      dpt: match && match.main != null ? formatDpt(match.main, match.sub) : '',
    });
  };

  const snapshotGaFocus = (id: string) => {
    const row = rowsRef.current.find(r => r.id === id);
    if (!row) return;
    gaFocusSnapshotRef.current.set(id, {
      address: row.address,
      name: row.name,
      dpt: row.dpt,
    });
  };

  const restoreGaFocusSnapshot = (id: string) => {
    const snap = gaFocusSnapshotRef.current.get(id);
    if (!snap) {
      updateRow(id, { address: '', name: '', dpt: '', ...clearStatusPatch() });
      return;
    }
    updateRow(id, { ...snap, ...clearStatusPatch() });
  };

  const onAddressCommit = (id: string, text: string) => {
    const trimmed = text.trim();
    // Empty GA clears the whole row (same as initialize / reset).
    if (!trimmed) {
      resetRow(id);
      return;
    }
    const match = byAddress.get(trimmed);
    if (match) {
      updateRow(id, { name: match.name ?? '' });
      rememberGa(trimmed);
      return;
    }
    // Project loaded: incomplete (not 1/2/3-level), invalid, or unknown → revert.
    // No project: keep only complete GA_RE free-entry; otherwise revert.
    const projectLoaded = byAddress.size > 0;
    if (projectLoaded || !GA_RE.test(trimmed)) {
      restoreGaFocusSnapshot(id);
      return;
    }
    updateRow(id, { name: '' });
    rememberGa(trimmed);
  };

  const onNameChange = (id: string, next: string, option?: FilterOption) => {
    if (option) {
      applyResolved(id, option);
      return;
    }
    updateRow(id, { name: next, ...clearStatusPatch() });
  };

  const snapshotNameFocus = (id: string) => {
    const row = rowsRef.current.find(r => r.id === id);
    if (!row) return;
    nameFocusSnapshotRef.current.set(id, row.name);
  };

  const onNameCommit = (id: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      updateRow(id, { name: '' });
      return;
    }
    const match = resolveName(trimmed, targets);
    if (match === 'ambiguous') {
      updateRow(id, { name: text });
      return;
    }
    if (match) {
      applyResolved(id, match);
      return;
    }
    // Unknown name → restore the pre-edit name (do not keep free-entry names).
    const prev = nameFocusSnapshotRef.current.get(id) ?? '';
    updateRow(id, { name: prev, ...clearStatusPatch() });
  };

  // Editable DPT (#342): overriding the project default. When the DPT *main*
  // changes the write widget switches (On/Off ↔ pickers ↔ free value), so a
  // stale value must be cleared to avoid sending it to the new widget.
  const onDptChange = (id: string, next: string) => {
    const row = rows.find(r => r.id === id);
    const mainChanged = row && parseDptMain(row.dpt) !== parseDptMain(next);
    updateRow(id, { dpt: next, ...clearStatusPatch(), ...(mainChanged ? { value: '' } : {}) });
  };

  // Bind Status time/jump when the matching Read/Write appears on the live feed.
  const [seenLatest, setSeenLatest] = useState(latestTelegram);
  if (latestTelegram !== seenLatest) {
    setSeenLatest(latestTelegram);
    if (latestTelegram) {
      if (isReadTelegram(latestTelegram)) {
        latestReadByAddressRef.current.set(latestTelegram.target_address.trim(), latestTelegram);
      }
      const addr = latestTelegram.target_address;
      const kind = latestTelegram.simplified_type;
      setRows(rs => {
        let changed = false;
        const next = rs.map(r => {
          if (r.address.trim() !== addr) return r;
          // A live job only keeps the telegram it put on the bus.
          const job = jobsByRowId[r.id];
          if (isLiveJob(job) && job) {
            if (job.read) {
              // Only the row that sent this read adopts it. Color follows timestamps.
              if (isReadTelegram(latestTelegram) && r.claimOwnRead) {
                changed = true;
                return { ...r, statusTelegram: latestTelegram, claimOwnRead: false };
              }
              return r;
            }
            if (!telegramFromRowJob(job, latestTelegram)) return r;
            changed = true;
            return { ...r, statusTelegram: latestTelegram, lastSentTelegram: latestTelegram };
          }
          // One-shot binding is per owning row — never share send/wait across rows.
          const wantWrite = r.statusWatch === 'write';
          const wantRead = r.statusWatch === 'read';
          const isWrite = kind === 'Write' || latestTelegram.telegram_type?.includes('Write');
          const isRead = kind === 'Read' || latestTelegram.telegram_type?.includes('Read');
          const isResponse = kind === 'Response' || latestTelegram.telegram_type?.includes('Response');
          if (isWrite) {
            if (wantWrite && wantRead) {
              // Cyclic Write during an open Read wait: remember the send, keep waiting.
              changed = true;
              return { ...r, lastSentTelegram: latestTelegram };
            }
            if (wantWrite) {
              changed = true;
              return { ...r, statusTelegram: latestTelegram, lastSentTelegram: latestTelegram };
            }
            // Read wait alone: Writes never end it — only Response (or Cancel) does.
          }
          if (wantRead && isRead) {
            changed = true;
            return { ...r, statusTelegram: latestTelegram };
          }
          if (wantRead && isResponse) {
            changed = true;
            // A one-shot read ends on the first Response. A live read job
            // never reaches here: it only binds the Read it sent itself.
            return {
              ...r,
              statusTelegram: latestTelegram,
              readBaseline: null,
              statusWatch: null,
              feedback: null,
            };
          }
          return r;
        });
        return changed ? next : rs;
      });
    }
  }

  const write = async (row: Row, payload: BusPayload, response?: boolean) => {
    if (isLiveJob(jobsByRowIdRef.current[row.id])) return;
    const asResponse = response ?? row.respond;
    const delaySeconds = parseFloat(row.delay) || 0;
    const intervalSeconds = parseFloat(row.every) || 0;
    const scheduled = delaySeconds > 0 || intervalSeconds > 0;
    // Keep lastSentTelegram. The status jump stays empty until this send's own
    // telegram arrives, so a prior Read or another GA event cannot stand in for it.
    updateRow(row.id, {
      busy: true,
      feedback: null,
      readBaseline: null,
      statusWatch: null,
      statusTelegram: null,
    });
    try {
      if (scheduled) {
        if (intervalSeconds > 0 && intervalSeconds < 1) {
          failRow(row.id, 'Interval must be at least 1 second');
          return;
        }
        const nextAt = delaySeconds > 0
          ? new Date(Date.now() + delaySeconds * 1000).toISOString()
          : null;
        // Arm countdown/count before the network round-trip so Write feels instant.
        watchingRef.current = true;
        updateRow(row.id, { scheduledJobId: null });
        const optimistic: ScheduledSendStatus = {
          state: delaySeconds > 0 ? 'waiting' : 'running',
          id: `pending-${row.id}`,
          address: row.address.trim(),
          payload,
          response: asResponse,
          delay_seconds: delaySeconds > 0 ? delaySeconds : undefined,
          interval_seconds: intervalSeconds > 0 ? intervalSeconds : null,
          sends_done: 0,
          next_send_at: nextAt,
        };
        jobsByRowIdRef.current = { ...jobsByRowIdRef.current, [row.id]: optimistic };
        setJobsByRowId(prev => ({ ...prev, [row.id]: optimistic }));
        const started = await startScheduled(row, payload, delaySeconds, intervalSeconds, nextAt, false, asResponse);
        if (started) updateRow(row.id, { statusWatch: 'write' });
      } else {
        await sendTelegram(row.address.trim(), payload, row.dpt.trim() || undefined, asResponse);
        const shown = describeBusPayload(payload, row.dpt) || row.value || '(raw)';
        updateRow(row.id, {
          feedback: { ok: true, msg: `${asResponse ? 'Response' : 'Sent'} ${shown} to ${row.address.trim()}` },
          statusWatch: 'write',
          statusTelegram: null,
        });
      }
      rememberGa(row.address);
    } catch (err) {
      failRow(row.id, err instanceof Error ? err.message : 'Request failed');
    } finally {
      updateRow(row.id, { busy: false });
    }
  };

  const read = async (row: Row) => {
    if (isLiveJob(jobsByRowIdRef.current[row.id])) return;
    const delaySeconds = parseFloat(row.delay) || 0;
    const intervalSeconds = parseFloat(row.every) || 0;
    const scheduled = delaySeconds > 0 || intervalSeconds > 0;
    // Arm statusWatch before the API returns so a fast bus Read still binds.
    updateRow(row.id, {
      busy: true,
      feedback: null,
      readBaseline: lastValues[row.address.trim()]?.timestamp ?? '',
      statusWatch: 'read',
      statusTelegram: null,
      claimOwnRead: true,
    });
    try {
      if (scheduled) {
        if (intervalSeconds > 0 && intervalSeconds < 1) {
          failRow(row.id, 'Interval must be at least 1 second');
          return;
        }
        const nextAt = delaySeconds > 0
          ? new Date(Date.now() + delaySeconds * 1000).toISOString()
          : null;
        watchingRef.current = true;
        updateRow(row.id, { scheduledJobId: null });
        const optimistic: ScheduledSendStatus = {
          state: delaySeconds > 0 ? 'waiting' : 'running',
          id: `pending-${row.id}`,
          address: row.address.trim(),
          read: true,
          delay_seconds: delaySeconds > 0 ? delaySeconds : undefined,
          interval_seconds: intervalSeconds > 0 ? intervalSeconds : null,
          sends_done: 0,
          next_send_at: nextAt,
        };
        jobsByRowIdRef.current = { ...jobsByRowIdRef.current, [row.id]: optimistic };
        setJobsByRowId(prev => ({ ...prev, [row.id]: optimistic }));
        const started = await startScheduled(row, null, delaySeconds, intervalSeconds, nextAt, true);
        if (!started) updateRow(row.id, { statusWatch: null, readBaseline: null });
      } else {
        await readTelegram(row.address.trim());
        updateRow(row.id, {
          feedback: { ok: true, msg: `Read request sent to ${row.address.trim()}` },
        });
      }
      rememberGa(row.address);
    } catch (err) {
      failRow(row.id, err instanceof Error ? err.message : 'Request failed');
    } finally {
      updateRow(row.id, { busy: false });
    }
  };
  writeRef.current = write;
  readRef.current = read;
  // cancelJob is a nested function declaration (hoisted) below the return.
  cancelJobRef.current = cancelJob;

  return (
    <div
      ref={hostRef}
      className={`wtb-panel-host${embedded ? ' wtb-embedded' : ''}`}
      style={{
        position: 'relative',
        flexShrink: embedded ? 1 : 0,
        flex: embedded ? 1 : undefined,
        minHeight: embedded ? 0 : undefined,
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        height: embedded
          ? '100%'
          : appliedPanelHeight != null ? `${appliedPanelHeight}px` : undefined,
        /* Match monitor header / workspace tabpanel (opaque panel over bg-dark). */
        background: 'linear-gradient(var(--bg-panel), var(--bg-panel)), var(--bg-dark)',
        borderBottom: embedded ? undefined : '1px solid var(--border-color)',
      }}
    >
      {/* H-scroll wraps header + rows so columns stay aligned; only rows V-scroll.
          No right padding — the V-scrollbar sits on the panel's right edge. */}
      <div
        ref={hScrollRef}
        className="wtb-h-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflowX: 'hidden',
          overflowY: 'hidden',
          padding: '0.45rem 0 0 0.85rem',
          boxSizing: 'border-box',
          // Mid-pane horizontal offset (name … value).
          ['--wtb-mid-x' as string]: `-${midScrollLeftApplied}px`,
        }}
      >
        <div
          className="wtb-h-content"
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            width: '100%',
          }}
        >
        <div
          style={{
            display: 'flex',
            flexShrink: 0,
            alignItems: 'center',
            paddingBottom: '0.35rem',
            width: '100%',
            minWidth: 0,
          }}
        >
          <div
            ref={headerGridRef}
            className="wtb-header-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: paneTemplateColumns,
              columnGap: WTB_COL_GAP,
              alignItems: 'center',
              flex: 1,
              minWidth: 0,
              whiteSpace: 'nowrap',
            }}
          >
            <div
              className="wtb-panel-title"
              style={{ gridColumn: '1 / 3', minWidth: 0 }}
            >
              <Send size={16} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} aria-hidden />
              Write to bus
            </div>
            <div
              style={{
                gridColumn: 3,
                display: 'grid',
                gridTemplateColumns: rightTemplateColumns,
                columnGap: WTB_COL_GAP,
                alignItems: 'center',
                minWidth: 0,
              }}
            >
              <div aria-hidden />
              <div aria-hidden />
              <div data-wtb-col="10" style={{ minWidth: 0, display: 'flex', justifyContent: 'flex-end' }}>
                {/* Always mounted so show/hide never reflows status / header tracks. */}
                <button
                  type="button"
                  onClick={() => { void cancelAllRows(); }}
                  title={showCancelAll ? 'Cancel all jobs' : undefined}
                  aria-label="Cancel all"
                  aria-hidden={showCancelAll ? undefined : true}
                  tabIndex={showCancelAll ? undefined : -1}
                  style={{
                    ...secondaryBtn(false),
                    visibility: showCancelAll ? 'visible' : 'hidden',
                    pointerEvents: showCancelAll ? 'auto' : 'none',
                  }}
                >
                  Cancel
                </button>
              </div>
              <button
                type="button"
                className="icon-button"
                data-wtb-col="11"
                onClick={() => { void resetPanel(); }}
                title="Reset panel · cancel all jobs and clear rows"
                aria-label="Reset panel"
                style={{
                  color: 'var(--text-dim)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  padding: '0.2rem',
                  display: 'flex',
                }}
              >
                <RotateCcw size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                data-wtb-col="12"
                onClick={addRowAtTop}
                title="Add a blank row at the top"
                aria-label="Add row at top"
                style={{
                  color: 'var(--text-dim)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  padding: 0,
                  boxSizing: 'border-box',
                }}
              >
                <Plus size={15} strokeWidth={2.5} />
              </button>
            </div>
          </div>
          {/* Match body content inset + V-scrollbar gutter so header/body columns align. */}
          <span aria-hidden style={{ flexShrink: 0, width: '0.85rem' }} />
          <span aria-hidden style={{ flexShrink: 0, width: SCROLLBAR_GUTTER_PX }} />
        </div>
        <div
          ref={scrollRef}
          className="wtb-scrollport"
          style={{
            flex: 1,
            minHeight: 0,
            overflowX: 'hidden',
            overflowY: 'auto',
            scrollbarGutter: 'stable',
            boxSizing: 'border-box',
            // Space under the grid, outside the scrolling content.
            marginBottom: '0.45rem',
          }}
        >
      <div
        key={bodyEpoch}
        ref={gridRef}
        className="wtb-rows-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: paneTemplateColumns,
          columnGap: WTB_COL_GAP,
          rowGap: '0.35rem',
          alignItems: 'center',
          width: '100%',
          minWidth: 0,
          whiteSpace: 'nowrap',
          paddingRight: '0.85rem',
          boxSizing: 'border-box',
        }}
      >
        {rows.map((row, rowIndex) => {
          const known = byAddress.get(row.address.trim());
          // The write widget follows the row's *effective* (possibly overridden)
          // DPT, not the project default (#342).
          const dptMain = parseDptMain(row.dpt);
          const projectDpt = known && known.main != null ? formatDpt(known.main, known.sub) : '';
          const overridden = projectDpt !== '' && row.dpt.trim() !== projectDpt;
          const addressValid = GA_RE.test(row.address.trim());
          const lastTelegram = addressValid ? lastValues[row.address.trim()] : undefined;
          const scheduledDisabled = row.busy || !addressValid;
          const rowJob = jobsByRowId[row.id] ?? null;
          const showJob = isLiveJob(rowJob);
          const statusTelegram = visibleStatusTelegram(row, showJob ? rowJob : null, lastTelegram);
          // When the project names a DPT main, the hint stays within that main —
          // telegram length is fixed (5.001 → 5.010 ok, not 9.001). With no
          // project DPT the user may pick any known type.
          const allowedDpts = known?.main == null
            ? dptOptions
            : dptOptions.filter(o => Number(o.key.split('.')[0]) === known.main);
          const delayPlaceholder = 'delay';
          const everyPlaceholder = 'every';
          const gridRow = rowIndex + 1;
          const rowFlashing = flashRowId === row.id;
          // Keep the first send row pinned while the rest of the grid scrolls.
          const stickyFirst: CSSProperties | undefined = rowIndex === 0
            ? {
                position: 'sticky',
                top: 0,
                zIndex: 5,
                background: 'linear-gradient(var(--bg-panel), var(--bg-panel)), var(--bg-dark)',
              }
            : undefined;
          return (
            <WriteControls
              key={row.id}
              dptMain={dptMain}
              dptKey={row.dpt || null}
              address={row.address || null}
              value={row.value}
              onValueChange={v => updateRow(row.id, { value: v })}
              onWrite={payload => void write(row, payload)}
              onError={msg => failRow(row.id, msg)}
              disabled={scheduledDisabled || showJob}
              sendLocked={showJob}
              activeJob={showJob ? rowJob : null}
              unit={
                (row.dpt.trim()
                  ? dptUnit(row.dpt.trim(), dptOptions.find(o => o.key === row.dpt.trim())?.name || null)
                  : '')
                || lastTelegram?.unit
                || ''
              }
              valueColProps={{ 'data-wtb-col': '7', style: { width: '100%', minWidth: 0, overflow: 'hidden' } }}
              sendColProps={{ 'data-wtb-col': '8' }}
              reserveValueSlot={showValueCol}
              focusToken={focusRowId === row.id ? focusToken : null}
              layout={(valueSlot, sendSlot) => (
            <>
              <div
                data-wtb-row-id={row.id}
                aria-hidden
                className={rowFlashing ? ROW_OUTLINE_FLASH_CLASS : undefined}
                // Remount the flash overlay so the animation restarts on nonce bump.
                key={rowFlashing ? `flash-${row.id}-${flashNonce}` : `flash-${row.id}`}
                style={{
                  gridColumn: '1 / -1',
                  gridRow,
                  pointerEvents: 'none',
                  position: stickyFirst ? 'sticky' : 'relative',
                  top: stickyFirst ? 0 : undefined,
                  zIndex: stickyFirst ? 6 : 4,
                  alignSelf: 'stretch',
                }}
              />
              <div
                data-wtb-col="0"
                data-wtb-row-id={row.id}
                style={{ gridColumn: 1, gridRow, width: '100%', minWidth: 0, ...stickyFirst }}
              >
                <GaCombobox
                  value={row.address}
                  onChange={(next, option) => onAddressChange(row.id, next, option)}
                  onCommit={text => onAddressCommit(row.id, text)}
                  onFocus={() => snapshotGaFocus(row.id)}
                  options={targets}
                  recentAddresses={recentGas}
                  placeholder="GA"
                  width="100%"
                  disabled={showJob}
                  title={showJob ? 'Group address (locked while this job is running)' : undefined}
                />
              </div>
              <div
                ref={rowIndex === 0 ? midClipRef : undefined}
                className="wtb-mid-clip"
                data-wtb-row-id={row.id}
                style={{ gridColumn: 2, gridRow, minWidth: 0, overflow: 'hidden', ...stickyFirst }}
              >
                <div
                  ref={rowIndex === 0 ? midInnerRef : undefined}
                  className="wtb-mid-inner"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: midTemplateColumns,
                    columnGap: WTB_COL_GAP,
                    alignItems: 'center',
                    width: 'max-content',
                    minWidth: '100%',
                  }}
                >
                  <div data-wtb-col="1" style={{ minWidth: 0, width: '100%' }}>
                    <GaCombobox
                      display="name"
                      value={row.name}
                      onChange={(next, option) => onNameChange(row.id, next, option)}
                      onCommit={text => onNameCommit(row.id, text)}
                      onFocus={() => snapshotNameFocus(row.id)}
                      options={targets}
                      recentAddresses={recentGas}
                      placeholder="Group name"
                      width="100%"
                      disabled={showJob}
                      title={showJob ? 'Group name (locked while this job is running)' : undefined}
                    />
                  </div>
                  <div data-wtb-col="2">
                    {addressValid ? (
                      <LastValue telegram={lastTelegram} dpt={row.dpt} />
                    ) : (
                      <span aria-hidden style={{ display: 'inline-block', height: 18 }} />
                    )}
                  </div>
                  <div data-wtb-col="3" style={{ minWidth: 0, width: '100%', overflow: 'hidden' }}>
                    <EventCell
                      telegram={addressValid ? lastTelegram : undefined}
                      canJump={Boolean(lastTelegram)}
                      onJump={() => lastTelegram && onGotoTelegram?.(lastTelegram)}
                    />
                  </div>
                  <SecondsField
                    col="4"
                    placeholder={delayPlaceholder}
                    value={row.delay}
                    onChange={v => updateRow(row.id, { delay: v })}
                    title={
                      !addressValid
                        ? 'Enter a group address first'
                        : showJob
                          ? 'delay (locked while this job is running)'
                          : 'delay'
                    }
                    disabled={showJob || !addressValid}
                  />
                  <SecondsField
                    col="5"
                    placeholder={everyPlaceholder}
                    value={row.every}
                    onChange={v => updateRow(row.id, { every: v })}
                    title={
                      !addressValid
                        ? 'Enter a group address first'
                        : showJob
                          ? 'every (locked while this job is running)'
                          : 'every'
                    }
                    disabled={showJob || !addressValid}
                  />
                  <div data-wtb-col="6" style={{ width: '100%', minWidth: 0, overflow: 'hidden' }}>
                    <DptField
                      value={row.dpt}
                      options={allowedDpts}
                      disabled={!addressValid || showJob}
                      overridden={overridden}
                      title={
                        showJob
                          ? 'Datapoint type (locked while this job is running)'
                          : !addressValid
                            ? 'Enter a group address first'
                            : overridden
                              ? `Overriding project DPT ${projectDpt}`
                              : 'Datapoint type, e.g. 5.010 (defaults to the project DPT)'
                      }
                      onChange={next => onDptChange(row.id, next)}
                      onReset={() => updateRow(row.id, { dpt: projectDpt, value: '', ...clearStatusPatch() })}
                      resetValue={projectDpt}
                      resetTitle={`Reset to project DPT ${projectDpt}`}
                    />
                  </div>
                  {valueSlot}
                </div>
              </div>
              <div
                data-wtb-row-id={row.id}
                style={{
                  gridColumn: 3,
                  gridRow,
                  display: 'grid',
                  gridTemplateColumns: rightTemplateColumns,
                  columnGap: WTB_COL_GAP,
                  alignItems: 'center',
                  minWidth: 0,
                  ...stickyFirst,
                }}
              >
                {sendSlot}
                <RetainFocusReadButton
                  data-wtb-col="9"
                  address={row.address}
                  muted={showJob && !rowJob?.read}
                  respond={row.respond}
                  disabled={row.busy || !addressValid || showJob}
                  onToggle={() => updateRow(row.id, { respond: !row.respond })}
                  onRead={() => {
                    if (row.respond) return;
                    void read(row);
                  }}
                  title={
                    showJob
                      ? `${row.respond ? 'Response' : 'Read'} (locked while this job is running)`
                      : row.respond
                        ? 'Write buttons send a GroupValueResponse · ctrl/cmd-click to switch to Read'
                        : "Send a GroupValueRead; the response shows up as this row's last value · ctrl/cmd-click so Write buttons send a Response"
                  }
                />
                <div data-wtb-col="10" style={{ minWidth: 0 }}>
                  <SendJobStatusField
                    feedback={row.feedback}
                    job={showJob ? rowJob : null}
                    showCountdownCol={showCountdownCol}
                    showSendCountCol={showSendCountCol}
                    showEventCols={showEventCols}
                    showActionCol={showActionCol}
                    actionWidth={actionWidth}
                    statusTelegram={statusTelegram}
                    address={row.address}
                    groupName={row.name}
                    value={row.value}
                    dpt={row.dpt}
                    onCancel={() => {
                      void cancelJob(row.id);
                    }}
                    onClear={() => {
                      updateRow(row.id, clearAllStatusPatch());
                    }}
                    onJump={() => statusTelegram && onGotoTelegram?.(statusTelegram)}
                  />
                </div>
                <button
                  data-wtb-col="11"
                  className="icon-button"
                  onClick={() => {
                    if (rows.length === 1) return;
                    removeRow(row.id);
                  }}
                  aria-disabled={rows.length === 1 ? true : undefined}
                  title={
                    rows.length === 1
                      ? 'At least one row is required'
                      : showJob
                        ? 'Delete this row and cancel its job'
                        : 'Delete this row'
                  }
                  style={{
                    color: rows.length === 1
                      ? 'color-mix(in srgb, var(--text-dim) 40%, transparent)'
                      : 'var(--text-dim)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 22,
                    height: 22,
                    padding: 0,
                    boxSizing: 'border-box',
                  }}
                >
                  {/* Slightly heavier stroke: Minus is a single bar and reads smaller than Plus at the same box size. */}
                  <Minus size={15} strokeWidth={2.5} />
                </button>
                <button
                  data-wtb-col="12"
                  className="icon-button"
                  onClick={(e: ReactMouseEvent<HTMLButtonElement>) =>
                    addRowAfter(row.id, { copy: e.ctrlKey || e.metaKey })
                  }
                  title="Add a row below · ctrl/cmd-click to duplicate"
                  style={{
                    color: 'var(--text-dim)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 22,
                    height: 22,
                    padding: 0,
                    boxSizing: 'border-box',
                  }}
                >
                  <Plus size={15} strokeWidth={2.5} />
                </button>
              </div>
            </>
              )}
            />
          );
        })}
      </div>
        </div>
        {/* H-scrollbar only under the mid pane (name … value). */}
        <div
          style={{
            display: 'flex',
            flexShrink: 0,
            width: '100%',
            minWidth: 0,
            alignItems: 'stretch',
          }}
        >
          <div
            className="wtb-mid-h-bar-row"
            style={{
              display: 'grid',
              gridTemplateColumns: paneTemplateColumns,
              columnGap: WTB_COL_GAP,
              flex: 1,
              minWidth: 0,
            }}
          >
            <div aria-hidden />
            <div
              ref={midBarRef}
              className="wtb-mid-h-scroll"
              onScroll={onMidBarScroll}
              style={{
                overflowX: 'auto',
                overflowY: 'hidden',
                minWidth: 0,
                height: SCROLLBAR_GUTTER_PX,
                visibility: midMaxScroll > 0 ? 'visible' : 'hidden',
              }}
            >
              <div style={{ width: Math.max(midContentWidth, midViewportWidth), height: 1 }} aria-hidden />
            </div>
            <div aria-hidden />
          </div>
          <span aria-hidden style={{ flexShrink: 0, width: '0.85rem' }} />
          <span aria-hidden style={{ flexShrink: 0, width: SCROLLBAR_GUTTER_PX }} />
        </div>
        </div>
      </div>
      {/* In-flow under the H-scroll so it sits below the H-scrollbar, not over it. */}
      {!embedded && (
        <div
          className={`wtb-height-resize-handle${heightDragging ? ' dragging' : ''}`}
          onMouseDown={onHeightResizeStart}
          onDoubleClick={onHeightResizeReset}
          title="Drag to resize · double-click to reset"
        />
      )}
      <style>{`
        .wtb-h-scroll::-webkit-scrollbar,
        .wtb-scrollport::-webkit-scrollbar,
        .wtb-mid-h-scroll::-webkit-scrollbar {
          width: ${SCROLLBAR_GUTTER_PX}px;
          height: ${SCROLLBAR_GUTTER_PX}px;
        }
        .wtb-mid-clip {
          background: transparent;
        }
        .wtb-mid-inner {
          transform: translateX(var(--wtb-mid-x, 0px));
        }
        .wtb-panel-title {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          font-size: 0.82rem;
          font-weight: 600;
          color: var(--text-main);
          pointer-events: none;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .wtb-height-resize-handle {
          flex-shrink: 0;
          position: relative;
          height: ${HEIGHT_HANDLE_PX}px;
          cursor: row-resize;
          user-select: none;
        }
        .wtb-height-resize-handle::after {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 2px;
          pointer-events: none;
          background: var(--accent-primary);
          opacity: 0;
          transition: opacity 0.15s;
        }
        .wtb-height-resize-handle:hover::after,
        .wtb-height-resize-handle.dragging::after {
          opacity: 0.7;
        }
        ${ROW_OUTLINE_FLASH_CSS}
      `}</style>
    </div>
  );

  async function startScheduled(
    row: Row,
    payload: unknown,
    delaySeconds: number,
    intervalSeconds: number,
    optimisticNextAt: string | null,
    read = false,
    response = false,
  ): Promise<boolean> {
    // Caller already armed an optimistic job + validated delay/interval.
    // Poll only after the server accepts; an early idle poll would clear it.
    try {
      const status = await startScheduledSend(
        row.address.trim(),
        read ? undefined : payload,
        read ? undefined : (row.dpt.trim() || undefined),
        {
          delaySeconds: delaySeconds > 0 ? delaySeconds : undefined,
          intervalSeconds: intervalSeconds > 0 ? intervalSeconds : undefined,
          read,
          response,
        },
      );
      // Row removed/reset/cancelled while POST was in flight — drop the new server job.
      const abandoned = cancelWhenStartedRef.current.has(row.id)
        || !rowsRef.current.some(r => r.id === row.id);
      cancelWhenStartedRef.current.delete(row.id);
      if (abandoned) {
        if (status.id && !isPendingJobId(status.id)) {
          await cancelScheduledSend(status.id).catch(() => {});
        }
        setJobsByRowId(prev => {
          const next = { ...prev };
          delete next[row.id];
          if (!Object.values(next).some(isLiveJob)) watchingRef.current = false;
          return next;
        });
        return false;
      }
      // Keep the optimistic next_send_at when the server omits it — otherwise the
      // countdown vanishes and only date/time+jump remains.
      setJobsByRowId(prev => ({
        ...prev,
        [row.id]: {
          ...status,
          read: status.read ?? read,
          response: status.response ?? (read ? false : response),
          payload: status.payload !== undefined ? status.payload : (read ? undefined : payload),
          next_send_at: status.next_send_at ?? optimisticNextAt,
          delay_seconds: status.delay_seconds ?? (delaySeconds > 0 ? delaySeconds : undefined),
          interval_seconds: status.interval_seconds ?? (intervalSeconds > 0 ? intervalSeconds : null),
        },
      }));
      // Bind this row to the server UUID (not the GA) for remount / poll remap.
      updateRow(row.id, { scheduledJobId: status.id ?? null });
      startPolling();
      return true;
    } catch (err) {
      cancelWhenStartedRef.current.delete(row.id);
      setJobsByRowId(prev => {
        const next = { ...prev };
        delete next[row.id];
        if (!Object.values(next).some(isLiveJob)) watchingRef.current = false;
        return next;
      });
      updateRow(row.id, { scheduledJobId: null });
      throw err;
    }
  }

  async function refreshJobs() {
    let list: ScheduledSendStatus[];
    try {
      list = await getScheduledSendStatus();
    } catch {
      return; // transient fetch error — keep polling
    }
    const active = list.filter(isLiveJob);
    const byId = new Map(
      active.filter((j): j is ScheduledSendStatus & { id: string } => Boolean(j.id))
        .map(j => [j.id, j]),
    );

    if (active.length > 0) {
      watchingRef.current = true;
      setJobsByRowId(prev => {
        const next: Record<string, ScheduledSendStatus> = {};
        const used = new Set<string>();
        // Keep optimistic pending until POST assigns a real UUID — never claim by GA.
        for (const [rowId, job] of Object.entries(prev)) {
          if (isPendingJobId(job.id)) {
            next[rowId] = job;
            continue;
          }
          const live = job.id ? byId.get(job.id) : undefined;
          if (live) {
            next[rowId] = {
              ...live,
              payload: live.payload !== undefined ? live.payload : job.payload,
              response: live.response ?? job.response,
              read: live.read ?? job.read,
              next_send_at: live.next_send_at ?? job.next_send_at ?? null,
            };
            used.add(live.id);
          }
        }
        // Remount / cold start: reattach via persisted row.scheduledJobId only.
        for (const row of rowsRef.current) {
          if (next[row.id] || !row.scheduledJobId || used.has(row.scheduledJobId)) continue;
          const live = byId.get(row.scheduledJobId);
          if (!live) continue;
          next[row.id] = live;
          used.add(live.id);
        }
        return next;
      });
      const claimed = Object.entries(jobsByRowIdRef.current).filter(([rowId, job]) => {
        if (!job.read || isPendingJobId(job.id)) return false;
        const live = job.id ? byId.get(job.id) : undefined;
        return Boolean(live && (live.sends_done ?? 0) > (job.sends_done ?? 0) && rowId);
      }).map(([rowId]) => rowId);
      if (claimed.length > 0) {
        setRows(rs => rs.map(r => {
          if (!claimed.includes(r.id)) return r;
          const seen = latestReadByAddressRef.current.get(r.address.trim());
          const currentMs = r.statusTelegram && isReadTelegram(r.statusTelegram)
            ? Date.parse(r.statusTelegram.timestamp)
            : Number.NEGATIVE_INFINITY;
          const seenMs = seen ? Date.parse(seen.timestamp) : NaN;
          if (seen && seenMs > currentMs) {
            return { ...r, statusTelegram: seen, claimOwnRead: false };
          }
          return { ...r, claimOwnRead: true };
        }));
      }
      // Drop stale bindings when the server job is gone (and not mid-POST).
      setRows(rs => {
        let changed = false;
        const mapped = rs.map(r => {
          if (!r.scheduledJobId) return r;
          if (byId.has(r.scheduledJobId)) return r;
          const local = jobsByRowIdRef.current[r.id];
          if (local && isPendingJobId(local.id)) return r;
          changed = true;
          return { ...r, scheduledJobId: null };
        });
        return changed ? mapped : rs;
      });
      if (pollRef.current == null) startPolling();
      return;
    }
    // Keep locally armed optimistic jobs until startScheduledSend finishes.
    if (watchingRef.current && pollRef.current == null) return;
    const hasPending = Object.values(jobsByRowIdRef.current).some(j => isPendingJobId(j.id));
    if (hasPending) return;
    stopPolling();
    watchingRef.current = false;
    setJobsByRowId({});
    setRows(rs => {
      if (!rs.some(r => r.scheduledJobId)) return rs;
      return rs.map(r => (r.scheduledJobId ? { ...r, scheduledJobId: null } : r));
    });
  }

  async function cancelJob(rowId: string) {
    const cancelled = jobsByRowIdRef.current[rowId];
    // End this row's job immediately and zero its cyclic count so the panel-wide
    // count column collapses without waiting for the status poll.
    setJobsByRowId(prev => {
      const job = prev[rowId];
      if (!job) return prev;
      const next = { ...prev };
      if (isLiveJob(job)) {
        delete next[rowId];
      } else {
        next[rowId] = { ...job, sends_done: 0 };
      }
      if (!Object.values(next).some(isLiveJob)) watchingRef.current = false;
      return next;
    });
    if (cancelled?.id && isPendingJobId(cancelled.id)) {
      cancelWhenStartedRef.current.add(rowId);
    } else if (cancelled?.id) {
      try {
        await cancelScheduledSend(cancelled.id);
      } catch {
        // ignore — refreshJobs reflects the real state
      }
    }
    await refreshJobs();
    // Restore status chrome on this row when a Write already went out — but never
    // overwrite an unanswered Read (user needs to see the GA did not answer).
    if (!cancelled?.address) {
      updateRow(rowId, { scheduledJobId: null });
      return;
    }
    const addr = cancelled.address.trim();
    setRows(rs => rs.map(r => {
      if (r.id !== rowId) return r;
      const base = { ...r, scheduledJobId: null as string | null };
      // Keep the Read binding so a later Response can still replace the event word.
      if (hasUnansweredRead(r)) {
        return base;
      }
      const tg = r.lastSentTelegram ?? r.statusTelegram;
      if (!isWriteTelegram(tg) && !(cancelled.sends_done && cancelled.sends_done > 0)) return base;
      const val = telegramValue(tg, r.value, r.dpt);
      return {
        ...base,
        statusTelegram: tg,
        lastSentTelegram: tg ?? r.lastSentTelegram,
        feedback: { ok: true, msg: `written '${val}' to ${addr}` },
        statusWatch: 'write' as const,
      };
    }));
  }

  function startPolling() {
    stopPolling();
    pollRef.current = window.setInterval(() => void refreshJobs(), POLL_INTERVAL_MS);
  }

  /** End every job + read-wait; keep row inputs (header Cancel). */
  async function cancelAllRows() {
    const snapshot = jobsByRowIdRef.current;
    for (const [rowId, job] of Object.entries(snapshot)) {
      if (isPendingJobId(job.id)) cancelWhenStartedRef.current.add(rowId);
    }
    stopPolling();
    watchingRef.current = false;
    setJobsByRowId({});
    try {
      await cancelAllScheduledSends();
    } catch {
      // Local UI already cleared; status poll would disagree briefly if this fails.
    }
    setRows(rs => rs.map(r => {
      const cancelled = snapshot[r.id];
      let next: Row = { ...r, scheduledJobId: null };
      if (isLiveJob(cancelled) && !hasUnansweredRead(next)) {
        const tg = next.lastSentTelegram ?? next.statusTelegram;
        const addr = (cancelled.address ?? r.address).trim();
        if (isWriteTelegram(tg) || (cancelled.sends_done && cancelled.sends_done > 0)) {
          const val = telegramValue(tg, r.value, r.dpt);
          next = {
            ...next,
            statusTelegram: tg,
            lastSentTelegram: tg ?? next.lastSentTelegram,
            feedback: { ok: true, msg: `written '${val}' to ${addr}` },
            statusWatch: 'write',
            readBaseline: null,
          };
        }
      }
      return next;
    }));
  }

  /** Cancel every job and wipe the panel back to one empty row. */
  async function resetPanel() {
    for (const [rowId, job] of Object.entries(jobsByRowIdRef.current)) {
      if (isPendingJobId(job.id)) cancelWhenStartedRef.current.add(rowId);
    }
    stopPolling();
    watchingRef.current = false;
    setJobsByRowId({});
    setRows([newRow()]);
    // Remount the body grid host — avoids leftover row nodes if the previous
    // grid DOM got out of sync with React state (e.g. after Fast Refresh).
    setBodyEpoch(e => e + 1);
    try {
      await cancelAllScheduledSends();
    } catch {
      // Rows already reset locally.
    }
  }

  function stopPolling() {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }
}

/**
 * Last bus value for the row's GA: "Last value:" + value (+ unit).
 * Text follows the row's effective DPT (same vocabulary as the send buttons).
 * Click the value to toggle decoded ↔ raw hex. Date/time/kind live in Event.
 */
function busPulseDir(direction: string | null | undefined): 'Incoming' | 'Outgoing' | null {
  return direction === 'Incoming' || direction === 'Outgoing' ? direction : null;
}

function LastValue({ telegram, dpt }: { telegram: Telegram | undefined; dpt: string }) {
  const hasValue = telegram != null && telegram.simplified_type !== 'Read';
  if (!hasValue) return <span aria-hidden style={{ display: 'inline-block', height: 18 }} />;
  return (
    <span
      className="wtb-last-value"
      title={`Last telegram on this group address: ${telegramEventType(telegram)} from ${telegram.source_address}${telegram.source_name ? ` (${telegram.source_name})` : ''}, ${new Date(telegram.timestamp).toLocaleString()}`}
    >
      <span style={{ color: 'var(--text-dim)' }}>Last value:</span>
      <BusValueText
        value={telegram}
        dpt={dpt}
        pulse={busPulseDir(telegram.direction)}
        pulseKey={telegram.timestamp}
      />
      <style>{`
        .wtb-last-value {
          display: inline-flex; align-items: baseline; gap: 0.35rem;
          font-size: 0.72rem; padding: 0.1rem 0.4rem; border-radius: 4px; white-space: nowrap;
        }
      `}</style>
    </span>
  );
}

/** Time + jump + event kind for the last-value Event column. */
function EventCell({
  telegram,
  canJump,
  onJump,
}: {
  telegram: Telegram | undefined;
  canJump: boolean;
  onJump: () => void;
}) {
  const readAnswered = useReadAnswered(telegram);
  if (!telegram) {
    return <TelegramWhenJump empty reserveJump />;
  }
  return (
    <TelegramWhenJump
      timestamp={telegram.timestamp}
      eventType={telegramEventType(telegram)}
              readAnswered={readAnswered}
      onJump={canJump ? onJump : undefined}
      reserveJump={!canJump}
      style={{ width: '100%' }}
    />
  );
}

/** Seconds remaining until `targetIso`; ticks while `active`. */
function useCountdownSeconds(targetIso: string | null | undefined, active: boolean): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!active || !targetIso) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear when countdown becomes inactive
      setLeft(null);
      return;
    }
    const tick = () => {
      const ms = new Date(targetIso).getTime() - Date.now();
      setLeft(Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : null);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [active, targetIso]);
  return left;
}

function formatCountdown(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  return `${seconds}s`;
}

function formatGaLabel(address: string | undefined, name: string | undefined): string {
  const addr = (address ?? '').trim();
  const n = (name ?? '').trim();
  if (addr && n) return `${addr} (${n})`;
  return addr || n || 'group address';
}

/**
 * Status shell: left group (icon, countdown) and a right-packed group
 * (send count, event, Cancel/Clear). Countdown/count columns stay panel-wide
 * so empty slots keep row height; values remain per-row. Tooltips stay static.
 */
/** Panel / popover shared status shell (countdown, send count, event, Cancel). */
export function SendJobStatusField({
  feedback,
  job,
  showCountdownCol,
  showSendCountCol,
  showEventCols = false,
  showActionCol,
  actionWidth,
  statusTelegram,
  address,
  groupName,
  value,
  dpt,
  onCancel,
  onClear,
  onJump,
}: {
  feedback: { ok: boolean; msg: string } | null;
  job: ScheduledSendStatus | null;
  showCountdownCol: boolean;
  showSendCountCol: boolean;
  /** Same date/time/jump and event-type tracks on every row that shows a telegram. */
  showEventCols?: boolean;
  showActionCol: boolean;
  /** Panel-wide Cancel or Clear track width. */
  actionWidth: string;
  statusTelegram: Telegram | null;
  address: string;
  groupName: string;
  value: string;
  dpt: string;
  onCancel: () => void;
  onClear: () => void;
  onJump: () => void;
}) {
  const historyAnswered = useReadAnswered(statusTelegram);
  const jobLive = job != null && (job.state === 'waiting' || job.state === 'running');
  const jobWaiting = job != null && job.state === 'waiting';
  const jobCyclic = jobLive && Boolean(job.interval_seconds);
  // Countdown for delayed wait and cyclic interval gaps (next_send_at).
  const countdown = useCountdownSeconds(job?.next_send_at, Boolean(jobLive && job?.next_send_at));
  const writtenOk = Boolean(feedback?.ok && /^written '/i.test(feedback.msg));
  const sentOk = Boolean(feedback?.ok && /^Sent /i.test(feedback.msg));
  const isReadRequestFeedback = Boolean(feedback?.ok && /^Read request/i.test(feedback.msg));
  const isWriteTg = Boolean(
    statusTelegram
    && (statusTelegram.simplified_type === 'Write' || statusTelegram.telegram_type?.includes('Write')),
  );
  const ga = formatGaLabel(address || job?.address, groupName);
  const writtenValue = statusTelegram
    ? telegramValue(statusTelegram, value, dpt)
    : (value ?? '').trim();

  const tooltip = (() => {
    if (jobLive) return describeJob(job, groupName);
    if (feedback && !feedback.ok) return feedback.msg;
    if (isWriteTg || writtenOk || sentOk) {
      let val = writtenValue;
      if (!val && feedback?.msg) {
        const m = feedback.msg.match(/^Sent\s+(.+?)\s+to\s+/i)
          ?? feedback.msg.match(/^written '([^']*)'/i);
        if (m) val = m[1];
      }
      return `written '${val}' to ${ga}`;
    }
    if (statusTelegram) {
      const kind = telegramEventType(statusTelegram) || 'Telegram';
      return `${kind} on ${ga}`;
    }
    if (feedback?.ok) return feedback.msg;
    return '';
  })();

  let icon: ReactNode = null;
  if (feedback && !feedback.ok) {
    icon = <AlertTriangle size={14} style={{ color: 'var(--error)', flexShrink: 0 }} />;
  } else if (jobLive) {
    icon = <Timer size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />;
  } else if (feedback?.ok && !isReadRequestFeedback && !sentOk && !writtenOk) {
    icon = <CheckCircle2 size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />;
  }

  const showCountdown = showCountdownCol && countdown != null;
  const showSendCount = Boolean(
    showSendCountCol && jobCyclic && !jobWaiting && (job.sends_done ?? 0) > 0,
  );
  const hasContent = Boolean(
    icon || statusTelegram || showCountdown || showSendCount || feedback || jobLive,
  );
  const showCancel = jobLive;

  const metricStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    minWidth: '3.25ch',
    fontSize: '0.72rem',
    fontWeight: 400,
    fontFamily: "'JetBrains Mono', monospace",
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };

  // Action track width is panel-wide (Cancel-wide vs Clear-narrow) so rows stay
  // aligned. key= forces remount Cancel↔Clear so Cancel's borderLeft/margin
  // cannot leak through React's incomplete inline-style updates.
  // Omit the track entirely when no row has a job or status.
  const actionSlot = showActionCol ? (
    <div
      data-status-action
      style={{
        width: actionWidth,
        minWidth: actionWidth,
        flexShrink: 0,
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        alignSelf: 'stretch',
      }}
    >
      {showCancel ? (
        <button
          key="status-cancel"
          type="button"
          onClick={() => onCancel()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            alignSelf: 'stretch',
            width: '100%',
            background: 'transparent',
            border: 'none',
            borderLeft: '1px solid var(--border-color)',
            borderRadius: 0,
            cursor: 'pointer',
            padding: 0,
            margin: '-0.35rem -0.65rem -0.35rem 0',
            color: 'var(--accent-primary)',
            fontSize: '0.78rem',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          Cancel
        </button>
      ) : hasContent ? (
        <button
          key="status-clear"
          type="button"
          onClick={onClear}
          title="Clear status"
          aria-label="Clear status"
          style={{
            background: 'transparent',
            border: 'none',
            borderLeft: 'none',
            cursor: 'pointer',
            padding: 0,
            margin: 0,
            color: 'var(--text-dim)',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          <X size={11} />
        </button>
      ) : (
        <span key="status-action-spacer" aria-hidden style={{ display: 'inline-block', width: 11, height: 11 }} />
      )}
    </div>
  ) : null;

  const errorText = Boolean(feedback && !feedback.ok && !statusTelegram);

  return (
    <div
      data-status-field
      title={tooltip || undefined}
      aria-label={tooltip || undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.55rem',
        width: '100%',
        minWidth: !showActionCol
          ? STATUS_SHELL_MIN_WIDTH_COMPACT
          : actionWidth === STATUS_ACTION_WIDTH
            ? STATUS_SHELL_MIN_WIDTH
            : STATUS_SHELL_MIN_WIDTH_CLEAR,
        boxSizing: 'border-box',
        // Same vertical chrome as secondaryBtn (Read): 0.35rem pad + 1px border + 14px/1.2em content.
        padding: '0.35rem 0.65rem',
        fontSize: '0.78rem',
        fontWeight: 600,
        lineHeight: 1.2,
        height: STATUS_SHELL_HEIGHT,
        minHeight: STATUS_SHELL_HEIGHT,
        background: 'transparent',
        border: '1px solid var(--border-color)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.55rem',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 14,
            height: 14,
            flexShrink: 0,
            lineHeight: 0,
          }}
        >
          {icon ?? <span aria-hidden style={{ display: 'inline-block', width: 14, height: 14 }} />}
        </span>
        {showCountdownCol ? (
          <span
            data-status-metric="countdown"
            style={{ ...metricStyle, justifyContent: 'flex-end' }}
          >
            {showCountdown ? (
              <span style={{ color: 'var(--warning)' }}>-{formatCountdown(countdown)}</span>
            ) : (
              <span aria-hidden>{'\u00a0'}</span>
            )}
          </span>
        ) : null}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '0.55rem',
          marginLeft: 'auto',
          flex: 1,
          minWidth: 0,
        }}
      >
        {(showSendCountCol || showEventCols) ? (
          <div
            data-status-grid
            style={{
              display: 'grid',
              gridTemplateColumns: [
                showSendCountCol ? STATUS_COUNT_TRACK : null,
                showEventCols ? STATUS_WHEN_TRACK : null,
                showEventCols ? STATUS_EVENT_TRACK : null,
              ].filter(Boolean).join(' '),
              columnGap: '0.55rem',
              alignItems: 'center',
              flex: '0 0 auto',
              minWidth: 0,
              height: '100%',
              fontSize: '0.72rem',
              fontWeight: 400,
              fontFamily: "'JetBrains Mono', monospace",
              lineHeight: 1,
              color: 'var(--text-dim)',
            }}
          >
            {showSendCountCol ? (
              <span
                data-status-metric="count"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontVariantNumeric: 'tabular-nums' }}
              >
                {showSendCount ? (
                  <span aria-label={`Sends done ${job?.sends_done}`} style={{ color: 'var(--success)' }}>
                    {job!.sends_done}
                  </span>
                ) : (
                  <span aria-hidden>{'\u00a0'}</span>
                )}
              </span>
            ) : null}
            {showEventCols && errorText ? (
              <span
                data-status-error
                style={{
                  gridColumn: 'span 2',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: 'var(--error)',
                }}
              >
                {feedback!.msg}
              </span>
            ) : showEventCols ? (
              <>
                <span data-status-metric="when" style={{ minWidth: 0, overflow: 'hidden' }}>
                  {statusTelegram ? (
                    <TelegramWhenJump
                      timestamp={statusTelegram.timestamp}
                      onJump={onJump}
                      jumpLabel="Go to status telegram"
                    />
                  ) : (
                    <span aria-hidden>{'\u00a0'}</span>
                  )}
                </span>
                <span data-status-metric="event" style={{ minWidth: 0, overflow: 'hidden' }}>
                  {statusTelegram && telegramEventType(statusTelegram) ? (
                    <EventTypeLabel
                      kind={telegramEventType(statusTelegram)}
                      answered={historyAnswered}
                    />
                  ) : (
                    <span aria-hidden>{'\u00a0'}</span>
                  )}
                </span>
              </>
            ) : null}
          </div>
        ) : null}
        {!showEventCols ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '0.35rem',
              minWidth: 0,
              // Errors take the leftover of the right group so the ellipsis has a
              // definite width. Telegram text stays content-sized and packs right.
              flex: errorText ? '1 1 auto' : '0 1 auto',
              overflow: 'hidden',
              height: '100%',
              fontSize: '0.72rem',
              fontWeight: 400,
              lineHeight: 1,
              color: 'var(--text-dim)',
              whiteSpace: 'nowrap',
            }}
          >
            {feedback && !feedback.ok ? (
              // width:0 + minWidth:100% fills the event track for ellipsis without
              // contributing the full message to intrinsic / max-content width.
              <span
                data-status-error
                style={{
                  width: 0,
                  minWidth: '100%',
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: 'var(--error)',
                }}
              >
                {feedback.msg}
              </span>
            ) : (
              <span aria-hidden style={{ display: 'inline-block', minWidth: '8ch' }}>{'\u00a0'}</span>
            )}
          </div>
        ) : null}
        {actionSlot}
      </div>
    </div>
  );
}

/** Static job tooltip — no ticking countdown or next-send clock (avoids native tip flicker). */
function describeJob(job: ScheduledSendStatus, groupName?: string): string {
  const ga = formatGaLabel(job.address, groupName);
  if (job.read) {
    if (job.state !== 'waiting' && job.interval_seconds) {
      return `cyclic read of ${ga} every ${job.interval_seconds}s`;
    }
    return `delayed read of ${ga}`;
  }
  if (job.state === 'waiting') {
    return `delayed send to ${ga}`;
  }
  if (job.interval_seconds) {
    return `cyclic send to ${ga} every ${job.interval_seconds}s`;
  }
  return `delayed send to ${ga}`;
}
