import React, { Fragment, useMemo, useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Telegram } from '../hooks/useWebSocket';
import { ChevronUp, ChevronDown, Filter, LineChart, ListFilter, X, Clock, Info, Power, Circle, CircleDot, Download } from 'lucide-react';
import { dptKey, type ActiveFilters } from '../types/filters';
import { SendToGaHost, SendToGaPopover, type ListScrollSnapshot } from './SendToGaPopover';
import { type LinkedRowStatus } from './WriteToBusPanel';
import type { SendCorrespondenceKey } from '../utils/sendCorrespondence';
import type { BusPayload } from '../utils/dptValues';
import { GotoTimeControl } from './GotoTimeControl';
import { getPref, setPref } from '../utils/prefs';
import type { SortKey, SortLevel, SortConfig } from '../utils/sortConfig';
import { compileQuickFilters, type QuickCellValue, type QuickPatterns } from '../utils/quickFilter';
import { useTargetColors } from '../utils/targetColors';
import { anchorKey } from '../utils/anchorKey';
import { downloadTelegramsCsv } from '../utils/telegramCsv';
import { adjacentMark } from '../utils/adjacentMark';
import { peakRate } from '../utils/peakRate';
import { moveColumn, readColumnOrderPref, writeColumnOrderPref } from '../utils/columnOrder';
import { formatDpt } from '../utils/knxSend';
import { TT, ttTypeClass, ttDirectionClass, ttDptDotClass, answeredReadIds } from '../utils/telegramCellStyles';
import { EventTypeLabel } from './EventTypeLabel';
import { BusValueText } from './BusValueText';

export type { SortKey, SortLevel, SortConfig };

interface TelegramTableProps {
  telegrams: Telegram[];
  /**
   * Telegrams that decide whether a visible Read is answered.
   * The live list passes the full buffer, including the pause backlog.
   * Omitted → the rows passed as `telegrams`.
   */
  readPhaseTelegrams?: Telegram[];
  visibleColumns: { [key: string]: boolean };
  sortConfig: SortConfig;
  /** `additive` (ctrl/cmd-click) adds/toggles a sort level instead of replacing the whole config (#311). */
  onSort: (key: SortKey, opts?: { additive?: boolean }) => void;
  activeFilters: ActiveFilters;
  onQuickFilter: (key: 'sources' | 'targets' | 'types' | 'dpts', value: string | number) => void;
  onQuickVisualize: (targetAddress: string) => void;
  onQuickLastSeen?: (address: string, mode: 'ga' | 'pa') => void;
  /** Enables the per-row "Send to this GA" quick popover; true only when the bus is writable (#214). */
  canSend?: boolean;
  /** Jump from the send popover's last-value timestamp to the telegram list. */
  onGotoTelegram?: (telegram: Telegram) => void;
  /** Live bus feed for the send popover's wait-for-read-response. */
  latestTelegram?: Telegram | null;
  /** Alt-click on a row send icon → toggle the send panel. */
  onAltSend?: () => void;
  /** Ctrl/Cmd-click on a row send icon → clear or insert that GA in the send panel. */
  onCtrlSend?: (info: {
    address: string;
    name?: string | null;
    dptMain?: number | null;
    dptSub?: number | null;
  }) => void;
  /** GAs present in the send panel (send-icon opaque/blue; panel open/closed irrelevant). */
  sendPanelAddresses?: ReadonlySet<string>;
  /** GAs with a live scheduled send-job (send-icon opaque, green). */
  activeSendJobAddresses?: ReadonlySet<string>;
  /** Live job status by GA — popover shows panel-like status when a job is active. */
  gaJobStatuses?: Record<string, LinkedRowStatus>;
  /** Linked send-panel row status while a popover job is active. */
  linkedStatus?: LinkedRowStatus | null;
  onScheduleCommit?: (draft: SendCorrespondenceKey & { name?: string | null }) => void;
  onWriteWithSchedule?: (
    draft: SendCorrespondenceKey & { name?: string | null },
    payload: BusPayload,
    opts?: { response?: boolean },
  ) => void;
  onReadWithSchedule?: (draft: SendCorrespondenceKey & { name?: string | null }) => void;
  onCancelLinked?: (rowId?: string) => void;
  onClearLinked?: (rowId?: string) => void;

  // Lifted Quick-Filter state (#280, #309, #341)
  quickFilterOpen?: boolean;
  onQuickFilterOpenChange?: (open: boolean) => void;
  quickFilterEnabled?: boolean;
  onQuickFilterEnabledChange?: (enabled: boolean) => void;
  quickPatterns?: QuickPatterns;
  onQuickPatternsChange?: (patterns: QuickPatterns) => void;
  /** Edits the Time-Delta-Context window (#309, #371) — moved here from the
   * filter pane; current values come from `activeFilters.deltaBeforeMs/deltaAfterMs`. */
  onDeltaContextChange?: (deltaBeforeMs: number, deltaAfterMs: number) => void;
  /** Toggles the window on/off without losing the entered values (#318). */
  onDeltaContextEnabledChange?: (enabled: boolean) => void;

  // Lifted Follow / Anchor state (#203, #341)
  listFollow?: boolean;
  onListFollowChange?: (follow: boolean) => void;
  listAnchorKey?: string | null;
  onListAnchorKeyChange?: (key: string | null) => void;
  /** Buffer snapshot is frozen; fold cache pausedCount into the jump-to-live pill. */
  isPaused?: boolean;
  /** User latched Pause (manual); blocks auto live-follow from newest visibility. */
  isManualPause?: boolean;
  /** Telegrams ingested since the buffer snapshot was frozen. */
  pausedCount?: number;
  /** Reach the frozen live edge while auto-paused: flush without forcing follow. */
  onPauseFlush?: () => void;
  /**
   * Metered flush while auto-paused: reveal the oldest `n` backlog telegrams
   * (snapshot stays frozen otherwise). The table feeds the backlog in a few
   * rows per fill-axis gesture so it scrolls in line by line; the parent
   * resumes playing once the backlog is empty. Without it, the whole backlog
   * is flushed via `onPauseFlush`.
   */
  onPauseReveal?: (n: number) => void;
  /** Newer-pill: force Play + follow + flush so the jump includes the pause buffer. */
  onJumpToLive?: () => void;

  // Lifted row marks (#310): keys of marked telegrams + the most-recently
  // clicked one. Lifted so marks survive main-panel navigation.
  markedKeys?: string[];
  onMarkedKeysChange?: (keys: string[]) => void;
  lastMarkedKey?: string | null;
  onLastMarkedKeyChange?: (key: string | null) => void;

  // Lifted Quick Info Bar open state (#311, #341)
  infoBarOpen?: boolean;
  onInfoBarOpenChange?: (open: boolean) => void;

  // Lifted per-message Time-Delta-Context flags (#319): keys of telegrams
  // individually flagged to always anchor a context window around themselves.
  flaggedKeys?: string[];
  onFlaggedKeysChange?: (keys: string[]) => void;
  /** Global "all" state of the Time-Delta-Context (#319): every row that is
   * not itself context anchors a window, whether flagged or not. */
  contextForAllMatches?: boolean;
  onContextForAllMatchesChange?: (all: boolean) => void;

  /** Keys (via the same anchor identity) of rows present only as unfiltered
   * Time-Delta-Context around a match/flag, not because they matched the
   * active filters themselves — marked with a distinct background (#343). */
  contextKeys?: ReadonlySet<string>;

  /** Center this telegram in the visible list. `id` changes on every request
   * so repeating the same telegram jumps again. The row is marked only when
   * that exact telegram is still in the filtered list. */
  gotoRequest?: ListGotoRequest | null;
}

export interface ListGotoRequest {
  id: number;
  telegram: Telegram;
}

type ColId = 'time' | 'delta' | 'source' | 'target' | 'type' | 'dpt' | 'value';

const EMPTY_CELL: QuickCellValue = { top: '', bottom: '' };

interface ColumnDef {
  id: ColId;
  label: string;
  sortKey?: SortKey;
  defaultWidth: number;
  minWidth: number;
  /** key in visibleColumns that toggles this column (undefined = always visible) */
  visibleKey?: string;
}

// Ordered column definitions — drives both header and body so they cannot drift.
const COLUMNS: ColumnDef[] = [
  { id: 'time', label: 'TIME', sortKey: 'timestamp', defaultWidth: 120, minWidth: 90 },
  { id: 'delta', label: 'Δt', defaultWidth: 100, minWidth: 60, visibleKey: 'delta' },
  { id: 'source', label: 'SOURCE', sortKey: 'source_address', defaultWidth: 190, minWidth: 90 },
  { id: 'target', label: 'TARGET', sortKey: 'target_address', defaultWidth: 230, minWidth: 90 },
  { id: 'type', label: 'TYPE', sortKey: 'simplified_type', defaultWidth: 95, minWidth: 70, visibleKey: 'type' },
  { id: 'dpt', label: 'DPT', sortKey: 'dpt_name', defaultWidth: 150, minWidth: 80, visibleKey: 'dpt' },
  { id: 'value', label: 'VALUE', sortKey: 'value_numeric', defaultWidth: 220, minWidth: 120 },
];

const COLUMN_WIDTHS_PREF = 'columnWidths';

// Keys that scroll a list. Modifiers must not count: ctrl-click on a toolbar
// button is not the user scrolling (#435).
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);

const getDPTLabel = (dpt_main: number | null) => {
  if (dpt_main === 1) return 'DPT 1.x – Binary / Switch';
  if (dpt_main === 5) return 'DPT 5.x – 8-bit unsigned';
  if (dpt_main === 9) return 'DPT 9.x – 2-byte float';
  if (dpt_main != null) return `DPT ${dpt_main}.x`;
  return 'Unknown DPT';
};

type TelegramRow = Telegram & { deltaStr: string | null; deltaMs: number | null };

const formatDeltaMs = (diffMs: number): string => {
  const mm = String(Math.floor(diffMs / 60000)).padStart(2, '0');
  const ss = String(Math.floor((diffMs % 60000) / 1000)).padStart(2, '0');
  const ms = String(diffMs % 1000).padStart(3, '0');
  return `+ ${mm}:${ss}.${ms}`;
};

const ROW_ESTIMATE = 85; // matches the virtualizer's estimateSize
/** Fill-axis overscroll rubber; rubber-bands back to the edge telegram. */
const FILL_RUBBER_PX = Math.round(ROW_ESTIMATE / 2);
const EDGE_SCROLL_EPS = 20;
/**
 * Most pause-backlog rows revealed per step. Must stay below the virtualizer's
 * overscan so the row pinned across the insert is still rendered and can be
 * re-positioned from its real DOM rect (no estimate-based refind).
 */
const REVEAL_MAX = 8;
/** Visual scrollbar track width (matches header paddingRight / index.css). */
const LIST_SB_WIDTH_PX = 8;
const LIST_SB_MIN_THUMB_PX = 20;

function timeMs(timestamp: string): number {
  return new Date(timestamp).getTime();
}

/**
 * Rows strictly newer than `newestMs` in a list ordered by time.
 * Descending lists (newest first) keep those rows at the start; ascending
 * lists keep them at the end.
 */
function countNewerThan(rows: { timestamp: string }[], newestMs: number, ascending: boolean): number {
  if (!Number.isFinite(newestMs) || rows.length === 0) return 0;
  let lo = 0;
  let hi = rows.length;
  if (ascending) {
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (timeMs(rows[mid].timestamp) <= newestMs) lo = mid + 1;
      else hi = mid;
    }
    return rows.length - lo;
  }
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timeMs(rows[mid].timestamp) > newestMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ── Quick filter bar (#271, #309) ────────────────────────────────────────────
// Two rows per applicable column: a top pattern row (address/DPT-key patterns
// with wildcards and ranges, or a from/range bound) and a bottom text row
// (regex/literal, or a to/range bound). TYPE only uses the top row (a
// comma-separated fixed-value list); DELTA doesn't participate here at all —
// it edits the Time-Delta-Context window instead (#371).


export const TelegramTable: React.FC<TelegramTableProps> = ({
  telegrams, readPhaseTelegrams, visibleColumns, sortConfig, onSort, activeFilters, onQuickFilter, onQuickVisualize, onQuickLastSeen, canSend, onGotoTelegram,
  latestTelegram, onAltSend, onCtrlSend, sendPanelAddresses,
  activeSendJobAddresses,
  gaJobStatuses,
  linkedStatus = null, onScheduleCommit, onWriteWithSchedule, onReadWithSchedule, onCancelLinked, onClearLinked,
  quickFilterOpen, onQuickFilterOpenChange, quickFilterEnabled, onQuickFilterEnabledChange, quickPatterns, onQuickPatternsChange,
  onDeltaContextChange, onDeltaContextEnabledChange,
  listFollow, onListFollowChange, listAnchorKey, onListAnchorKeyChange,
  isPaused = false, isManualPause = false, pausedCount = 0, onPauseFlush, onPauseReveal, onJumpToLive,
  markedKeys, onMarkedKeysChange, lastMarkedKey, onLastMarkedKeyChange,
  infoBarOpen, onInfoBarOpenChange,
  flaggedKeys, onFlaggedKeysChange,
  contextForAllMatches, onContextForAllMatchesChange,
  contextKeys,
  gotoRequest,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);

  // ── Column widths (persisted, shared across live & history views) ──
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const defaults: Record<string, number> = {};
    for (const c of COLUMNS) defaults[c.id] = c.defaultWidth;
    try {
      const saved = getPref(COLUMN_WIDTHS_PREF);
      if (saved) return { ...defaults, ...JSON.parse(saved) };
    } catch {
      // Ignore malformed stored value
    }
    return defaults;
  });

  // ── Column order (persisted, shared across live & history views) ──
  // Drag a column header onto another to move it before or after that column.
  const [columnOrder, setColumnOrder] = useState<string[]>(() => readColumnOrderPref(COLUMNS.map(c => c.id)));
  const [draggingColumn, setDraggingColumn] = useState<ColId | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: ColId; side: 'before' | 'after' } | null>(null);
  // Where the press that may become a drag started: a drag must not begin from
  // a text field or the resize handle inside a header cell.
  const dragOriginRef = useRef<EventTarget | null>(null);

  const endColumnDrag = useCallback(() => {
    setDraggingColumn(null);
    setDropTarget(null);
  }, []);

  const dropColumn = useCallback((target: ColId, side: 'before' | 'after') => {
    if (draggingColumn && draggingColumn !== target) {
      setColumnOrder(prev => {
        const next = moveColumn(prev, draggingColumn, target, side);
        writeColumnOrderPref(next);
        return next;
      });
    }
    endColumnDrag();
  }, [draggingColumn, endColumnDrag]);

  const widthFor = useCallback(
    (id: ColId) => columnWidths[id] ?? COLUMNS.find(c => c.id === id)!.defaultWidth,
    [columnWidths],
  );

  const persistWidths = useCallback((widths: Record<string, number>) => {
    setPref(COLUMN_WIDTHS_PREF, JSON.stringify(widths));
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent, col: ColumnDef) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widthFor(col.id);
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(col.minWidth, Math.round(startWidth + (ev.clientX - startX)));
      setColumnWidths(prev => ({ ...prev, [col.id]: next }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setColumnWidths(prev => { persistWidths(prev); return prev; });
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [widthFor, persistWidths]);

  // Double-click a handle to reset that column to its default width.
  const handleResetWidth = useCallback((col: ColumnDef) => {
    setColumnWidths(prev => {
      const next = { ...prev, [col.id]: col.defaultWidth };
      persistWidths(next);
      return next;
    });
  }, [persistWidths]);

  // ── Quick filter bar (#271): per-column regex/literal filter on top of the
  // complex filter. Expanding enables it, collapsing disables it; the toggle
  // in the bar switches it without losing the patterns.
  const [internalQuickOpen, setInternalQuickOpen] = useState(false);
  const [internalQuickEnabled, setInternalQuickEnabled] = useState(false);
  const [internalQuickPatterns, setInternalQuickPatterns] = useState<QuickPatterns>({});

  const quickOpen = quickFilterOpen ?? internalQuickOpen;
  const setQuickOpen = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof val === 'function' ? val(quickOpen) : val;
    setInternalQuickOpen(next);
    onQuickFilterOpenChange?.(next);
  }, [quickOpen, onQuickFilterOpenChange]);

  const quickEnabled = quickFilterEnabled ?? internalQuickEnabled;
  const setQuickEnabled = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof val === 'function' ? val(quickEnabled) : val;
    setInternalQuickEnabled(next);
    onQuickFilterEnabledChange?.(next);
  }, [quickEnabled, onQuickFilterEnabledChange]);

  const currentPatterns = quickPatterns ?? internalQuickPatterns;
  const setQuickPatterns = useCallback((val: QuickPatterns | ((prev: QuickPatterns) => QuickPatterns)) => {
    const next = typeof val === 'function' ? val(currentPatterns) : val;
    setInternalQuickPatterns(next);
    onQuickPatternsChange?.(next);
  }, [currentPatterns, onQuickPatternsChange]);

  /** Updates one row (top/bottom) of a quick-filter cell, preserving the other row. */
  const setQuickCell = useCallback((id: ColId, row: 'top' | 'bottom', text: string) => {
    setQuickPatterns(prev => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_CELL), [row]: text } }));
  }, [setQuickPatterns]);

  const toggleQuickOpen = () => {
    const nextOpen = !quickOpen;
    setQuickOpen(nextOpen);
    setQuickEnabled(nextOpen);
  };

  // ── Quick info bar (#311): collapsible summary row above the header. ──────
  const [internalInfoBarOpen, setInternalInfoBarOpen] = useState(false);
  const infoOpen = infoBarOpen ?? internalInfoBarOpen;
  const toggleInfoOpen = useCallback(() => {
    const next = !infoOpen;
    setInternalInfoBarOpen(next);
    onInfoBarOpenChange?.(next);
  }, [infoOpen, onInfoBarOpenChange]);

  // ── Row marks (#310) ─────────────────────────────────────────────────────
  // Controlled when App lifts them (so marks survive navigation), otherwise a
  // local fallback. `lastMarkedKey` may legitimately be null, so distinguish
  // "not lifted" (undefined) from "lifted, nothing last" (null).
  const [internalMarkedKeys, setInternalMarkedKeys] = useState<string[]>([]);
  const [internalLastMarkedKey, setInternalLastMarkedKey] = useState<string | null>(null);

  const markedKeysList = markedKeys ?? internalMarkedKeys;
  const setMarkedKeysList = useCallback((val: string[]) => {
    setInternalMarkedKeys(val);
    onMarkedKeysChange?.(val);
  }, [onMarkedKeysChange]);

  const lastMarked = lastMarkedKey !== undefined ? lastMarkedKey : internalLastMarkedKey;
  const setLastMarked = useCallback((val: string | null) => {
    setInternalLastMarkedKey(val);
    onLastMarkedKeyChange?.(val);
  }, [onLastMarkedKeyChange]);

  const markedSet = useMemo(() => new Set(markedKeysList), [markedKeysList]);
  // Row the prev/next-mark jumps continue from (#442); null after a user scroll.
  const markCursorRef = useRef<string | null>(null);
  // The selected row for scroll anchoring (#435): the last-clicked one, as long
  // as it is still marked. A ref, because scroll handlers read it outside render.
  const selectedKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    selectedKeyRef.current = lastMarked && markedSet.has(lastMarked) ? lastMarked : null;
  }, [lastMarked, markedSet]);

  const clearMarks = useCallback(() => {
    setMarkedKeysList([]);
    setLastMarked(null);
  }, [setMarkedKeysList, setLastMarked]);

  // ── Per-message Time-Delta-Context flags (#319) ─────────────────────────
  const [internalFlaggedKeys, setInternalFlaggedKeys] = useState<string[]>([]);
  const flaggedKeysList = flaggedKeys ?? internalFlaggedKeys;
  const setFlaggedKeysList = useCallback((val: string[]) => {
    setInternalFlaggedKeys(val);
    onFlaggedKeysChange?.(val);
  }, [onFlaggedKeysChange]);
  const flaggedSet = useMemo(() => new Set(flaggedKeysList), [flaggedKeysList]);

  // Colours given to target filters (#509) apply while the address is in the
  // filter, switched off or not; a colour of a removed filter is kept for when
  // it comes back, but marks nothing meanwhile.
  const targetColors = useTargetColors();
  const activeTargetColors = useMemo(() => {
    const active: Record<string, string> = {};
    for (const address of activeFilters.targets) {
      if (targetColors[address]) active[address] = targetColors[address];
    }
    return active;
  }, [targetColors, activeFilters.targets]);
  const [internalContextForAll, setInternalContextForAll] = useState(true);
  const contextForAll = contextForAllMatches ?? internalContextForAll;
  const setContextForAll = useCallback((val: boolean) => {
    setInternalContextForAll(val);
    onContextForAllMatchesChange?.(val);
  }, [onContextForAllMatchesChange]);

  // Whether a row anchors a context window: flagged, or — in the global "all"
  // state — any row that is not itself only there as context.
  const anchorsContext = useCallback(
    (key: string) => flaggedSet.has(key) || (contextForAll && !contextKeys?.has(key)),
    [flaggedSet, contextForAll, contextKeys]
  );

  // Toggles one row's flag; ctrl/cmd-click applies the new state to every
  // currently marked row too (#310's marks, reused as a multi-select basis).
  // Switching a row off while "all" is on leaves that state: the other rows
  // keep their window as explicit flags.
  const handleFlagClick = useCallback((e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    const nextOn = !anchorsContext(key);
    const targets = (e.ctrlKey || e.metaKey) ? new Set([...markedKeysList, key]) : new Set([key]);
    if (nextOn) {
      setFlaggedKeysList([...new Set([...flaggedKeysList, ...targets])]);
      return;
    }
    const current = contextForAll
      ? [...new Set([...flaggedKeysList, ...telegrams.map(anchorKey).filter(k => !contextKeys?.has(k))])]
      : flaggedKeysList;
    if (contextForAll) setContextForAll(false);
    setFlaggedKeysList(current.filter(k => !targets.has(k)));
  }, [anchorsContext, flaggedKeysList, markedKeysList, setFlaggedKeysList, contextForAll, setContextForAll, telegrams, contextKeys]);

  // Context rows and flagged anchors are already the result of the
  // Time-Delta-Context expansion, which the parent runs on quick-filter
  // matches too. Filtering them here again would drop the context (#520).
  const quickFiltered = useMemo(() => {
    if (!quickOpen || !quickEnabled) return telegrams;
    const matches = compileQuickFilters(currentPatterns);
    const flagsActive = activeFilters.deltaContextEnabled;
    return telegrams.filter(t => {
      if (matches(t)) return true;
      const key = anchorKey(t);
      return !!contextKeys?.has(key) || (flagsActive && flaggedSet.has(key));
    });
  }, [telegrams, quickOpen, quickEnabled, currentPatterns, contextKeys, flaggedSet, activeFilters.deltaContextEnabled]);

  // Time deltas between consecutive rows, by visual (sorted) order — always
  // computed regardless of sort column, respecting whatever hierarchy is
  // active (#311).
  // A later Response on the same GA turns that Read green. The live list passes
  // the full buffer, including the pause backlog. Without the prop, the rows
  // passed as `telegrams` decide.
  const answeredReads = useMemo(
    () => answeredReadIds(readPhaseTelegrams ?? telegrams),
    [readPhaseTelegrams, telegrams],
  );

  const naturalTelegramRows = useMemo<TelegramRow[]>(() => {
    return quickFiltered.map((t, idx) => {
      let deltaStr: string | null = null;
      let deltaMs: number | null = null;
      if (idx > 0) {
        const curr = new Date(t.timestamp).getTime();
        const prev = new Date(quickFiltered[idx - 1].timestamp).getTime();
        deltaMs = Math.abs(curr - prev);
        deltaStr = formatDeltaMs(deltaMs);
      }
      return { ...t, deltaStr, deltaMs };
    });
  }, [quickFiltered]);

  // ── Delta-sort exclusive mode (#311) ────────────────────────────────────────
  // Sorting by the Δt column is a self-referential operation (deltas are
  // derived from row order), so it freezes a snapshot instead of participating
  // in the normal sortConfig: buffer/live-follow pause, deltas stop
  // recalculating, and only the frozen set's order changes on repeat clicks.
  // Any other column header exits the mode and restores the prior live state.
  const [deltaSortActive, setDeltaSortActive] = useState(false);
  const [deltaSortDirection, setDeltaSortDirection] = useState<'asc' | 'desc'>('desc');
  const [deltaFrozenRows, setDeltaFrozenRows] = useState<TelegramRow[] | null>(null);
  const preDeltaSortFollowRef = useRef<boolean | null>(null);

  const sortByDelta = useCallback((rows: TelegramRow[], direction: 'asc' | 'desc') =>
    [...rows].sort((a, b) => {
      if (a.deltaMs == null && b.deltaMs == null) return 0;
      if (a.deltaMs == null) return 1;
      if (b.deltaMs == null) return -1;
      return direction === 'desc' ? b.deltaMs - a.deltaMs : a.deltaMs - b.deltaMs;
    }), []);

  const handleDeltaHeaderClick = useCallback(() => {
    if (!deltaSortActive) {
      setDeltaFrozenRows(sortByDelta(naturalTelegramRows, 'desc'));
      setDeltaSortDirection('desc');
      setDeltaSortActive(true);
      if (onListFollowChange) {
        preDeltaSortFollowRef.current = listFollow ?? true;
        onListFollowChange(false);
      }
    } else {
      const nextDir = deltaSortDirection === 'desc' ? 'asc' : 'desc';
      setDeltaSortDirection(nextDir);
      setDeltaFrozenRows(prev => (prev ? sortByDelta(prev, nextDir) : prev));
    }
  }, [deltaSortActive, deltaSortDirection, naturalTelegramRows, sortByDelta, listFollow, onListFollowChange]);

  const exitDeltaSort = useCallback(() => {
    if (!deltaSortActive) return;
    setDeltaSortActive(false);
    setDeltaFrozenRows(null);
    if (onListFollowChange && preDeltaSortFollowRef.current !== null) {
      onListFollowChange(preDeltaSortFollowRef.current);
    }
    preDeltaSortFollowRef.current = null;
  }, [deltaSortActive, onListFollowChange]);

  // A real column header click always exits delta-sort before applying its own sort.
  const handleColumnSort = useCallback((key: SortKey, opts?: { additive?: boolean }) => {
    exitDeltaSort();
    onSort(key, opts);
  }, [exitDeltaSort, onSort]);

  const telegramRows = deltaSortActive && deltaFrozenRows ? deltaFrozenRows : naturalTelegramRows;

  // ── Global Time-Delta-Context tristate (#318, #319) ─────────────────────────
  // "all": every filter match anchors a window, including telegrams still to
  // arrive. Otherwise it reflects the per-message flags among the visible
  // rows: "some" or "none". Plain click switches none -> all and some/all ->
  // none, overriding the per-message flags; ctrl/cmd-click instead toggles the
  // window fully on/off (#318), preserving flags and values.
  const deltaFlagState: 'none' | 'some' | 'all' = useMemo(() => {
    if (contextForAll) return 'all';
    if (flaggedSet.size === 0) return 'none';
    return telegramRows.some(t => flaggedSet.has(anchorKey(t))) ? 'some' : 'none';
  }, [telegramRows, flaggedSet, contextForAll]);

  const handleDeltaToggleClick = useCallback((e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      onDeltaContextEnabledChange?.(!activeFilters.deltaContextEnabled);
      return;
    }
    setContextForAll(deltaFlagState === 'none');
    setFlaggedKeysList([]);
  }, [deltaFlagState, activeFilters.deltaContextEnabled, onDeltaContextEnabledChange, setFlaggedKeysList, setContextForAll]);

  // ── Quick info bar metrics (#311) ───────────────────────────────────────────
  // Summarizes the currently visible (sorted + filtered) rows; oldest/newest
  // and min/max Δt jump to their row via gotoIndex regardless of sort order.
  const infoMetrics = useMemo(() => {
    if (telegramRows.length === 0) return null;
    let oldestIdx = 0, newestIdx = 0;
    let minDeltaIdx = -1, maxDeltaIdx = -1;
    const sources = new Set<string>();
    const targets = new Set<string>();
    const dpts = new Set<string>();
    const typeCounts = new Map<string, number>();
    let contextCount = 0;
    const times = telegramRows.map(t => new Date(t.timestamp).getTime());
    telegramRows.forEach((t, i) => {
      if (times[i] < times[oldestIdx]) oldestIdx = i;
      if (times[i] > times[newestIdx]) newestIdx = i;
      if (t.deltaMs != null) {
        if (minDeltaIdx === -1 || t.deltaMs < telegramRows[minDeltaIdx].deltaMs!) minDeltaIdx = i;
        if (maxDeltaIdx === -1 || t.deltaMs > telegramRows[maxDeltaIdx].deltaMs!) maxDeltaIdx = i;
      }
      sources.add(t.source_address);
      targets.add(t.target_address);
      dpts.add(t.dpt_name ?? (t.dpt_main != null ? `DPT ${t.dpt_main}` : 'unknown'));
      const type = t.simplified_type || t.telegram_type;
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
      if (contextKeys?.has(anchorKey(t))) contextCount++;
    });
    return {
      count: telegramRows.length,
      oldestIdx, newestIdx,
      minDeltaIdx, maxDeltaIdx,
      // Busiest second of the view (#441); pointless for a single row.
      peak: telegramRows.length > 1 ? peakRate(times) : null,
      sourceCount: sources.size,
      targetCount: targets.size,
      dptCount: dpts.size,
      typeCounts: [...typeCounts.entries()].sort((a, b) => b[1] - a[1]),
      contextCount,
    };
  }, [telegramRows, contextKeys]);

  // ── ETS-style scroll anchoring (#202) ───────────────────────────────────────
  // Auto-scroll only while the scrollbar sits at the live edge (top for
  // newest-first, bottom for oldest-first). Scrolled away, the viewed rows are
  // anchored. The jump-to-live pill counts telegrams newer than the newest one
  // on screen, so it stays hidden while that newest telegram is visible —
  // which is always the case in live mode. Only meaningful for the timestamp
  // sort, where the live edge exists.
  //
  // Rows are dynamically measured (ResizeObserver), so a new row enters the
  // layout at the 85px estimate and later shrinks to its real height. Estimate-
  // based math therefore can't keep an anchored row still. Instead we track a
  // concrete anchor row by key and, after each update, correct scrollTop by the
  // real pixel delta of that row's position — re-run on the next frame so the
  // async re-measure of prepended rows is absorbed too.
  // Only the *primary* level's key matters for the live edge — a secondary
  // TIME tiebreaker doesn't make the list time-ordered top-to-bottom (#311).
  const primarySort = sortConfig[0];
  const isTimeSort = primarySort?.key === 'timestamp' && !deltaSortActive;
  const liveEdge = primarySort?.direction === 'asc' ? 'bottom' : 'top';

  // Fill-axis rubber (½ row) as virtualizer padding — pause backlog stays in the
  // newer-pill only, not in scrollHeight / thumb.
  const liveFillRubberPx = telegramRows.length > 0 ? FILL_RUBBER_PX : 0;

  // Opposite-edge spacer (DOM sibling): settle pad when the list is shorter than
  // the viewport (keep ≥1 full row) + ½-row rubber overscroll.
  const [viewportHeight, setViewportHeight] = useState(0);
  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const measure = () => setViewportHeight(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  type ScrollGeom = {
    fillRubberPx: number;
    oppositeSpacerPx: number;
    /** Virtualizer block height at lock — keeps scrollHeight stable on prepend. */
    virtTotalPx: number;
  };
  // Snapshot while scrollbar is held or rubber is active so scrollHeight / spacer
  // do not wobble from live prepend or remeasure mid-gesture.
  const [frozenGeom, setFrozenGeom] = useState<ScrollGeom | null>(null);
  const fillRubberPx = frozenGeom?.fillRubberPx ?? liveFillRubberPx;

  const virtualizer = useVirtualizer({
    count: telegramRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE, // Better estimate for multi-line rows
    overscan: 10,
    paddingStart: liveEdge === 'top' ? fillRubberPx : 0,
    paddingEnd: liveEdge === 'bottom' ? fillRubberPx : 0,
    getItemKey: (index) => {
      const t = telegramRows[index];
      return `${t.timestamp}-${t.source_address}-${t.target_address}-${t.raw_hex || index}`;
    },
  });

  const liveVirtTotalPx = virtualizer.getTotalSize();
  const virtTotalPx = frozenGeom?.virtTotalPx ?? liveVirtTotalPx;
  const rowsHeight = Math.max(0, liveVirtTotalPx - fillRubberPx);
  const contentWithFill = fillRubberPx + rowsHeight;
  const oppositeSettlePadPx =
    viewportHeight > 0 && contentWithFill < viewportHeight
      ? Math.max(0, viewportHeight - ROW_ESTIMATE)
      : 0;
  const oppositeRubberPx = telegramRows.length > 0 ? FILL_RUBBER_PX : 0;
  const liveOppositeSpacerPx = oppositeSettlePadPx + oppositeRubberPx;
  const liveGeomRef = useRef<ScrollGeom>({
    fillRubberPx: liveFillRubberPx,
    oppositeSpacerPx: liveOppositeSpacerPx,
    virtTotalPx: liveVirtTotalPx,
  });
  liveGeomRef.current = {
    fillRubberPx: liveFillRubberPx,
    oppositeSpacerPx: liveOppositeSpacerPx,
    virtTotalPx: liveVirtTotalPx,
  };
  // Short-list settle pad held across a metered reveal: the pad drops to 0 the
  // moment the growing list exceeds the viewport, which would clamp scrollTop
  // and snap the viewport. Kept until scrollTop fits the live geometry again.
  const [stickyOppositeSpacerPx, setStickyOppositeSpacerPx] = useState(0);
  const oppositeSpacerPx =
    frozenGeom?.oppositeSpacerPx ?? Math.max(liveOppositeSpacerPx, stickyOppositeSpacerPx);
  const rubberBandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rubberBandRafRef = useRef<number | null>(null);
  /** Active rubber-band animation; survives live prepends (no retarget). */
  const rubberAnimRef = useRef<{
    side: 'fill' | 'opposite';
    from: number;
    to: number;
    t0: number;
    duration: number;
  } | null>(null);
  const atEdgeRef = useRef(listFollow ?? true);
  // After an intentional unfollow, ignore newestFullyVisible until the newest
  // row has left full visibility once — otherwise a short list or edge-row
  // click would re-enable follow immediately.
  const detachedFromEdgeRef = useRef(!(listFollow ?? true));
  // Last positive newer-pill count; held across the flush gap until a real
  // newerCount is measured again.
  const stickyNewerCountRef = useRef(0);
  // Mirrors atEdgeRef for render. Pill still shows when a backlog exists.
  const [followingLive, setFollowingLive] = useState(listFollow ?? true);
  // Armed on every pause flush; forces pin (never scrollToEdge) until the
  // merged list actually changes the live-edge key.
  const flushPinRef = useRef(false);
  // In-flight metered reveal: backlog size when requested and rows asked for.
  // Lets the merge effect tell "reveal landed but every row was filtered out"
  // (pausedCount dropped, edge key unchanged) from an unrelated publish.
  const revealRef = useRef<{ before: number; n: number } | null>(null);
  // Newer-pill jump: next merge must scrollToEdge (not pin) after Play/flush.
  const jumpToLiveRef = useRef(false);
  // The row held still while anchored, and its offset from the scroll-container
  // top: the selected (last-marked) row while it is on screen (#435), otherwise
  // the top-most visible one. Captured from user scrolls and row clicks only.
  const anchorRef = useRef<{ key: string; offset: number } | null>(
    listAnchorKey ? { key: listAnchorKey, offset: 0 } : null
  );
  const programmaticScrollRef = useRef(false);
  // Whether the user is scrolling right now — wheel, touch, keys, or a held
  // scrollbar. Lets pinAnchor tell "the anchor left the rendered window
  // because the user jumped away" from "because rows were inserted" (#435).
  const scrollbarHeldRef = useRef(false);
  const userScrollUntilRef = useRef(0);
  const noteUserScroll = () => { userScrollUntilRef.current = performance.now() + 300; };
  const userScrolling = () => scrollbarHeldRef.current || performance.now() < userScrollUntilRef.current;
  // Wheel/key delta to apply into the merged list after a pause-buffer flush pin.
  const pendingFlushScrollDeltaRef = useRef<number | null>(null);
  // Latest toward-newer live-edge helpers for the global key listener (empty deps).
  const engageLiveTowardNewerRef = useRef<(deltaY: number) => void>(() => {});
  const keyTowardNewerRef = useRef<(key: string) => boolean>(() => false);
  const keyScrollDeltaRef = useRef<(key: string) => number>(() => 0);
  const scheduleRubberBandRef = useRef(() => {});
  const unlockScrollGeometryIfSettledRef = useRef(() => {});
  const inFillRubberZoneRef = useRef<() => boolean>(() => false);
  const inOppositeRubberZoneRef = useRef<() => boolean>(() => false);
  useEffect(() => {
    const release = () => {
      if (!scrollbarHeldRef.current) return;
      scrollbarHeldRef.current = false;
      noteUserScroll();
      if (inFillRubberZoneRef.current() || inOppositeRubberZoneRef.current()) {
        scheduleRubberBandRef.current();
      } else {
        unlockScrollGeometryIfSettledRef.current();
      }
    };
    // Keys scroll the list without it holding focus, so listen globally.
    const onKey = (e: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(e.key)) return;
      userScrollUntilRef.current = performance.now() + 300;
      if (keyTowardNewerRef.current(e.key)) {
        engageLiveTowardNewerRef.current(keyScrollDeltaRef.current(e.key));
      }
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  // The row list the anchor was last seen in. Unchanged list + missing anchor
  // can only mean the viewport moved, never that rows were inserted.
  const anchorRowsRef = useRef<typeof telegramRows | null>(null);
  // Latest rows for callbacks that outlive a render (scroll handlers, frames).
  const telegramRowsRef = useRef(telegramRows);
  useLayoutEffect(() => { telegramRowsRef.current = telegramRows; });
  // Bounds captureAnchor's wait for the virtualizer to draw rows on screen.
  const captureRetriesRef = useRef(0);
  // Set while pinAnchor is bringing back an anchor that left the virtualized
  // window; the scrolls that causes are ours, not the user's.
  const refindingAnchorRef = useRef(false);
  // Zebra stripes must stay with a telegram, not with a row index (#266):
  // prepends at the live edge shift every index by the number of new rows, so
  // this offset accumulates those shifts and is added back to the index parity.
  const [stripeOffset, setStripeOffset] = useState(0);

  // Sync follow prop. Unfollow always leaves the live edge and arms the detach
  // latch; follow from the parent clears the latch. Follow must NOT claim we
  // are at the edge — that would scrollToEdge on the next pause-buffer flush.
  // jumpToLive / handleScroll set atEdge themselves.
  useEffect(() => {
    if (listFollow === undefined) return;
    setFollowingLive(listFollow);
    if (!listFollow) {
      atEdgeRef.current = false;
      detachedFromEdgeRef.current = true;
    } else {
      detachedFromEdgeRef.current = false;
    }
  }, [listFollow]);

  useEffect(() => {
    if (listAnchorKey !== undefined) {
      if (listAnchorKey === null) {
        anchorRef.current = null;
      } else if (!anchorRef.current || anchorRef.current.key !== listAnchorKey) {
        anchorRef.current = { key: listAnchorKey, offset: 0 };
      }
    }
  }, [listAnchorKey]);

  // Suppress edge/anchor tracking for scrolls we cause ourselves. Auto-clears on
  // the next frame so a no-op programmatic scroll can't swallow a later real one.
  const markProgrammatic = () => {
    programmaticScrollRef.current = true;
    requestAnimationFrame(() => { programmaticScrollRef.current = false; });
  };

  const rowOffset = (key: string): number | null => {
    const el = parentRef.current;
    if (!el) return null;
    const row = el.querySelector<HTMLElement>(`[data-akey="${CSS.escape(key)}"]`);
    if (!row) return null;
    return row.getBoundingClientRect().top - el.getBoundingClientRect().top;
  };

  /** Settled live-edge scrollTop (edge telegram flush; not into the fill rubber). */
  const settledEdgeScrollTop = () => {
    const el = parentRef.current;
    if (!el) return fillRubberPx;
    if (liveEdge === 'top') return fillRubberPx;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    return Math.max(0, max - fillRubberPx);
  };

  /** Settled opposite-edge scrollTop (not into the opposite rubber overscroll). */
  const settledOppositeScrollTop = () => {
    const el = parentRef.current;
    if (!el) return 0;
    // Opposite spacer sits away from the live edge: bottom for newest-on-top,
    // top for oldest-on-top.
    if (liveEdge === 'bottom') return oppositeRubberPx;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    return Math.max(0, max - oppositeRubberPx);
  };

  /** True while overscrolled into the fill-axis rubber zone (outer fillRubber only). */
  const inFillRubberZone = () => {
    const el = parentRef.current;
    if (!el || fillRubberPx <= 0) return false;
    if (liveEdge === 'top') return el.scrollTop < fillRubberPx - 0.5;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    return el.scrollTop > max - fillRubberPx + 0.5;
  };

  /**
   * Auto-paused with a backlog the parent can meter out: the fill padding is
   * then the insert slot for the next backlog rows, not a rubber band.
   */
  const backlogFeedActive = () =>
    isPaused && !isManualPause && pausedCount > 0 && !!onPauseReveal;

  /**
   * Manually paused with a backlog: the fill spacer is a hard stop that stays
   * on screen (with its "...paused manually..." labels) instead of rubber-
   * banding away; switching to auto pause fills it with the oldest backlog row.
   */
  const manualHoldActive = () => isManualPause && pausedCount > 0;

  /** Fill overscroll that should rubber-band back (nothing waiting to fill it). */
  const inFillRubberBand = () =>
    inFillRubberZone() && !backlogFeedActive() && !manualHoldActive();

  /** Fill spacer fully in the viewport (not partially scrolled away). */
  const fillRubberFullyVisible = () => {
    const el = parentRef.current;
    if (!el || fillRubberPx <= 0) return false;
    if (liveEdge === 'top') return el.scrollTop <= 0.5;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    return el.scrollTop >= max - 0.5;
  };

  const [showFillPauseLabels, setShowFillPauseLabels] = useState(false);
  /** Bumps to remount labels so the highlight→dim fade restarts. */
  const [fillPauseFadeKey, setFillPauseFadeKey] = useState(0);
  const fillPauseLabelsShownRef = useRef(false);
  /** One highlight pulse per scrollbar drag past the fill hard-stop. */
  const fillPauseSbPulsedRef = useRef(false);
  const pulseFillPauseLabels = () => {
    setFillPauseFadeKey(k => k + 1);
  };
  const syncFillPauseLabels = () => {
    const next = !!isManualPause && fillRubberFullyVisible();
    if (next && !fillPauseLabelsShownRef.current) {
      pulseFillPauseLabels();
    }
    if (!next) fillPauseSbPulsedRef.current = false;
    fillPauseLabelsShownRef.current = next;
    setShowFillPauseLabels(next);
  };
  useLayoutEffect(() => {
    syncFillPauseLabels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManualPause, fillRubberPx, liveEdge, telegramRows.length]);

  /** True while overscrolled into the opposite-axis rubber zone. */
  const inOppositeRubberZone = () => {
    const el = parentRef.current;
    if (!el || oppositeRubberPx <= 0) return false;
    const settle = settledOppositeScrollTop();
    if (liveEdge === 'top') return el.scrollTop > settle + 0.5;
    return el.scrollTop < settle - 0.5;
  };

  const lockScrollGeometry = () => {
    // A metered reveal needs the live virtualizer height: a frozen scrollHeight
    // would clamp the pin and snap the viewport.
    if (flushPinRef.current) return;
    setFrozenGeom(prev => prev ?? { ...liveGeomRef.current });
  };

  const unlockScrollGeometryIfSettled = () => {
    if (scrollbarHeldRef.current) return;
    if (rubberAnimRef.current) return;
    if (inOppositeRubberZone() || inFillRubberBand()) return;
    setFrozenGeom(null);
  };

  /** Drop the sticky short-list pad once scrollTop fits the live geometry. */
  const releaseStickySpacerIfFits = () => {
    if (stickyOppositeSpacerPx <= 0 || flushPinRef.current) return;
    const el = parentRef.current;
    if (!el) return;
    const liveMax = Math.max(0, liveVirtTotalPx + liveOppositeSpacerPx - el.clientHeight);
    if (el.scrollTop <= liveMax + 0.5) setStickyOppositeSpacerPx(0);
  };

  const checkAtEdge = () => {
    const el = parentRef.current;
    if (!el) return true;
    // Settled edge or fill-rubber overscroll both count as at the live edge.
    if (liveEdge === 'top') return el.scrollTop <= fillRubberPx + EDGE_SCROLL_EPS;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    return el.scrollTop >= Math.max(0, max - fillRubberPx) - EDGE_SCROLL_EPS;
  };

  /**
   * How far (px, ≥ 0) a fill-axis move of `deltaY` would carry the viewport
   * past the settled live edge into the fill slot. 0 when it stays on rows.
   */
  const fillOverrunFor = (deltaY: number) => {
    const el = parentRef.current;
    if (!el) return 0;
    const target = el.scrollTop + deltaY;
    const settled = settledEdgeScrollTop();
    return Math.max(0, liveEdge === 'top' ? settled - target : target - settled);
  };

  const cancelRubberBand = () => {
    if (rubberBandTimerRef.current != null) {
      clearTimeout(rubberBandTimerRef.current);
      rubberBandTimerRef.current = null;
    }
    if (rubberBandRafRef.current != null) {
      cancelAnimationFrame(rubberBandRafRef.current);
      rubberBandRafRef.current = null;
    }
    rubberAnimRef.current = null;
  };

  /** Opposite rubber must always finish — ignore pause-flush pins. */
  const oppositeRubberBusy = () =>
    rubberAnimRef.current?.side === 'opposite' || inOppositeRubberZone();

  /** Animate scrollTop to `target` on the given rubber side (ease + settle timer). */
  const startRubberBandTo = (
    target: number,
    side: 'fill' | 'opposite',
    onDone?: () => void,
  ) => {
    const el = parentRef.current;
    if (!el) return;
    // Opposite rubber always runs to completion, including during pause flush.
    if (
      side !== 'opposite'
      && (flushPinRef.current || pendingFlushScrollDeltaRef.current != null)
    ) return;
    if (jumpToLiveRef.current) return;
    const start = el.scrollTop;
    const delta = target - start;
    let finished = false;
    const finish = (node: HTMLElement, to: number) => {
      if (finished) return;
      finished = true;
      markProgrammatic();
      node.scrollTop = to;
      rubberAnimRef.current = null;
      if (rubberBandTimerRef.current != null) {
        clearTimeout(rubberBandTimerRef.current);
        rubberBandTimerRef.current = null;
      }
      if (rubberBandRafRef.current != null) {
        cancelAnimationFrame(rubberBandRafRef.current);
        rubberBandRafRef.current = null;
      }
      unlockScrollGeometryIfSettled();
      onDone?.();
    };
    lockScrollGeometry();
    if (Math.abs(delta) < 0.5) {
      finish(el, target);
      return;
    }

    // Keep side/progress; replace timers/frames only.
    if (rubberBandTimerRef.current != null) {
      clearTimeout(rubberBandTimerRef.current);
      rubberBandTimerRef.current = null;
    }
    if (rubberBandRafRef.current != null) {
      cancelAnimationFrame(rubberBandRafRef.current);
      rubberBandRafRef.current = null;
    }

    markProgrammatic();
    const duration = 180;
    const t0 = performance.now();
    rubberAnimRef.current = { side, from: start, to: target, t0, duration };
    const step = (now: number) => {
      const node = parentRef.current;
      const anim = rubberAnimRef.current;
      if (!node || !anim) {
        rubberBandRafRef.current = null;
        return;
      }
      markProgrammatic();
      const t = Math.min(1, Math.max(0, (now - anim.t0) / anim.duration));
      const ease = 1 - (1 - t) ** 3;
      node.scrollTop = anim.from + (anim.to - anim.from) * ease;
      if (t < 1) {
        rubberBandRafRef.current = requestAnimationFrame(step);
      } else {
        rubberBandRafRef.current = null;
        finish(node, anim.to);
      }
    };
    rubberBandRafRef.current = requestAnimationFrame(step);
    rubberBandTimerRef.current = setTimeout(() => {
      rubberBandTimerRef.current = null;
      if (rubberBandRafRef.current != null) {
        cancelAnimationFrame(rubberBandRafRef.current);
        rubberBandRafRef.current = null;
      }
      const node = parentRef.current;
      const anim = rubberAnimRef.current;
      if (!node || !anim) return;
      finish(node, anim.to);
    }, duration);
  };

  const rubberBandFromZone = () => {
    if (inFillRubberBand()) {
      startRubberBandTo(settledEdgeScrollTop(), 'fill');
      return;
    }
    if (inOppositeRubberZone()) {
      startRubberBandTo(settledOppositeScrollTop(), 'opposite');
    }
  };

  const scheduleRubberBand = () => {
    // Do not fight a held scrollbar thumb — rubber runs on pointerup instead.
    if (scrollbarHeldRef.current) return;
    if (fillRubberPx <= 0 && oppositeRubberPx <= 0) return;
    if (rubberBandTimerRef.current != null) clearTimeout(rubberBandTimerRef.current);
    rubberBandTimerRef.current = setTimeout(() => {
      rubberBandTimerRef.current = null;
      rubberBandFromZone();
    }, 90);
  };
  scheduleRubberBandRef.current = scheduleRubberBand;
  unlockScrollGeometryIfSettledRef.current = unlockScrollGeometryIfSettled;
  inFillRubberZoneRef.current = inFillRubberBand;
  inOppositeRubberZoneRef.current = inOppositeRubberZone;

  useEffect(() => () => cancelRubberBand(), []);

  // Newest live-edge row fully inside the scrollport. Empty list → false.
  // When layout boxes are unreliable (jsdom), fall back to checkAtEdge().
  const newestFullyVisible = () => {
    const rows = telegramRowsRef.current;
    if (rows.length === 0) return false;
    const el = parentRef.current;
    if (!el) return false;
    const key = anchorKey(rows[liveEdge === 'top' ? 0 : rows.length - 1]);
    const row = el.querySelector<HTMLElement>(`[data-akey="${CSS.escape(key)}"]`);
    if (!row) return false;
    const rr = row.getBoundingClientRect();
    const pr = el.getBoundingClientRect();
    const eps = 2;
    const layoutReliable =
      Math.abs(rr.height - pr.height) > 1 || Math.abs(rr.top - pr.top) > 1;
    if (!layoutReliable) return checkAtEdge();
    return rr.top >= pr.top - eps && rr.bottom <= pr.bottom + eps;
  };

  const enableLiveFollow = () => {
    detachedFromEdgeRef.current = false;
    atEdgeRef.current = true;
    setFollowingLive(true);
    onListFollowChange?.(true);
    anchorRef.current = null;
    onListAnchorKeyChange?.(null);
  };

  const syncFollowFromNewestVisibility = () => {
    if (isManualPause) return;
    if (detachedFromEdgeRef.current) return;
    // A backlog still waits: following would flush it all at once.
    if (backlogFeedActive()) return;
    if (!newestFullyVisible()) return;
    enableLiveFollow();
  };

  /**
   * Backlog rows to reveal for a fill-axis move of `px`: enough to cover the
   * move plus the fill slot (so the viewport never runs into blank padding),
   * one spare for rows measuring shorter than the estimate, capped so the
   * pinned row stays rendered. Any shortfall is topped up by the merge effect.
   */
  const revealCountFor = (px: number) => {
    const need = Math.ceil((Math.abs(px) + fillRubberPx) / ROW_ESTIMATE) + 1;
    return Math.max(1, Math.min(pausedCount, need, REVEAL_MAX));
  };

  /**
   * Ask the parent for the next metered slice. The edge-most visible row is
   * pinned (selection ignored: a marked row elsewhere must not steer the
   * flush); the gesture delta is applied once the rows have landed.
   */
  const requestReveal = (deltaY: number, n: number) => {
    flushPinRef.current = true;
    captureAnchor(null, { ignoreSelection: true });
    pendingFlushScrollDeltaRef.current = deltaY;
    revealRef.current = { before: pausedCount, n };
    onPauseReveal?.(n);
  };

  /**
   * Start a metered step from rest: a few rows inserted into the fill slot.
   * Rows must grow scrollHeight, so no frozen geometry; a short list keeps its
   * settle pad until the viewport fits the live geometry again.
   */
  const armMeteredReveal = (deltaY: number, n: number) => {
    setFrozenGeom(null);
    setStickyOppositeSpacerPx(prev => Math.max(prev, liveGeomRef.current.oppositeSpacerPx));
    requestReveal(deltaY, n);
  };

  // Scroll along the pause-buffer fill axis (toward the live edge) at the frozen
  // fill end: feed the backlog and continue the gesture seamlessly. Against
  // the fill axis never flushes (handleScroll has no flush). Empty list: no-op.
  // Without backlog, follow re-engages; fill-rubber overscroll rubber-bands back.
  const engageLiveTowardNewer = (deltaY: number) => {
    if (telegramRowsRef.current.length === 0) return;
    if (flushPinRef.current) {
      // Rows of the previous step have not landed yet: fold this move into the
      // pending delta; the merge effect tops the reveal up if the slot is
      // still open afterwards.
      pendingFlushScrollDeltaRef.current = (pendingFlushScrollDeltaRef.current ?? 0) + deltaY;
      return;
    }
    // A move that would run past the settled edge into the fill slot counts
    // too while a backlog waits (e.g. right after a slot fill left the edge
    // row 73px in): the browser clamps that part of the scroll, so without a
    // reveal the gesture would lose it.
    const overrun = fillOverrunFor(deltaY);
    if (!checkAtEdge() && !(backlogFeedActive() && overrun > 0)) return;
    if (isPaused && pausedCount > 0) {
      // Manual pause: the fill edge is a hard stop (labels pulse instead).
      if (isManualPause) return;
      detachedFromEdgeRef.current = false;
      // Flush must never claim the live edge — that would scrollToEdge on merge.
      // Pin + pending delta keep the viewport moving line-wise into the backlog.
      // Opposite rubber always finishes — do not cancel it for pause flush.
      if (!oppositeRubberBusy()) cancelRubberBand();
      atEdgeRef.current = false;
      if (onPauseReveal) {
        armMeteredReveal(deltaY, revealCountFor(overrun));
        return;
      }
      flushPinRef.current = true;
      if (!anchorRef.current) captureAnchor();
      pendingFlushScrollDeltaRef.current = deltaY;
      onPauseFlush?.();
      return;
    }
    detachedFromEdgeRef.current = false;
    enableLiveFollow();
    scheduleRubberBand();
  };
  const wheelTowardNewer = (deltaY: number) =>
    liveEdge === 'top' ? deltaY < 0 : deltaY > 0;
  const keyTowardNewer = (key: string) => {
    if (liveEdge === 'top') return key === 'ArrowUp' || key === 'PageUp' || key === 'Home';
    return key === 'ArrowDown' || key === 'PageDown' || key === 'End' || key === ' ';
  };
  const keyScrollDelta = (key: string) => {
    const page = parentRef.current?.clientHeight ?? 800;
    const sign = liveEdge === 'top' ? -1 : 1;
    if (key === 'PageUp' || key === 'PageDown' || key === 'Home' || key === 'End' || key === ' ') {
      return sign * page;
    }
    return sign * 40;
  };
  engageLiveTowardNewerRef.current = engageLiveTowardNewer;
  keyTowardNewerRef.current = keyTowardNewer;
  keyScrollDeltaRef.current = keyScrollDelta;

  /**
   * Pause live-follow for send-popover open / restore. Mirrors an edge click
   * (#266) without replacing the pause/scroll rubber-band path.
   */
  const pauseLiveFollowForSend = () => {
    if (!atEdgeRef.current) return;
    atEdgeRef.current = false;
    detachedFromEdgeRef.current = true;
    setFollowingLive(false);
    onListFollowChange?.(false);
  };

  /** Snapshot for send-popover "restore list position" (anchor key + viewport offset). */
  const captureListScroll = useCallback((): ListScrollSnapshot | null => {
    pauseLiveFollowForSend();
    const el = parentRef.current;
    if (!el) return null;
    const scrollTop = el.scrollTop;
    if (anchorRef.current) {
      return { scrollTop, key: anchorRef.current.key, offset: anchorRef.current.offset };
    }
    const items = virtualizer.getVirtualItems();
    const first = items[0];
    if (first == null) return { scrollTop, key: null, offset: 0 };
    const t = telegramRows[first.index];
    if (!t) return { scrollTop, key: null, offset: 0 };
    const key = anchorKey(t);
    const offset = rowOffset(key) ?? (first.start - scrollTop);
    anchorRef.current = { key, offset };
    onListAnchorKeyChange?.(key);
    return { scrollTop, key, offset };
  }, [virtualizer, telegramRows, onListAnchorKeyChange]);

  /** Restore the list to the send-popover open snapshot; pauses live-follow.
   *  Resolves after the offset correction so the popover can re-anchor. */
  const restoreListScroll = useCallback((snap: ListScrollSnapshot): Promise<void> => {
    const el = parentRef.current;
    if (!el) return Promise.resolve();
    pauseLiveFollowForSend();
    if (snap.key) {
      const idx = telegramRows.findIndex(r => anchorKey(r) === snap.key);
      if (idx >= 0) {
        markProgrammatic();
        virtualizer.scrollToIndex(idx, { align: 'start' });
        return new Promise(resolve => {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const found = rowOffset(snap.key!);
            if (found != null) {
              markProgrammatic();
              el.scrollTop += found - snap.offset;
              anchorRef.current = { key: snap.key!, offset: snap.offset };
              onListAnchorKeyChange?.(snap.key!);
            } else {
              markProgrammatic();
              el.scrollTop = snap.scrollTop;
            }
            resolve();
          }));
        });
      }
    }
    markProgrammatic();
    el.scrollTop = snap.scrollTop;
    return Promise.resolve();
  }, [virtualizer, telegramRows, onListAnchorKeyChange]);

  // Record the row to pin across list updates. `selectedKey` is the row the
  // user is working on; it wins while any part of it is inside the viewport, so
  // rows arriving above it (a reload, Time-Delta-Context) can't push it away
  // (#435). Without one on screen, the top-most visible row is pinned (#202).
  const captureAnchor = (
    selectedKey: string | null = selectedKeyRef.current,
    opts?: { ignoreSelection?: boolean },
  ) => {
    const el = parentRef.current;
    if (!el) return;
    const cRect = el.getBoundingClientRect();
    const cTop = cRect.top;
    if (selectedKey && !opts?.ignoreSelection) {
      const row = el.querySelector<HTMLElement>(`[data-akey="${CSS.escape(selectedKey)}"]`);
      const rr = row?.getBoundingClientRect();
      if (rr && rr.bottom > cTop && rr.top < cRect.bottom) {
        anchorRef.current = { key: selectedKey, offset: rr.top - cTop };
        anchorRowsRef.current = telegramRowsRef.current;
        onListAnchorKeyChange?.(selectedKey);
        return;
      }
    }
    for (const row of el.querySelectorAll<HTMLElement>('.log-row')) {
      const rr = row.getBoundingClientRect();
      if (rr.bottom - cTop > 0 && rr.top < cRect.bottom) {
        const key = row.getAttribute('data-akey');
        if (key) {
          anchorRef.current = { key, offset: rr.top - cTop };
          anchorRowsRef.current = telegramRowsRef.current;
          onListAnchorKeyChange?.(key);
          captureRetriesRef.current = 0;
        }
        return;
      }
    }
    // Nothing rendered is on screen: after a long jump (scrollbar drag) the
    // virtualizer has not drawn the new rows yet. A row from the old position
    // must not become the anchor — pinAnchor would scroll back to it — so
    // wait for the next frames instead.
    anchorRef.current = null;
    if (captureRetriesRef.current < 5) {
      captureRetriesRef.current++;
      requestAnimationFrame(() => {
        if (!atEdgeRef.current && !anchorRef.current) captureAnchor();
      });
    } else {
      captureRetriesRef.current = 0;
    }
  };

  // Paint-only overlay thumb — mutate DOM (no useState) so sync cannot trigger
  // an extra render that would clear the sticky newer-pill across a flush gap.
  const sbTrackRef = useRef<HTMLDivElement | null>(null);
  const sbThumbRef = useRef<HTMLDivElement | null>(null);
  const sbDragRef = useRef<{
    pointerId: number;
    startY: number;
    startScrollTop: number;
  } | null>(null);

  /** Paint-only thumb: size/position as if pausedCount rows were in scrollHeight. */
  const syncOverlayScrollbar = () => {
    const el = parentRef.current;
    const track = sbTrackRef.current;
    const thumb = sbThumbRef.current;
    if (!el || !track || !thumb) return;
    const { clientHeight, scrollHeight, scrollTop } = el;
    const backlogPx = telegramRows.length > 0 ? Math.max(0, pausedCount) * ROW_ESTIMATE : 0;
    const virtSH = scrollHeight + backlogPx;
    if (virtSH <= clientHeight + 0.5) {
      track.style.display = 'none';
      return;
    }
    track.style.display = '';
    const thumbHeight = Math.max(LIST_SB_MIN_THUMB_PX, (clientHeight * clientHeight) / virtSH);
    const virtMaxScroll = Math.max(0, virtSH - clientHeight);
    const trackTravel = Math.max(0, clientHeight - thumbHeight);
    const virtScrollTop = liveEdge === 'top'
      ? Math.min(virtMaxScroll, Math.max(0, scrollTop + backlogPx))
      : Math.min(virtMaxScroll, Math.max(0, scrollTop));
    const top = virtMaxScroll > 0 ? (virtScrollTop / virtMaxScroll) * trackTravel : 0;
    thumb.style.top = `${top}px`;
    thumb.style.height = `${thumbHeight}px`;
  };

  /**
   * Thumb drag → real scrollTop, clamped to the real scroll range. `raw` is the
   * unclamped target: how far past the fill hard-stop the thumb was pulled is
   * the backlog the drag asks for.
   */
  const mapThumbDeltaToScrollTop = (startScrollTop: number, deltaY: number) => {
    const el = parentRef.current;
    if (!el) return { next: startScrollTop, raw: startScrollTop };
    const { clientHeight, scrollHeight } = el;
    const backlogPx = telegramRows.length > 0 ? Math.max(0, pausedCount) * ROW_ESTIMATE : 0;
    const virtSH = scrollHeight + backlogPx;
    const thumbHeight = Math.max(LIST_SB_MIN_THUMB_PX, (clientHeight * clientHeight) / Math.max(virtSH, 1));
    const trackTravel = Math.max(0, clientHeight - thumbHeight);
    const maxScroll = Math.max(0, scrollHeight - clientHeight);
    const virtMaxScroll = Math.max(0, virtSH - clientHeight);
    if (trackTravel <= 0 || maxScroll <= 0) return { next: startScrollTop, raw: startScrollTop };
    const virtDelta = (deltaY / trackTravel) * virtMaxScroll;
    const raw = startScrollTop + virtDelta;
    return { next: Math.max(0, Math.min(maxScroll, raw)), raw };
  };

  const onSbThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = parentRef.current;
    if (!el) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    scrollbarHeldRef.current = true;
    lockScrollGeometry();
    sbDragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startScrollTop: el.scrollTop,
    };
  };

  const onSbThumbPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = sbDragRef.current;
    const el = parentRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !el) return;
    noteUserScroll();
    const deltaY = e.clientY - drag.startY;
    const before = el.scrollTop;
    const { next, raw } = mapThumbDeltaToScrollTop(drag.startScrollTop, deltaY);
    el.scrollTop = next;
    // Thumb dragged further into fill while already at the hard stop.
    const towardFill = liveEdge === 'top' ? deltaY < 0 : deltaY > 0;
    // Pulled past the fill stop with a backlog waiting: the overhang is the
    // part of the drag that asks for backlog rows — feed them in steps.
    if (towardFill && backlogFeedActive() && !flushPinRef.current) {
      const settled = settledEdgeScrollTop();
      const overhang = liveEdge === 'top' ? settled - raw : raw - settled;
      if (overhang > 0) {
        engageLiveTowardNewer(liveEdge === 'top' ? -overhang : overhang);
      }
    }
    if (
      isManualPause
      && towardFill
      && before === next
      && fillRubberFullyVisible()
      && !fillPauseSbPulsedRef.current
    ) {
      fillPauseSbPulsedRef.current = true;
      pulseFillPauseLabels();
    }
  };

  const onSbThumbPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = sbDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    sbDragRef.current = null;
    fillPauseSbPulsedRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    // Global pointerup listener also clears scrollbarHeldRef + rubber/unlock.
  };

  const onSbTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const el = parentRef.current;
    const thumb = sbThumbRef.current;
    if (!el || !thumb || thumb.clientHeight <= 0) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const thumbTop = thumb.offsetTop;
    const thumbHeight = thumb.offsetHeight;
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    if (maxScroll <= 0) return;
    noteUserScroll();
    // Page toward the click; keep real scroll range (no virtual backlog travel).
    // A page toward the fill from the live edge feeds the backlog like PageUp/Down.
    const before = el.scrollTop;
    if (y < thumbTop) {
      // Arm before the native move so the anchor is captured at rest.
      if (liveEdge === 'top' && backlogFeedActive()) engageLiveTowardNewer(-el.clientHeight);
      el.scrollTop = Math.max(0, el.scrollTop - el.clientHeight);
      if (isManualPause && liveEdge === 'top' && before === el.scrollTop && fillRubberFullyVisible()) {
        pulseFillPauseLabels();
      }
    } else if (y > thumbTop + thumbHeight) {
      if (liveEdge === 'bottom' && backlogFeedActive()) engageLiveTowardNewer(el.clientHeight);
      el.scrollTop = Math.min(maxScroll, el.scrollTop + el.clientHeight);
      if (isManualPause && liveEdge === 'bottom' && before === el.scrollTop && fillRubberFullyVisible()) {
        pulseFillPauseLabels();
      }
    }
  };

  useLayoutEffect(() => {
    syncOverlayScrollbar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pausedCount, telegramRows.length, virtTotalPx, oppositeSpacerPx, liveEdge, fillRubberPx, viewportHeight]);

  const handleScroll = () => {
    // Labels track fill visibility even for programmatic rubber/settle scrolls.
    syncFillPauseLabels();
    syncOverlayScrollbar();
    // Ignore the scrolls our own compensation triggers.
    if (programmaticScrollRef.current || refindingAnchorRef.current) return;
    // A pending backlog step owns the anchor until its rows land: the native
    // scroll of the gesture that armed it must not re-anchor or re-follow.
    if (flushPinRef.current) return;
    markCursorRef.current = null;
    releaseStickySpacerIfFits();
    if (inOppositeRubberZone() || inFillRubberBand() || scrollbarHeldRef.current) {
      lockScrollGeometry();
    } else {
      unlockScrollGeometryIfSettled();
    }
    if (inFillRubberBand() || inOppositeRubberZone()) scheduleRubberBand();
    if (inFillRubberZone() && backlogFeedActive()) {
      // The empty fill slot is on screen with a backlog waiting: fill it.
      engageLiveTowardNewer(0);
      return;
    }
    const newestVisible = newestFullyVisible();

    if (detachedFromEdgeRef.current) {
      // Stay unfollowed until newest has left full visibility at least once.
      // Flush is fill-axis-only (engageLiveTowardNewer), never from scroll alone.
      if (!newestVisible) {
        detachedFromEdgeRef.current = false;
        atEdgeRef.current = false;
      }
      captureAnchor();
      return;
    }

    // Returning to the newest row re-follows — unless a backlog waits, which
    // would flush all at once; it is fed in by fill-axis gestures instead.
    if (newestVisible && !isManualPause && !backlogFeedActive()) {
      enableLiveFollow();
      return;
    }

    if (atEdgeRef.current) {
      atEdgeRef.current = false;
      setFollowingLive(false);
      onListFollowChange?.(false);
      detachedFromEdgeRef.current = true;
    }
    captureAnchor();
  };

  // Clicking a row (a) marks it (#310) and (b) pauses live-following just like
  // scrolling away (#266) — the row being read must not move. The jump-to-live
  // pill is the way back.
  const handleRowClick = (e: React.MouseEvent, key: string, index: number) => {
    // ── Marks (#310) ──
    const additive = e.ctrlKey || e.metaKey;
    const range = e.shiftKey;
    if (additive || range) {
      // A modified click must not also start a native text selection.
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
    }

    let nextKeys: string[];
    if (range) {
      // Range over the current visible order, from the last-clicked row to here.
      const anchorIdx = lastMarked ? telegramRows.findIndex(r => anchorKey(r) === lastMarked) : -1;
      let rangeKeys: string[];
      if (anchorIdx === -1) {
        rangeKeys = [key]; // no usable anchor → just this row
      } else {
        const lo = Math.min(anchorIdx, index);
        const hi = Math.max(anchorIdx, index);
        rangeKeys = telegramRows.slice(lo, hi + 1).map(r => anchorKey(r));
      }
      nextKeys = additive ? [...new Set([...markedKeysList, ...rangeKeys])] : rangeKeys;
    } else if (additive) {
      // Toggle this row, keeping the rest.
      nextKeys = markedSet.has(key) ? markedKeysList.filter(k => k !== key) : [...markedKeysList, key];
    } else {
      // Plain click replaces the whole set.
      nextKeys = [key];
    }
    setMarkedKeysList(nextKeys);
    setLastMarked(key);
    markCursorRef.current = key;
    // Not yet in selectedKeyRef — that follows the state update above.
    const selectedKey = nextKeys.includes(key) ? key : null;

    // ── Pause live-following on an edge click (#266), unchanged ──
    if (isTimeSort && atEdgeRef.current) {
      atEdgeRef.current = false;
      detachedFromEdgeRef.current = true;
      setFollowingLive(false);
      onListFollowChange?.(false);
    }
    // Hold the clicked row still from here on (#435).
    if (!atEdgeRef.current) captureAnchor(selectedKey);
  };

  const scrollToEdge = () => {
    cancelRubberBand();
    markProgrammatic();
    const el = parentRef.current;
    if (!el) return;
    // Settled edge: edge telegram flush with the viewport — not into fill rubber.
    el.scrollTop = settledEdgeScrollTop();
  };

  const jumpToLive = () => {
    // Pill path wants the jump to the merged newest — not a seamless pin.
    flushPinRef.current = false;
    pendingFlushScrollDeltaRef.current = null;
    revealRef.current = null;
    setStickyOppositeSpacerPx(0);
    jumpToLiveRef.current = true;
    enableLiveFollow();
    onJumpToLive?.();
    scrollToEdge();
  };

  // Scrolls to a specific row by index and stops live-following, so the
  // viewed rows stay put while new ones accumulate. Used by "quick goto time"
  // and the quick info bar's click-to-jump metrics (#282, #311).
  const gotoIndex = (idx: number) => {
    if (idx < 0 || idx >= telegramRows.length) return;
    atEdgeRef.current = false;
    detachedFromEdgeRef.current = true;
    setFollowingLive(false);
    onListFollowChange?.(false);
    // The old anchor is about to leave the rendered window on purpose.
    anchorRef.current = null;
    markProgrammatic();
    virtualizer.scrollToIndex(idx, { align: 'center' });
    // Pin the row we land on once the virtualizer has settled the scroll (rows
    // are dynamically measured, so give it two frames before capturing).
    requestAnimationFrame(() => requestAnimationFrame(() => {
      captureAnchor();
      atEdgeRef.current = false;
      detachedFromEdgeRef.current = true;
      setFollowingLive(false);
      onListFollowChange?.(false);
    }));
  };

  // Jump between marked rows (#442), in display order and wrapping around. The
  // starting point is the mark last jumped to or clicked; once the user scrolls
  // away it is whatever row sits in the middle of the viewport instead.
  const markedIndices = useMemo(() => {
    if (markedSet.size === 0) return [];
    const out: number[] = [];
    telegramRows.forEach((r, i) => { if (markedSet.has(anchorKey(r))) out.push(i); });
    return out;
  }, [telegramRows, markedSet]);

  const viewportCenterIndex = () => {
    const el = parentRef.current;
    if (!el) return 0;
    const center = el.scrollTop + el.clientHeight / 2;
    const item = virtualizer.getVirtualItems().find(v => v.start <= center && center < v.end);
    return item ? item.index : 0;
  };

  const jumpToMark = (dir: 1 | -1) => {
    if (markedIndices.length === 0) return;
    const cursor = markCursorRef.current;
    const cursorIdx = cursor ? telegramRows.findIndex(r => anchorKey(r) === cursor) : -1;
    const from = cursorIdx !== -1 ? cursorIdx : viewportCenterIndex();
    const target = adjacentMark(markedIndices, from, dir);
    markCursorRef.current = anchorKey(telegramRows[target]);
    gotoIndex(target);
  };

  // "Quick goto time" (#282): jump to the telegram nearest a given time. Only
  // meaningful for the timestamp sort, where rows are ordered by time — the
  // info bar's jumps use gotoIndex directly since they already know the index.
  const gotoTime = (targetMs: number) => {
    const rows = telegramRows;
    if (!isTimeSort || rows.length === 0) return;
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < rows.length; i++) {
      const diff = Math.abs(new Date(rows[i].timestamp).getTime() - targetMs);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    gotoIndex(bestIdx);
  };

  // Newest telegram time, used to seed the goto-time input.
  const newestMs = telegramRows.length > 0
    ? new Date(telegramRows[liveEdge === 'top' ? 0 : telegramRows.length - 1].timestamp).getTime()
    : null;

  // Correct scrollTop so the anchored row keeps its recorded viewport offset.
  const pinAnchor = () => {
    const el = parentRef.current;
    const anchor = anchorRef.current;
    if (!el || !anchor || atEdgeRef.current) return;
    const now = rowOffset(anchor.key);
    if (now == null) {
      // Not rendered. Either the user jumped far away (scrollbar drag) and
      // the scroll handler has not caught up — then the anchor is stale and
      // whatever is on screen now takes over. Or so many rows arrived that the
      // anchor left the virtualized window: it is still in the list, so have
      // the virtualizer bring it back (it copes with unmeasured rows) and then
      // restore its offset.
      if (refindingAnchorRef.current) return;
      // A changed row list means rows were inserted, even while the user's
      // gesture that triggered the flush still counts as scrolling. Only an
      // unchanged list with a missing anchor is the user having jumped away.
      const rowsChanged = anchorRowsRef.current !== telegramRows;
      const inserted = rowsChanged || !userScrolling();
      const idx = inserted ? telegramRows.findIndex(r => anchorKey(r) === anchor.key) : -1;
      if (idx === -1) {
        captureAnchor();
        return;
      }
      // Place the anchor from the virtualizer's layout right now, before paint:
      // an async scrollToIndex would flash the live edge first. Estimates for
      // unmeasured rows are corrected by the virtualizer's own first-measure
      // adjustment and the totalSize pin that follows.
      const start = virtualizer.measurementsCache[idx]?.start
        ?? virtualizer.getOffsetForIndex(idx, 'start')?.[0];
      if (start != null) {
        const max = Math.max(0, el.scrollHeight - el.clientHeight);
        markProgrammatic();
        el.scrollTop = Math.min(max, Math.max(0, start - anchor.offset));
        anchorRowsRef.current = telegramRows;
        refindingAnchorRef.current = true;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          refindingAnchorRef.current = false;
          if (anchorRef.current !== anchor) return;
          const found = rowOffset(anchor.key);
          if (found == null) captureAnchor();
          else if (Math.abs(found - anchor.offset) > 0.5) {
            markProgrammatic();
            el.scrollTop += found - anchor.offset;
          }
        }));
        return;
      }
      refindingAnchorRef.current = true;
      virtualizer.scrollToIndex(idx, { align: 'start' });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const found = rowOffset(anchor.key);
        if (found != null && anchorRef.current === anchor) {
          el.scrollTop += found - anchor.offset;
          anchorRowsRef.current = telegramRowsRef.current;
        }
        // One more frame for the scroll event to pass before tracking resumes.
        requestAnimationFrame(() => {
          refindingAnchorRef.current = false;
          if (found == null) captureAnchor();
          else pinAnchor();
        });
      }));
      return;
    }
    if (refindingAnchorRef.current) return;
    const delta = now - anchor.offset;
    if (Math.abs(delta) > 0.5) {
      markProgrammatic();
      el.scrollTop += delta;
    }
    anchorRowsRef.current = telegramRows;
  };

  // Changing sort moves (or removes) the live edge — drop the anchor state.
  // Skipped on mount: this effect and the restore-on-mount effect below both
  // run in the same commit, in declaration order, and the DOM has zero
  // scrollTop before either has scrolled anywhere — so without this guard,
  // checkAtEdge() always reads "at edge" here first and clobbers a restored
  // anchor (e.g. a cross-panel goto, #308) before it ever gets applied.
  const sortEffectMounted = useRef(false);
  useEffect(() => {
    if (!sortEffectMounted.current) {
      sortEffectMounted.current = true;
      // Undo the flag on cleanup so StrictMode's dev-only double-invoke
      // (mount → cleanup → mount) still skips on both simulated mounts,
      // instead of treating the second one as a real sortConfig change.
      return () => { sortEffectMounted.current = false; };
    }
    setStripeOffset(0);
    anchorRef.current = null;
    onListAnchorKeyChange?.(null);
    const atEdge = checkAtEdge();
    if (atEdge !== atEdgeRef.current) {
      atEdgeRef.current = atEdge;
      setFollowingLive(atEdge);
      onListFollowChange?.(atEdge);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortConfig]);

  // Restore scroll position/anchor on mount (#203, #341)
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || telegramRows.length === 0) return;
    restoredRef.current = true;

    if (atEdgeRef.current) {
      scrollToEdge();
    } else if (listAnchorKey) {
      const idx = telegramRows.findIndex(t => anchorKey(t) === listAnchorKey);
      if (idx !== -1) {
        markProgrammatic();
        virtualizer.scrollToIndex(idx, { align: 'start' });
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const offset = rowOffset(listAnchorKey);
          if (offset != null) {
            anchorRef.current = { key: listAnchorKey, offset };
            pinAnchor();
          }
        }));
      } else {
        jumpToLive();
      }
    } else {
      scrollToEdge();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegramRows.length]);

  // Write-to-bus last value: center that telegram. Mark it only when the exact
  // telegram survived the current filters; otherwise land on the nearest row
  // at that time and leave the marks alone.
  const appliedGotoId = useRef<number | null>(null);
  useEffect(() => {
    if (!gotoRequest || appliedGotoId.current === gotoRequest.id) return;
    if (telegramRows.length === 0) return;
    appliedGotoId.current = gotoRequest.id;
    const key = anchorKey(gotoRequest.telegram);
    const idx = telegramRows.findIndex(t => anchorKey(t) === key);
    if (idx !== -1) {
      gotoIndex(idx);
      setMarkedKeysList([key]);
      setLastMarked(key);
      markCursorRef.current = key;
      return;
    }
    const ms = new Date(gotoRequest.telegram.timestamp).getTime();
    if (!Number.isNaN(ms)) gotoTime(ms);
    // gotoIndex/gotoTime close over the rows of this render; appliedGotoId
    // keeps a later row update from jumping again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gotoRequest, telegramRows]);

  // React to list updates before paint: follow the live edge, or pin the
  // anchored row by correcting scrollTop by its real pixel shift.
  // Pause-buffer flush (isPaused true→false): always keep the viewport still
  // via pinAnchor — never scrollToEdge. A toward-newer gesture may then apply
  // its delta into the merged buffer so the pause rows blend in seamlessly.
  const prevRowsRef = useRef<{ firstKey: string | null; lastKey: string | null; len: number }>({
    firstKey: null, lastKey: null, len: 0,
  });
  const wasPausedRef = useRef(!!isPaused);
  /**
   * Apply the gesture delta held since the flush was armed. Returns the part
   * the scroll range clamped away (0 when it fit). The anchor is re-captured
   * at the new position, so later pins (remeasure, totalSize) hold it there
   * instead of undoing the gesture.
   */
  const applyPendingFlushScroll = (): number => {
    const delta = pendingFlushScrollDeltaRef.current;
    if (delta == null) return 0;
    pendingFlushScrollDeltaRef.current = null;
    const el = parentRef.current;
    if (!el) return 0;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const before = el.scrollTop;
    const target = Math.min(max, Math.max(0, before + delta));
    if (target === before) return delta;
    markProgrammatic();
    el.scrollTop = target;
    const applied = el.scrollTop - before;
    if (applied !== 0) {
      // Keep the (already measured) anchor row, at its new offset. Capturing a
      // freshly inserted row instead would pin an estimate: its remeasure then
      // shifts everything below it.
      const anchor = anchorRef.current;
      const now = anchor ? rowOffset(anchor.key) : null;
      if (anchor && now != null) anchorRef.current = { key: anchor.key, offset: now };
      else captureAnchor(null, { ignoreSelection: true });
    }
    return delta - applied;
  };
  const pinFlushViewport = () => {
    atEdgeRef.current = false;
    if (!anchorRef.current) captureAnchor(null, { ignoreSelection: true });
    pinAnchor();
  };
  /**
   * After a metered step landed: top the slice up while the fill slot is still
   * on screen (gesture outran the rows, or every revealed row was filtered
   * out). Returns true when another step was requested.
   */
  const continueRevealIfSlotOpen = (leftover: number, rowsLanded: boolean): boolean => {
    if (!backlogFeedActive()) return false;
    const el = parentRef.current;
    if (!el) return false;
    const overshoot = Math.abs(el.scrollTop - settledEdgeScrollTop());
    if (rowsLanded && !inFillRubberZone() && leftover === 0) return false;
    // Nothing visible came of the last slice: widen it so a filtered backlog
    // does not need one render per row.
    const prevN = revealRef.current?.n ?? 1;
    const n = rowsLanded
      ? revealCountFor(overshoot + Math.abs(leftover))
      : Math.max(1, Math.min(pausedCount, prevN * 2, REVEAL_MAX));
    requestReveal(leftover, n);
    return true;
  };
  useLayoutEffect(() => {
    const rows = telegramRows;
    const prev = prevRowsRef.current;
    const firstKey = rows.length > 0 ? anchorKey(rows[0]) : null;
    const lastKey = rows.length > 0 ? anchorKey(rows[rows.length - 1]) : null;
    prevRowsRef.current = { firstKey, lastKey, len: rows.length };

    const flushing = wasPausedRef.current && !isPaused;
    wasPausedRef.current = !!isPaused;
    const jumpingToLive = jumpToLiveRef.current;
    const pinArmed =
      !jumpingToLive
      && (flushing || flushPinRef.current || pendingFlushScrollDeltaRef.current != null);
    // A metered slice has landed when the backlog shrank since it was asked for.
    const reveal = revealRef.current;
    const revealLanded = reveal != null && pausedCount < reveal.before;
    const finishFlush = () => {
      flushPinRef.current = false;
      revealRef.current = null;
      syncFollowFromNewestVisibility();
      releaseStickySpacerIfFits();
    };

    if (rows.length === 0) setStripeOffset(0);
    if (isTimeSort && prev.len === 0 && rows.length > 0 && restoredRef.current) {
      // First rows after the list was emptied (buffer clear): the mount-time
      // restore does not run again, so scrollTop still sits at 0 — inside the
      // fill padding. Settle on the edge telegram when following or jumping,
      // otherwise the spacer stays on screen until the next telegram arrives.
      if (jumpToLiveRef.current || atEdgeRef.current) {
        jumpToLiveRef.current = false;
        atEdgeRef.current = true;
        setStripeOffset(0);
        scrollToEdge();
      }
      return;
    }
    if (!isTimeSort || prev.len === 0 || rows.length === 0) return;

    const edgeKey = liveEdge === 'top' ? firstKey : lastKey;
    const prevEdgeKey = liveEdge === 'top' ? prev.firstKey : prev.lastKey;
    if (!prevEdgeKey || edgeKey === prevEdgeKey) {
      if (jumpingToLive) {
        // Wait for the pause buffer to merge; keep the jump arm.
        return;
      }
      if (pinArmed && revealLanded) {
        // The slice landed but no row of it is visible (all filtered out):
        // ask for the next one, or settle the gesture if the backlog is gone.
        if (continueRevealIfSlotOpen(pendingFlushScrollDeltaRef.current ?? 0, false)) return;
        pinFlushViewport();
        applyPendingFlushScroll();
        finishFlush();
        return;
      }
      if (pinArmed) {
        // Intermediate unpause before rows merge — pin only; keep flush arm.
        pinFlushViewport();
      }
      return;
    }

    let added = -1;
    if (liveEdge === 'top') {
      for (let i = 0; i < rows.length; i++) if (anchorKey(rows[i]) === prevEdgeKey) { added = i; break; }
    } else {
      for (let i = rows.length - 1; i >= 0; i--) if (anchorKey(rows[i]) === prevEdgeKey) { added = rows.length - 1 - i; break; }
    }

    if (added <= 0) {
      // The previous edge row is gone — the list was replaced or refiltered
      // (e.g. Time-Delta-Context switched off). Keep holding the anchor if its
      // row survived (#435); otherwise start over.
      const anchor = anchorRef.current;
      if (anchor && rows.some(r => anchorKey(r) === anchor.key)) {
        setStripeOffset(0);
        pinAnchor();
        return;
      }
      if (jumpingToLive) {
        jumpToLiveRef.current = false;
        setStripeOffset(0);
        scrollToEdge();
        return;
      }
      if (oppositeRubberBusy()) {
        setStripeOffset(0);
        return;
      }
      if (pinArmed) {
        setStripeOffset(0);
        pinFlushViewport();
        return;
      }
      anchorRef.current = null;
      onListAnchorKeyChange?.(null);
      setStripeOffset(0);
      return;
    }

    const dropped = prev.len + added - rows.length;
    const indexShift = liveEdge === 'top' ? added : -dropped;
    setStripeOffset(o => (((o + indexShift) % 2) + 2) % 2);

    if (jumpingToLive) {
      jumpToLiveRef.current = false;
      atEdgeRef.current = true;
      scrollToEdge();
      return;
    }

    // Opposite rubber always finishes — ahead of pause-flush pin/delta.
    if (oppositeRubberBusy()) {
      return;
    }

    if (pinArmed) {
      // Seamless flush: pin + gesture delta only — never scrollToEdge.
      // Follow only if newest is still fully visible after the delta (user
      // landed on the live edge); a mid-backlog delta must not snap to edge.
      const el = parentRef.current;
      const beforePin = el?.scrollTop ?? 0;
      pinFlushViewport();
      // A held scrollbar thumb maps from the drag's start scrollTop: rows
      // inserted before it shift that origin by the pin.
      if (el && sbDragRef.current && liveEdge === 'top') {
        sbDragRef.current.startScrollTop += el.scrollTop - beforePin;
      }
      const leftover = applyPendingFlushScroll();
      if (revealLanded && continueRevealIfSlotOpen(leftover, true)) return;
      finishFlush();
      return;
    }

    // Live prepend: only show the new row. Leave spacer / rubber / scrollTop alone
    // while overscrolled or mid-animation (no scrollToEdge, pin, or cancel).
    if (rubberAnimRef.current || inFillRubberZone() || inOppositeRubberZone()) {
      return;
    }

    if (atEdgeRef.current) {
      scrollToEdge();
      return;
    }

    pinAnchor();
    // pausedCount: a metered slice may land without changing the row list
    // (every revealed row filtered out) and still needs to be continued.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegramRows, isPaused, pausedCount]);

  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    // Do not fight rubber overscroll / animation when rows remeasure / prepend.
    if (rubberAnimRef.current || inFillRubberBand() || inOppositeRubberZone()) return;
    pinAnchor();
    // Remeasured (shorter) rows can leave the fill slot open again while a
    // backlog waits: fill it rather than showing blank padding. Not before the
    // mount-time restore has placed the viewport (scrollTop is 0 until then).
    if (restoredRef.current && !flushPinRef.current && inFillRubberZone() && backlogFeedActive()) {
      engageLiveTowardNewer(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalSize]);

  // The opposite spacer sits above the rows when the live edge is at the
  // bottom: a change in its height (short-list pad, sticky release) shifts
  // every row, so hold the anchor across it.
  useLayoutEffect(() => {
    if (liveEdge !== 'bottom') return;
    if (rubberAnimRef.current || inFillRubberBand() || inOppositeRubberZone()) return;
    pinAnchor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppositeSpacerPx]);

  // Manual → auto pause while the fill spacer is on screen: the held spacer
  // becomes the slot for the oldest backlog telegram, which slides in next to
  // the edge row without moving it. The rest stays in the pause buffer and is
  // fed in line by line as the user keeps scrolling toward the live edge.
  const prevManualPauseRef = useRef(isManualPause);
  useLayoutEffect(() => {
    const wasManual = prevManualPauseRef.current;
    prevManualPauseRef.current = isManualPause;
    if (!wasManual || isManualPause) return;
    if (flushPinRef.current || !isTimeSort) return;
    if (!inFillRubberZone() || !backlogFeedActive()) return;
    if (!oppositeRubberBusy()) cancelRubberBand();
    atEdgeRef.current = false;
    armMeteredReveal(0, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManualPause]);

  // Visible columns in order, and the matching CSS grid template.
  // The delta column is always shown when enabled, regardless of sort (#311) —
  // it's computed from the visible row order under any sort hierarchy.
  const visibleCols = useMemo(
    () => columnOrder
      .map(id => COLUMNS.find(c => c.id === id)!)
      .filter(c => !c.visibleKey || visibleColumns[c.visibleKey]),
    [visibleColumns, columnOrder],
  );

  const gridTemplate = useMemo(
    () => visibleCols
      .map((c, i) => {
        const w = widthFor(c.id);
        // Final column absorbs remaining horizontal space.
        return i === visibleCols.length - 1 ? `minmax(${w}px, 1fr)` : `${w}px`;
      })
      .join(' '),
    [visibleCols, widthFor],
  );

  // Multi-level sort indicator (#311): the chevron shows this column's own
  // direction; a small numbered badge additionally marks its position in the
  // hierarchy once more than one level is active (ctrl/cmd-click adds levels).
  const renderSortArrow = (key: SortKey) => {
    const idx = sortConfig.findIndex(l => l.key === key);
    if (idx === -1) return null;
    const icon = sortConfig[idx].direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
    if (sortConfig.length <= 1) return icon;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
        {icon}
        <span
          title={`Sort level ${idx + 1} of ${sortConfig.length}`}
          style={{
            fontSize: '0.6rem', fontWeight: 700, minWidth: '1rem', textAlign: 'center',
            padding: '0 0.2rem', borderRadius: '3px', background: 'var(--bg-tag)', color: 'var(--text-dim)',
          }}
        >
          {idx + 1}
        </span>
      </span>
    );
  };

  // ── Per-cell body content (keyed switch keeps body aligned with header order) ──
  const renderCell = (id: ColId, t: TelegramRow): React.ReactNode => {
    switch (id) {
      case 'time':
        return (
          <div className={TT.cell}>
            <div className={`${TT.time} mono-addr`}>
              {format(new Date(t.timestamp), 'HH:mm:ss.SS')}
            </div>
            <div className={`${TT.timeDate} subtitle-name`}>
              {format(new Date(t.timestamp), 'yyyy-MM-dd')}
            </div>
          </div>
        );

      case 'delta': {
        const key = anchorKey(t);
        const flagged = anchorsContext(key);
        return (
          <div className={`${TT.cell} ${TT.deltaRow}`}>
            <button
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.15rem',
                borderRadius: '4px', display: 'flex', alignItems: 'center', flexShrink: 0,
                color: flagged ? 'var(--accent-primary)' : 'var(--text-dim)',
                opacity: activeFilters.deltaContextEnabled ? (flagged ? 1 : 0.35) : 0.25,
              }}
              title={flagged
                ? 'Context is shown around this message — click to switch it off for this message (ctrl/cmd-click to apply to all marked rows)'
                : 'Show context around this message, regardless of the active filters (ctrl/cmd-click to apply to all marked rows)'}
              onClick={e => handleFlagClick(e, key)}
            >
              {flagged ? <CircleDot size={12} /> : <Circle size={12} />}
            </button>
            {t.deltaStr && (
              <div className={`${TT.delta} mono-addr`}>
                {t.deltaStr}
              </div>
            )}
          </div>
        );
      }

      case 'source':
        return (
          <div className={`${TT.cell} filterable-cell`} style={{ minWidth: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
              <div className={`${TT.addr} ${TT.addrSource} mono-addr highlight`}>
                {t.source_address}
              </div>
              <button
                className={`quick-filter-btn ${activeFilters.sources.includes(t.source_address) ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); onQuickFilter('sources', t.source_address); }}
                title="Toggle source filter"
              >
                <Filter className="filter-icon" size={12} />
                <X className="cancel-icon" size={12} />
              </button>
              {onQuickLastSeen && (
                <button
                  className="quick-last-seen-btn"
                  onClick={(e) => { e.stopPropagation(); onQuickLastSeen(t.source_address, 'pa'); }}
                  title="Show last seen values for this device"
                >
                  <Clock size={12} />
                </button>
              )}
            </div>
            {visibleColumns.sourceName && (
              <div className={`${TT.subtitle} subtitle-name`} title={t.source_name || undefined}>
                {t.source_name || '-'}
              </div>
            )}
          </div>
        );

      case 'target':
        return (
          <div className={`${TT.cell} filterable-cell`} style={{ minWidth: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
              <div className={`${TT.addr} ${TT.addrTarget} mono-addr highlight-target`}>
                {t.target_address}
              </div>
              <button
                className={`quick-filter-btn ${activeFilters.targets.includes(t.target_address) ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); onQuickFilter('targets', t.target_address); }}
                title="Toggle target filter"
              >
                <Filter className="filter-icon" size={12} />
                <X className="cancel-icon" size={12} />
              </button>
              {onQuickLastSeen && (
                <button
                  className="quick-last-seen-btn"
                  onClick={(e) => { e.stopPropagation(); onQuickLastSeen(t.target_address, 'ga'); }}
                  title="Show last seen values for this GA"
                >
                  <Clock size={12} />
                </button>
              )}
              {canSend && (
                <SendToGaPopover
                  address={t.target_address}
                  name={t.target_name}
                  dptMain={t.dpt_main}
                  dptSub={t.dpt_sub}
                  triggerId={anchorKey(t)}
                  buttonClassName="quick-send-btn"
                  suppressTriggerFocus
                  onGotoTelegram={onGotoTelegram}
                  latestTelegram={latestTelegram}
                  onAltSend={onAltSend}
                  onCtrlSend={onCtrlSend}
                  panelMatched={Boolean(
                    t.target_address && sendPanelAddresses?.has(t.target_address),
                  )}
                  jobActive={Boolean(
                    t.target_address && activeSendJobAddresses?.has(t.target_address),
                  )}
                  linkedStatus={linkedStatus}
                  onScheduleCommit={onScheduleCommit}
                  onWriteWithSchedule={onWriteWithSchedule}
                  onReadWithSchedule={onReadWithSchedule}
                  onCancelLinked={onCancelLinked}
                  onClearLinked={onClearLinked}
                />
              )}
            </div>
            {visibleColumns.targetName && (
              <div
                className={`${TT.subtitle} ${TT.subtitleTargetName} subtitle-name`}
                title={t.target_name || undefined}
              >
                {t.target_name || '-'}
              </div>
            )}
          </div>
        );

      case 'type':
        return (
          <div className={`${TT.cell} filterable-cell`} style={{ minWidth: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
              <EventTypeLabel
                kind={t.simplified_type || t.telegram_type || ''}
                answered={t.simplified_type === 'Read' && answeredReads.has(`${t.timestamp}|${t.target_address}`)}
                className={ttTypeClass(
                  t.simplified_type,
                  t.simplified_type === 'Read' && answeredReads.has(`${t.timestamp}|${t.target_address}`),
                )}
              />
              <button
                className={`quick-filter-btn ${activeFilters.types.includes(t.simplified_type || t.telegram_type) ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); onQuickFilter('types', t.simplified_type || t.telegram_type); }}
                title="Toggle type filter"
              >
                <Filter className="filter-icon" size={12} />
                <X className="cancel-icon" size={12} />
              </button>
            </div>
            <div className={ttDirectionClass(t.direction)}>
              {t.direction === 'Outgoing' ? 'Outgoing' : 'Incoming'}
            </div>
          </div>
        );

      case 'dpt':
        return (
          <div className={`${TT.cell} filterable-cell`} style={{ minWidth: 0, overflow: 'hidden' }}>
            {t.dpt_name && t.dpt_main != null ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                <div title={getDPTLabel(t.dpt_main)} className={ttDptDotClass(t.dpt_main)} />
                <span title={t.dpt_name ?? undefined} className={TT.dpt}>{t.dpt_name}</span>
                <button
                  className={`quick-filter-btn ${activeFilters.dpts.includes(dptKey(t.dpt_main, t.dpt_sub)) ? 'active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); if (t.dpt_main != null) onQuickFilter('dpts', dptKey(t.dpt_main, t.dpt_sub)); }}
                  title="Toggle DPT filter"
                >
                  <Filter className="filter-icon" size={12} />
                  <X className="cancel-icon" size={12} />
                </button>
              </div>
            ) : '-'}
          </div>
        );

      case 'value':
        return (
          <div className={`${TT.cell} filterable-cell`}>
            <div className={TT.valueRow}>
              <BusValueText
                value={t}
                dpt={formatDpt(t.dpt_main, t.dpt_sub)}
                as="span"
              />
              <button
                className="quick-visualize-btn"
                onClick={(e) => { e.stopPropagation(); onQuickVisualize(t.target_address); }}
                title="Visualize this target"
              >
                <LineChart size={14} />
              </button>
            </div>
            {visibleColumns.data && t.raw_hex && (
              <div style={{ marginTop: '0.4rem' }}>
                <BusValueText
                  value={t}
                  dpt={formatDpt(t.dpt_main, t.dpt_sub)}
                  as="span"
                  defaultShowHex
                />
              </div>
            )}
          </div>
        );
    }
  };

  const infoChipStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
    background: 'var(--bg-tag)', border: '1px solid var(--border-subtle)', borderRadius: '4px',
    padding: '0.15rem 0.45rem', fontSize: '0.68rem', color: 'var(--text-dim)',
  };
  const infoChipBtnStyle: React.CSSProperties = {
    ...infoChipStyle, cursor: 'pointer', background: 'transparent',
  };

  // Refresh the visible index range, then count telegrams strictly newer than
  // the newest one inside it. Overscan rows are rendered but not on screen.
  // A range computed while every row still has size 0 is meaningless: the
  // virtualizer's binary search treats every start offset as equal and lands
  // on an arbitrary middle index.
  const virtualItems = virtualizer.getVirtualItems();
  const visibleRange = virtualizer.range;
  let newerCount = 0;
  const rangeMeasured = virtualItems.some(item => item.size > 0);
  if (isTimeSort && visibleRange && rangeMeasured && telegramRows.length > 0 && virtualizer.getTotalSize() > 0) {
    const start = Math.max(0, visibleRange.startIndex);
    const end = Math.min(telegramRows.length - 1, visibleRange.endIndex);
    if (end >= start) {
      let newest = -Infinity;
      for (let i = start; i <= end; i++) {
        const ms = timeMs(telegramRows[i].timestamp);
        if (ms > newest) newest = ms;
      }
      newerCount = countNewerThan(telegramRows, newest, liveEdge === 'bottom');
    }
  }
  // Fold pausedCount always (0 when not frozen). Across a pause-buffer flush the
  // measured count can briefly drop to 0 — keep sticky only for that unpause
  // frame or while the virtualizer is unmeasured. Show the pill whenever there
  // is a backlog, including manual pause while live-follow is still on.
  // Empty list: no sticky phantom (e.g. after buffer clear); pausedCount alone
  // may still show real unpublished arrivals.
  const rawNewerCount = newerCount + pausedCount;
  const justUnpaused = wasPausedRef.current && !isPaused;
  if (telegramRows.length === 0) {
    stickyNewerCountRef.current = 0;
  } else if (rawNewerCount > 0) {
    stickyNewerCountRef.current = rawNewerCount;
  } else if (followingLive || (rangeMeasured && !justUnpaused)) {
    stickyNewerCountRef.current = 0;
  }
  const displayNewerCount = rawNewerCount > 0
    ? rawNewerCount
    : (telegramRows.length > 0 && (!rangeMeasured || justUnpaused) ? stickyNewerCountRef.current : 0);

  return (
    <div data-telegram-table style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <SendToGaHost
        latestTelegram={latestTelegram}
        onGotoTelegram={onGotoTelegram}
        captureListScroll={captureListScroll}
        restoreListScroll={restoreListScroll}
        linkedStatus={linkedStatus}
        gaJobStatuses={gaJobStatuses}
        onScheduleCommit={onScheduleCommit}
        onWriteWithSchedule={onWriteWithSchedule}
        onReadWithSchedule={onReadWithSchedule}
        onCancelLinked={onCancelLinked}
        onClearLinked={onClearLinked}
        onAltSend={onAltSend}
        onCtrlSend={onCtrlSend}
      >
      {/* Quick info bar (#311): collapsible summary directly above the header. */}
      {infoOpen && infoMetrics && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: '0.3rem',
          padding: '0.4rem 0.75rem', borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-subtle)', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
            <button
              style={infoChipBtnStyle} title="Jump to the oldest telegram in the current view"
              onClick={() => gotoIndex(infoMetrics.oldestIdx)}
            >
              Oldest: {format(new Date(telegramRows[infoMetrics.oldestIdx].timestamp), 'yyyy-MM-dd HH:mm:ss.SS')}
            </button>
            <button
              style={infoChipBtnStyle} title="Jump to the newest telegram in the current view"
              onClick={() => gotoIndex(infoMetrics.newestIdx)}
            >
              Newest: {format(new Date(telegramRows[infoMetrics.newestIdx].timestamp), 'yyyy-MM-dd HH:mm:ss.SS')}
            </button>
            {infoMetrics.minDeltaIdx !== -1 && (
              <button
                style={infoChipBtnStyle} title="Jump to the smallest time gap in the current view"
                onClick={() => gotoIndex(infoMetrics.minDeltaIdx)}
              >
                Min Δt: {telegramRows[infoMetrics.minDeltaIdx].deltaStr}
              </button>
            )}
            {infoMetrics.maxDeltaIdx !== -1 && (
              <button
                style={infoChipBtnStyle} title="Jump to the largest time gap in the current view"
                onClick={() => gotoIndex(infoMetrics.maxDeltaIdx)}
              >
                Max Δt: {telegramRows[infoMetrics.maxDeltaIdx].deltaStr}
              </button>
            )}
            {infoMetrics.peak && (
              <button
                style={infoChipBtnStyle} title="Most telegrams within one second in the current view — jump to the start of that burst"
                onClick={() => gotoIndex(infoMetrics.peak!.startIdx)}
              >
                Max rate: {infoMetrics.peak.count}/s
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
            <span style={infoChipStyle}>{infoMetrics.count} telegram{infoMetrics.count !== 1 ? 's' : ''}</span>
            <span style={infoChipStyle}>{infoMetrics.sourceCount} source{infoMetrics.sourceCount !== 1 ? 's' : ''}</span>
            <span style={infoChipStyle}>{infoMetrics.targetCount} target{infoMetrics.targetCount !== 1 ? 's' : ''}</span>
            <span style={infoChipStyle}>{infoMetrics.dptCount} DPT{infoMetrics.dptCount !== 1 ? 's' : ''}</span>
            {infoMetrics.typeCounts.map(([type, n]) => (
              <span key={type} style={infoChipStyle}>{type}: {n}</span>
            ))}
            {infoMetrics.contextCount > 0 && (
              <span style={infoChipStyle} title="Rows shown only as unfiltered Time-Delta-Context, not real filter matches (#343)">
                {infoMetrics.contextCount} context
              </span>
            )}
            <button
              style={infoChipBtnStyle}
              title="Download the telegrams in the current view (all filters applied, in list order) as CSV"
              onClick={() => downloadTelegramsCsv(telegramRows)}
            >
              <Download size={11} /> CSV
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: gridTemplate,
          background: 'var(--bg-panel)',
          zIndex: 10,
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
          color: 'var(--text-dim)',
          fontSize: '0.65rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 700,
          // Account for scrollbar width to keep columns aligned with body
          paddingRight: '8px'
        }}
      >
        {visibleCols.map((c, i) => (
          <div
            key={c.id}
            className={`header-col ${TT.cell}${draggingColumn === c.id ? ' drag-source' : ''}${dropTarget?.id === c.id ? ` drop-${dropTarget.side}` : ''}`}
            style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            draggable
            onMouseDownCapture={e => { dragOriginRef.current = e.target; }}
            onDragStart={e => {
              const origin = dragOriginRef.current;
              if (origin instanceof Element && origin.closest('input, textarea, select, .col-resize-handle')) {
                e.preventDefault();
                return;
              }
              setDraggingColumn(c.id);
              e.dataTransfer.setData('text/plain', c.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={e => {
              if (!draggingColumn || draggingColumn === c.id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const rect = e.currentTarget.getBoundingClientRect();
              const side = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after';
              if (dropTarget?.id !== c.id || dropTarget.side !== side) setDropTarget({ id: c.id, side });
            }}
            onDrop={e => {
              e.preventDefault();
              dropColumn(c.id, dropTarget?.id === c.id ? dropTarget.side : 'before');
            }}
            onDragEnd={endColumnDrag}
          >
            {c.id === 'time' && (
              <button
                className={`quick-filter-bar-toggle ${quickOpen ? 'open' : ''}`}
                onClick={toggleQuickOpen}
                title={quickOpen ? 'Hide quick filter bar' : 'Show quick filter bar'}
              >
                <ListFilter size={13} />
              </button>
            )}
            {c.id === 'time' && (
              <button
                className={`quick-filter-bar-toggle ${infoOpen ? 'open' : ''}`}
                onClick={toggleInfoOpen}
                title={infoOpen ? 'Hide info bar' : 'Show info bar'}
              >
                <Info size={13} />
              </button>
            )}
            {c.id === 'time' && isTimeSort && (
              <GotoTimeControl seedMs={newestMs} onGoto={gotoTime} />
            )}
            {c.id === 'delta' ? (
              <button
                className="sort-header"
                onClick={handleDeltaHeaderClick}
                title={deltaSortActive
                  ? 'Sorted by time delta — click to flip direction; click any other column to return to live order'
                  : 'Sort by time delta (exclusive — pauses live scrolling and freezes the current order)'}
              >
                {c.label} {deltaSortActive && (deltaSortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
              </button>
            ) : c.sortKey ? (
              <button
                className="sort-header"
                onClick={(e) => handleColumnSort(c.sortKey!, { additive: e.ctrlKey || e.metaKey })}
                title="Click to sort · ctrl/cmd-click to add as a further sort level (TIME is always the deepest tiebreaker)"
              >
                {c.label} {renderSortArrow(c.sortKey)}
              </button>
            ) : (
              <span>{c.label}</span>
            )}
            {i < visibleCols.length - 1 && (
              <div
                className="col-resize-handle"
                onMouseDown={(e) => handleResizeStart(e, c)}
                onDoubleClick={() => handleResetWidth(c)}
                title="Drag to resize · double-click to reset"
              />
            )}
          </div>
        ))}
      </div>

      {/* Quick filter bar (#271, #309) — two rows per column: a pattern/from row
          and a text/to row, except TYPE (one row) and DELTA (Time-Delta-Context
          before/after, #371) which don't go through the pattern pipeline. */}
      {quickOpen && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: gridTemplate,
            background: 'var(--bg-subtle)',
            borderBottom: '1px solid var(--border-color)',
            flexShrink: 0,
            paddingRight: '8px', // align with the header's scrollbar compensation
            opacity: quickEnabled ? 1 : 0.5,
          }}
        >
          {visibleCols.map(c => (
            <div key={c.id} style={{ padding: '0.35rem 0.5rem', display: 'flex', alignItems: 'flex-start', gap: '0.35rem', minWidth: 0 }}>
              {c.id === 'time' && (
                <button
                  className={`quick-filter-bar-toggle ${quickEnabled ? 'open' : ''}`}
                  onClick={() => setQuickEnabled(e => !e)}
                  title={quickEnabled ? 'Disable quick filter (keeps patterns)' : 'Enable quick filter'}
                  style={{ marginTop: '0.2rem' }}
                >
                  <Filter size={12} />
                </button>
              )}
              {c.id === 'delta' && (
                <button
                  className={`quick-filter-bar-toggle ${deltaFlagState !== 'none' ? 'open' : ''}`}
                  onClick={handleDeltaToggleClick}
                  title={[
                    deltaFlagState === 'all'
                      ? 'Time-Delta-Context: around all messages. Click to switch it off for all of them.'
                      : deltaFlagState === 'some'
                        ? 'Time-Delta-Context: around the flagged messages only. Click to clear the flags.'
                        : 'Time-Delta-Context: around no message. Click to show it around all messages.',
                    activeFilters.deltaContextEnabled
                      ? 'Ctrl/cmd-click to disable the window (keeps flags and values).'
                      : 'Ctrl/cmd-click to re-enable the window.',
                  ].join(' ')}
                  style={{
                    marginTop: '0.2rem',
                    opacity: activeFilters.deltaContextEnabled ? 1 : 0.5,
                    color: deltaFlagState === 'all' ? 'var(--accent-primary)' : undefined,
                  }}
                >
                  <Power size={12} />
                </button>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0, flex: 1 }}>
                {c.id === 'delta' ? (
                  <>
                    <input
                      className="quick-filter-bar-input"
                      type="number" min={0} step={10}
                      value={activeFilters.deltaBeforeMs || ''}
                      placeholder="before ms"
                      aria-label="Time-Delta-Context before (ms)"
                      style={{ opacity: activeFilters.deltaContextEnabled ? 1 : 0.5 }}
                      onChange={e => onDeltaContextChange?.(Math.max(0, Number(e.target.value) || 0), activeFilters.deltaAfterMs)}
                    />
                    <input
                      className="quick-filter-bar-input"
                      type="number" min={0} step={10}
                      value={activeFilters.deltaAfterMs || ''}
                      placeholder="after ms"
                      aria-label="Time-Delta-Context after (ms)"
                      style={{ opacity: activeFilters.deltaContextEnabled ? 1 : 0.5 }}
                      onChange={e => onDeltaContextChange?.(activeFilters.deltaBeforeMs, Math.max(0, Number(e.target.value) || 0))}
                    />
                  </>
                ) : c.id === 'type' ? (
                  <input
                    className="quick-filter-bar-input"
                    type="text"
                    value={currentPatterns.type?.top ?? ''}
                    placeholder="WRITE, RESPONSE, Incoming…"
                    aria-label="Quick filter TYPE"
                    onChange={e => setQuickCell('type', 'top', e.target.value)}
                  />
                ) : c.id === 'time' ? (
                  <>
                    <input
                      className="quick-filter-bar-input"
                      type="datetime-local" step="1"
                      value={currentPatterns.time?.top ?? ''}
                      aria-label="Quick filter TIME from"
                      onChange={e => setQuickCell('time', 'top', e.target.value)}
                    />
                    <input
                      className="quick-filter-bar-input"
                      type="datetime-local" step="1"
                      value={currentPatterns.time?.bottom ?? ''}
                      aria-label="Quick filter TIME to"
                      onChange={e => setQuickCell('time', 'bottom', e.target.value)}
                    />
                  </>
                ) : c.id === 'value' ? (
                  <>
                    <input
                      className="quick-filter-bar-input"
                      type="text"
                      value={currentPatterns.value?.top ?? ''}
                      placeholder="from / 0x.. / 0b.. / &quot;regex&quot;"
                      aria-label="Quick filter VALUE from"
                      onChange={e => setQuickCell('value', 'top', e.target.value)}
                    />
                    <input
                      className="quick-filter-bar-input"
                      type="text"
                      value={currentPatterns.value?.bottom ?? ''}
                      placeholder="to / pattern…"
                      aria-label="Quick filter VALUE to"
                      onChange={e => setQuickCell('value', 'bottom', e.target.value)}
                    />
                  </>
                ) : (
                  // source / target / dpt: top = address/DPT-key pattern, bottom = name/description regex
                  <>
                    <input
                      className="quick-filter-bar-input"
                      type="text"
                      value={currentPatterns[c.id]?.top ?? ''}
                      placeholder={c.id === 'dpt' ? '1.008-1.011, 16.*' : c.id === 'source' ? '*.1.*, 1.2.12-1.2.91' : '1/5/*, 3/1/1-3/1/127'}
                      aria-label={`Quick filter ${c.label} pattern`}
                      onChange={e => setQuickCell(c.id, 'top', e.target.value)}
                    />
                    <input
                      className="quick-filter-bar-input"
                      type="text"
                      value={currentPatterns[c.id]?.bottom ?? ''}
                      placeholder={c.id === 'dpt' ? 'description regex…' : 'name regex…'}
                      aria-label={`Quick filter ${c.label} name`}
                      onChange={e => setQuickCell(c.id, 'bottom', e.target.value)}
                    />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Body area — relative wrapper so the jump-to-live pill (#202) anchors
          below the header, not over it. */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Jump-to-live pill — telegrams newer than the newest one on screen
          (including pause-buffer backlog while follow is still on). */}
      {isTimeSort && displayNewerCount > 0 && (
        <button
          onClick={jumpToLive}
          className="jump-to-live-pill"
          data-jump-to-live-pill=""
          style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            [liveEdge]: '1rem', zIndex: 20,
          }}
          title="Jump back to the live edge"
        >
          {liveEdge === 'top' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {displayNewerCount.toLocaleString()} {displayNewerCount === 1 ? 'newer telegram' : 'newer telegrams'}
        </button>
      )}

      {/* Fill-spacer overlay: Pause tooltip copy, only while manually paused and
          the fill rubber band is fully on screen. */}
      {showFillPauseLabels && fillRubberPx > 0 && (
        <Fragment key={fillPauseFadeKey}>
          <div
            aria-hidden
            className="fill-rubber-pause-label"
            data-testid="fill-rubber-pause-label-left"
            style={{
              left: 0,
              width: '50%',
              height: fillRubberPx,
              [liveEdge]: 0,
              zIndex: 19,
            }}
          >
            ...paused manually...
          </div>
          <div
            aria-hidden
            className="fill-rubber-pause-label"
            data-testid="fill-rubber-pause-label-right"
            style={{
              right: 0,
              width: '50%',
              height: fillRubberPx,
              [liveEdge]: 0,
              zIndex: 19,
            }}
          >
            ...paused manually...
          </div>
        </Fragment>
      )}

      {/* Marks pill — shown only while rows are marked (#310); the arrows jump
          to the previous / next marked row (#442) */}
      {markedKeysList.length > 0 && (
        <div
          className="marks-pill"
          data-marks-pill=""
          style={{ position: 'absolute', right: '1rem', top: '0.75rem', zIndex: 20 }}
        >
          <button onClick={() => jumpToMark(-1)} disabled={markedIndices.length === 0} title="Jump to previous mark">
            <ChevronUp size={14} />
          </button>
          <button onClick={() => jumpToMark(1)} disabled={markedIndices.length === 0} title="Jump to next mark">
            <ChevronDown size={14} />
          </button>
          <button onClick={clearMarks} className="marks-pill-clear" title="Clear all marks">
            <X size={13} /> Clear {markedKeysList.length} mark{markedKeysList.length === 1 ? '' : 's'}
          </button>
        </div>
      )}

      {/* Virtualized Body */}
      <div
        ref={parentRef}
        data-telegram-scroll=""
        onScroll={handleScroll}
        onWheel={e => {
          noteUserScroll();
          if (wheelTowardNewer(e.deltaY)) {
            engageLiveTowardNewer(e.deltaY);
            // Hard-stop overscroll: scrollTop may not change, so remount to
            // restart the pause-label highlight fade on each attempt.
            if (isManualPause && fillRubberFullyVisible()) {
              pulseFillPauseLabels();
            }
          }
          // While a backlog step is pending the geometry must stay live.
          if (flushPinRef.current) return;
          if (inOppositeRubberZone() || inFillRubberBand()) {
            lockScrollGeometry();
          } else {
            unlockScrollGeometryIfSettled();
          }
          if (inFillRubberBand() || inOppositeRubberZone()) scheduleRubberBand();
        }}
        onTouchMove={noteUserScroll}
        // A press on the container itself (not on a row) is the scrollbar.
        onPointerDown={e => {
          if (e.target !== e.currentTarget) return;
          scrollbarHeldRef.current = true;
          lockScrollGeometry();
        }}
        // overflow-anchor off: we compensate scrollTop manually on prepend (#202),
        // so the browser's native anchoring must not also move the viewport.
        // paddingRight reserves space for the visual overlay scrollbar track.
        style={{
          flex: 1,
          overflowY: 'auto',
          position: 'relative',
          overflowAnchor: 'none',
          paddingRight: LIST_SB_WIDTH_PX,
        }}
        className="custom-scrollbar"
      >
        {telegramRows.length === 0 ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.875rem' }}>
            No data available.
          </div>
        ) : (
          <>
            {/* Opposite short-list travel sits outside the virtualizer; fill rubber is paddingStart/End. */}
            {liveEdge === 'bottom' && oppositeSpacerPx > 0 && (
              <div aria-hidden style={{ height: `${oppositeSpacerPx}px`, width: '100%' }} />
            )}
            <div
              style={{
                height: `${virtTotalPx}px`,
                width: '100%',
                position: 'relative'
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const t = telegramRows[virtualRow.index];
                const key = anchorKey(t);
                const marked = markedSet.has(key);
                // The most-recently-clicked row is the most prominent (#310).
                const latest = marked && key === lastMarked;
                // Present only as unfiltered Time-Delta-Context, not a real filter
                // match (#343) — a distinct wash, but marks still take priority.
                const isContext = !marked && !!contextKeys?.has(key);
                const targetColor = activeTargetColors[t.target_address];
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    data-akey={key}
                    onClick={(e) => handleRowClick(e, key, virtualRow.index)}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                      display: 'grid',
                      gridTemplateColumns: gridTemplate,
                      borderBottom: '1px solid var(--border-color)',
                      fontSize: '0.8125rem',
                      // Marked rows get an accent wash that overrides the zebra
                      // stripe; the latest click is washed more strongly and gets
                      // an accent bar. Context-only rows get a distinct (warning-
                      // hued) wash instead, so they read apart from real matches.
                      // color-mix adapts to the theme's accent/warning colors.
                      background: latest
                        ? 'color-mix(in srgb, var(--accent-primary) 34%, transparent)'
                        : marked
                          ? 'color-mix(in srgb, var(--accent-primary) 16%, transparent)'
                          : isContext
                            ? 'color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent)'
                            : targetColor
                              ? `color-mix(in srgb, ${targetColor} 9%, transparent)`
                              : (virtualRow.index + stripeOffset) % 2 === 0 ? 'var(--bg-subtle)' : 'transparent',
                      // A colour given to the row's target in the filter panel (#509):
                      // a bar on the left, and a wash where nothing else tints the row.
                      boxShadow: latest
                        ? 'inset 3px 0 0 0 var(--accent-primary)'
                        : targetColor ? `inset 4px 0 0 0 ${targetColor}` : undefined,
                      alignItems: 'start',
                      minHeight: '60px' // Ensure a minimum touch/visual target
                    }}
                    title={isContext ? 'Unfiltered Time-Delta-Context — this telegram did not match the active filters' : undefined}
                    className={`log-row${marked ? ' marked' : ''}${latest ? ' latest' : ''}${isContext ? ' context' : ''}`}
                  >
                    {visibleCols.map(c => (
                      <React.Fragment key={c.id}>{renderCell(c.id, t)}</React.Fragment>
                    ))}
                  </div>
                );
              })}
            </div>
            {liveEdge === 'top' && oppositeSpacerPx > 0 && (
              <div aria-hidden style={{ height: `${oppositeSpacerPx}px`, width: '100%' }} />
            )}
          </>
        )}
      </div>

      {/* Visual scrollbar only — thumb sized as if pausedCount rows were in
          scrollHeight; real scrollHeight / scroll behavior unchanged.
          Always mounted; syncOverlayScrollbar toggles display. */}
      <div
        ref={sbTrackRef}
        className="list-sb-track"
        data-testid="list-scrollbar-track"
        aria-hidden
        style={{ display: 'none' }}
        onPointerDown={onSbTrackPointerDown}
      >
        <div
          ref={sbThumbRef}
          className="list-sb-thumb"
          data-testid="list-scrollbar-thumb"
          onPointerDown={onSbThumbPointerDown}
          onPointerMove={onSbThumbPointerMove}
          onPointerUp={onSbThumbPointerUp}
          onPointerCancel={onSbThumbPointerUp}
        />
      </div>
      </div>
      </SendToGaHost>
    </div>
  );
};

// Add styles for quick filter buttons and resize handles
const style = document.createElement('style');
style.textContent = `
  /* Hide native scrollbar on the telegram list port — overlay thumb paints instead. */
  .custom-scrollbar {
    scrollbar-width: none;
  }
  .custom-scrollbar::-webkit-scrollbar {
    width: 0;
    height: 0;
  }

  .list-sb-track {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: ${LIST_SB_WIDTH_PX}px;
    z-index: 15;
    pointer-events: auto;
  }

  .list-sb-thumb {
    position: absolute;
    left: 0;
    width: 100%;
    background: var(--scrollbar-thumb);
    border-radius: 10px;
    cursor: default;
    pointer-events: auto;
  }

  .list-sb-thumb:hover {
    background: var(--scrollbar-thumb-hover);
  }

  .quick-filter-btn, .quick-visualize-btn, .quick-last-seen-btn, .quick-send-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-dim);
    padding: 0.2rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: all 0.2s;
    position: relative;
  }

  .quick-filter-btn:focus, .quick-filter-btn:focus-visible,
  .quick-visualize-btn:focus, .quick-visualize-btn:focus-visible,
  .quick-last-seen-btn:focus, .quick-last-seen-btn:focus-visible,
  .quick-send-btn:focus, .quick-send-btn:focus-visible {
    /* Beat .log-row:hover … opacity: 0.6 so the focus ring stays full strength. */
    opacity: 1 !important;
  }

  .quick-filter-btn.active {
    opacity: 1;
    color: var(--accent-primary);
  }

  .quick-filter-btn .cancel-icon {
    display: none;
  }

  .quick-filter-btn.active:hover .filter-icon {
    display: none;
  }

  .quick-filter-btn.active:hover .cancel-icon {
    display: block;
    color: var(--error); /* red for cancel */
  }

  .log-row:hover .quick-filter-btn:not(.active),
  .log-row:hover .quick-visualize-btn,
  .log-row:hover .quick-last-seen-btn,
  .log-row:hover .quick-send-btn {
    opacity: 0.6;
  }

  /* Lit send icons stay opaque after a bus pulse (!important beats transition glitches). */
  .log-row:hover .quick-send-btn[data-send-popover-open],
  .quick-send-btn[data-send-popover-open],
  .log-row:hover .quick-send-btn[data-send-panel-match],
  .quick-send-btn[data-send-panel-match] {
    opacity: 1 !important;
    color: var(--accent-primary);
  }

  .log-row:hover .quick-send-btn[data-send-job-active],
  .quick-send-btn[data-send-job-active] {
    opacity: 1 !important;
    color: var(--tt-outgoing);
  }

  /* While the shared bus-pulse runs, keep the icon opaque and let keyframes own motion. */
  .log-row:hover .quick-send-btn[data-bus-pulse],
  .quick-send-btn[data-bus-pulse] {
    opacity: 1 !important;
    transition: none;
  }

  .quick-filter-btn:hover, .quick-visualize-btn:hover, .quick-last-seen-btn:hover, .quick-send-btn:hover {
    opacity: 1 !important;
    background: var(--bg-hover);
    color: var(--accent-primary);
    transform: scale(1.1);
  }

  .quick-send-btn[data-send-job-active]:hover,
  .quick-send-btn[data-bus-pulse="Outgoing"]:hover {
    color: var(--tt-outgoing);
  }

  .quick-send-btn[data-bus-pulse="Incoming"]:hover {
    color: var(--tt-incoming);
  }

  .quick-visualize-btn:hover {
    color: var(--success);
  }

  .quick-last-seen-btn:hover {
    color: var(--accent-primary);
  }

  @keyframes fill-pause-label-fade {
    from { color: var(--text-main); }
    to { color: var(--text-dim); }
  }

  .fill-rubber-pause-label {
    position: absolute;
    display: flex;
    justify-content: center;
    align-items: center;
    font-style: italic;
    font-size: 0.75rem;
    font-weight: 500;
    pointer-events: none;
    white-space: nowrap;
    overflow: hidden;
    color: var(--text-dim);
    animation: fill-pause-label-fade 550ms ease-out forwards;
  }

  .jump-to-live-pill {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.85rem;
    border: 1px solid var(--accent-primary);
    border-radius: 999px;
    background: var(--accent-primary);
    color: white;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    box-shadow: var(--shadow-lg);
    transition: transform 0.15s, filter 0.15s;
  }

  .jump-to-live-pill:hover {
    filter: brightness(1.08);
    transform: translateX(-50%) scale(1.03);
  }

  .marks-pill {
    display: flex;
    align-items: stretch;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-panel);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  .marks-pill button {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.45rem;
    border: none;
    background: transparent;
    color: var(--text-dim);
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
  }

  .marks-pill button:first-child {
    padding-left: 0.6rem;
  }

  .marks-pill .marks-pill-clear {
    padding-right: 0.7rem;
    border-left: 1px solid var(--border-color);
  }

  .marks-pill button:hover:not(:disabled) {
    color: var(--accent-primary);
    background: var(--bg-hover);
  }

  .marks-pill button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .quick-filter-bar-toggle {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-dim);
    padding: 0.15rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.15s;
  }

  .quick-filter-bar-toggle:hover {
    background: var(--bg-hover);
    color: var(--accent-primary);
  }

  .quick-filter-bar-toggle.open {
    color: var(--accent-primary);
  }

  .quick-filter-bar-input {
    width: 100%;
    min-width: 0;
    background: var(--bg-tag);
    border: 1px solid var(--border-color);
    border-radius: 5px;
    padding: 0.25rem 0.45rem;
    color: var(--text-main);
    font-size: 0.72rem;
    font-family: var(--font-mono, monospace);
    outline: none;
    transition: border-color 0.15s;
  }

  .quick-filter-bar-input:focus {
    border-color: var(--accent-primary);
  }

  .goto-time-popover {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem;
    background: var(--bg-panel);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-shadow: var(--shadow-lg);
  }

  .goto-time-input {
    background: var(--bg-tag);
    border: 1px solid var(--border-color);
    border-radius: 5px;
    padding: 0.25rem 0.45rem;
    color: var(--text-main);
    font-size: 0.75rem;
    font-family: var(--font-mono, monospace);
    outline: none;
    transition: border-color 0.15s;
  }

  .goto-time-input:focus {
    border-color: var(--accent-primary);
  }

  .goto-time-go {
    background: var(--accent-primary);
    border: none;
    border-radius: 5px;
    padding: 0.3rem 0.7rem;
    color: white;
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
    transition: filter 0.15s;
  }

  .goto-time-go:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .goto-time-go:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Column reordering: the dragged header dims, and a bar on the hovered
     header shows the side the column will land on. */
  .header-col {
    cursor: grab;
  }

  .header-col.drag-source {
    opacity: 0.4;
  }

  .header-col.drop-before {
    box-shadow: inset 3px 0 0 var(--accent-primary);
  }

  .header-col.drop-after {
    box-shadow: inset -3px 0 0 var(--accent-primary);
  }

  .col-resize-handle {
    position: absolute;
    top: 0;
    right: -4px;
    width: 8px;
    height: 100%;
    cursor: col-resize;
    z-index: 2;
    user-select: none;
  }

  .col-resize-handle::after {
    content: '';
    position: absolute;
    top: 20%;
    right: 3px;
    width: 2px;
    height: 60%;
    background: transparent;
    border-radius: 1px;
    transition: background 0.15s;
  }

  .col-resize-handle:hover::after {
    background: var(--accent-primary);
  }
`;
document.head.appendChild(style);
