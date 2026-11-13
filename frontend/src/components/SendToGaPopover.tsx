import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Send, ChevronLeft } from 'lucide-react';

import { apiUrl } from '../utils/basePath';
import { formatDpt, parseDptMain, readTelegram, sendTelegram } from '../utils/knxSend';
import { buildWriteDptOptions, dptUnit } from '../utils/dpt';
import { describeBusPayload, type BusPayload } from '../utils/dptValues';
import type { FilterOption } from '../types/filters';
import type { Telegram } from '../hooks/useWebSocket';
import { useDptCatalog } from './DptCatalogContext';
import { DptField } from './DptField';
import { WriteControls, needsValueColumn } from './WriteControls';
import { BusValueText } from './BusValueText';
import { TelegramWhenJump, telegramEventType } from './TelegramWhenJump';
import { EventTypeLabel } from './EventTypeLabel';
import { useGaReadPhase } from './GaReadPhase';
import { secondaryBtn } from '../utils/buttonStyles';
import { SecondsField } from './SecondsField';
import {
  sanitizeSecondsInput,
  correspondenceKeyFromDraft,
  type SendCorrespondenceKey,
} from '../utils/sendCorrespondence';
import {
  SendJobStatusField,
  STATUS_ACTION_WIDTH,
  STATUS_CLEAR_WIDTH,
  type LinkedRowStatus,
} from './WriteToBusPanel';
import { useRetainFocusThroughDisabled } from '../hooks/useRetainFocusThroughDisabled';

/** Stable list position: telegram identity + its viewport offset at open time. */
export type ListScrollSnapshot = {
  scrollTop: number;
  key: string | null;
  offset: number;
};

type AnchorRect = { top: number; left: number; right: number; bottom: number; width: number; height: number };

type HostSession = {
  address: string;
  name?: string | null;
  dptMain?: number | null;
  dptSub?: number | null;
  /** Identity of the row trigger that owns the current anchor (telegram anchorKey). */
  triggerId: string;
  anchor: AnchorRect;
  listSnapshot: ListScrollSnapshot | null;
};

type HostApi = {
  activeAddress: string | null;
  activeTriggerId: string | null;
  open: (session: HostSession) => void;
  close: () => void;
  captureListScroll: (() => ListScrollSnapshot | null) | null;
  restoreListScroll: ((snap: ListScrollSnapshot) => void | Promise<void>) | null;
};

const SendToGaHostContext = createContext<HostApi | null>(null);

/**
 * Keeps the send popover panel mounted outside virtualized rows so list scroll
 * cannot unmount it. Wire capture/restore from TelegramTable for stable jumps.
 */
export function SendToGaHost({
  children,
  latestTelegram = null,
  onGotoTelegram,
  captureListScroll,
  restoreListScroll,
  linkedRowId = null,
  linkedStatus = null,
  gaJobStatuses,
  onScheduleCommit,
  onWriteWithSchedule,
  onReadWithSchedule,
  onCancelLinked,
  onAltSend,
  onCtrlSend,
}: {
  children: React.ReactNode;
  latestTelegram?: Telegram | null;
  onGotoTelegram?: (telegram: Telegram) => void;
  captureListScroll?: () => ListScrollSnapshot | null;
  restoreListScroll?: (snap: ListScrollSnapshot) => void | Promise<void>;
  linkedRowId?: string | null;
  linkedStatus?: LinkedRowStatus | null;
  gaJobStatuses?: Record<string, LinkedRowStatus>;
  onScheduleCommit?: (draft: SendCorrespondenceKey & { name?: string | null }) => void;
  onWriteWithSchedule?: (
    draft: SendCorrespondenceKey & { name?: string | null },
    payload: BusPayload,
    opts?: { response?: boolean },
  ) => void;
  onReadWithSchedule?: (draft: SendCorrespondenceKey & { name?: string | null }) => void;
  onCancelLinked?: (rowId?: string) => void;
  onAltSend?: () => void;
  onCtrlSend?: (info: {
    address: string;
    name?: string | null;
    dptMain?: number | null;
    dptSub?: number | null;
  }) => void;
}) {
  const [session, setSession] = useState<HostSession | null>(null);
  const api = useMemo<HostApi>(() => ({
    activeAddress: session?.address ?? null,
    activeTriggerId: session?.triggerId ?? null,
    open: s => setSession(s),
    close: () => setSession(null),
    captureListScroll: captureListScroll ?? null,
    restoreListScroll: restoreListScroll ?? null,
  }), [session?.address, session?.triggerId, captureListScroll, restoreListScroll]);

  const sessionGaStatus = session?.address
    ? gaJobStatuses?.[session.address] ?? null
    : null;
  // Prefer the correspondence-linked row when it owns the job; else the GA's live job.
  const statusForPanel = linkedStatus?.job
    ? linkedStatus
    : (sessionGaStatus?.job ? sessionGaStatus : linkedStatus);

  return (
    <SendToGaHostContext.Provider value={api}>
      {children}
      {session && (
        <SendToGaPopover
          key={session.address}
          address={session.address}
          name={session.name}
          dptMain={session.dptMain}
          dptSub={session.dptSub}
          latestTelegram={latestTelegram}
          onGotoTelegram={onGotoTelegram}
          panelOnly
          panelAnchor={session.anchor}
          panelListSnapshot={session.listSnapshot}
          panelTriggerId={session.triggerId}
          onPanelClose={() => setSession(null)}
          onAltSend={onAltSend}
          onCtrlSend={onCtrlSend}
          jobActive={Boolean(sessionGaStatus?.job || linkedStatus?.job)}
          linkedRowId={linkedRowId ?? statusForPanel?.rowId ?? null}
          linkedStatus={statusForPanel}
          onScheduleCommit={onScheduleCommit}
          onWriteWithSchedule={onWriteWithSchedule}
          onReadWithSchedule={onReadWithSchedule}
          onCancelLinked={onCancelLinked}
        />
      )}
    </SendToGaHostContext.Provider>
  );
}

interface Props {
  address: string;
  name?: string | null;
  dptMain?: number | null;
  dptSub?: number | null;
  /** Override the app-wide project DPT catalog (tests). */
  dptCatalog?: FilterOption[];
  /** Small icon-button label; defaults to the paper-plane send icon. */
  title?: string;
  /** Extra className for the trigger button (to match host styling). */
  buttonClassName?: string;
  /** Inline style for the trigger button. */
  buttonStyle?: React.CSSProperties;
  /** Jump the telegram list to the last-seen telegram shown in the popover. */
  onGotoTelegram?: (telegram: Telegram) => void;
  /** Live bus feed — ends a Read wait when a Response arrives. */
  latestTelegram?: Telegram | null;
  /** Host-owned panel (no trigger); survives virtualized row unmount. */
  panelOnly?: boolean;
  panelAnchor?: AnchorRect;
  panelListSnapshot?: ListScrollSnapshot | null;
  /** Row trigger identity while the host panel is open (for same-GA move). */
  panelTriggerId?: string;
  onPanelClose?: () => void;
  /**
   * Stable id for this trigger inside a host (telegram anchorKey). Used to
   * distinguish toggle-close vs move-to-another-row for the same GA.
   */
  triggerId?: string;
  /** Alt-click on the trigger → toggle the send panel (no popover). */
  onAltSend?: () => void;
  /**
   * Ctrl/Cmd-click → clear or insert the GA in the send panel (no popover).
   * Payload is the trigger's GA / DPT.
   */
  onCtrlSend?: (info: {
    address: string;
    name?: string | null;
    dptMain?: number | null;
    dptSub?: number | null;
  }) => void;
  /** Send panel has at least one row for this GA — keep the icon opaque/blue. */
  panelMatched?: boolean;
  /** A live send-panel job targets this GA — keep the icon opaque/green. */
  jobActive?: boolean;
  /**
   * Keep the trigger out of Tab / field focus (telegram-table scroll body).
   * Click still opens the popover; focus goes to the value field inside.
   */
  suppressTriggerFocus?: boolean;
  linkedRowId?: string | null;
  linkedStatus?: LinkedRowStatus | null;
  onScheduleCommit?: (draft: SendCorrespondenceKey & { name?: string | null }) => void;
  onWriteWithSchedule?: (
    draft: SendCorrespondenceKey & { name?: string | null },
    payload: BusPayload,
    opts?: { response?: boolean },
  ) => void;
  onReadWithSchedule?: (draft: SendCorrespondenceKey & { name?: string | null }) => void;
  onCancelLinked?: (rowId?: string) => void;
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

function isWriteTelegram(tg: Telegram | null | undefined): boolean {
  if (!tg) return false;
  if (tg.simplified_type === 'Write') return true;
  return Boolean(tg.telegram_type?.includes('Write'));
}

/** Value-bearing bus event that should refresh the popover's last value/timestamp. */
function isLastValueTelegram(tg: Telegram | null | undefined): boolean {
  return isWriteTelegram(tg) || isResponseTelegram(tg);
}

function rectsOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

/**
 * Shift the card so it does not cover one overlay pill. Prefer vertical
 * clearance; fall back to horizontal.
 */
function clearOnePillOverlap(
  table: Element,
  pill: Element,
  left: number,
  top: number,
  width: number,
  height: number,
  pad: number,
  gap: number,
): { left: number; top: number } {
  const p = pill.getBoundingClientRect();
  const bounds = table.getBoundingClientRect();
  const minTop = bounds.top + pad;
  const maxTop = Math.max(minTop, bounds.bottom - pad - height);
  let nextLeft = left;
  let nextTop = top;
  const cardRect = () => ({
    left: nextLeft, top: nextTop, right: nextLeft + width, bottom: nextTop + height,
  });
  if (!rectsOverlap(cardRect(), p)) return { left, top };

  const pillNearTop = p.top < (bounds.top + bounds.bottom) / 2;
  if (pillNearTop) {
    const below = p.bottom + gap;
    const above = p.top - gap - height;
    if (below <= maxTop) nextTop = below;
    else if (above >= minTop) nextTop = above;
    else nextTop = Math.min(maxTop, Math.max(minTop, below));
  } else {
    const above = p.top - gap - height;
    const below = p.bottom + gap;
    if (above >= minTop) nextTop = above;
    else if (below <= maxTop) nextTop = below;
    else nextTop = Math.max(minTop, Math.min(maxTop, above));
  }
  nextTop = Math.min(maxTop, Math.max(minTop, nextTop));

  if (rectsOverlap(cardRect(), p)) {
    const rightOf = p.right + gap;
    const leftOf = p.left - width - gap;
    const maxLeft = Math.max(bounds.left + pad, bounds.right - width - pad);
    if (rightOf <= maxLeft) nextLeft = rightOf;
    else if (leftOf >= bounds.left + pad) nextLeft = leftOf;
  }
  return { left: nextLeft, top: nextTop };
}

/** Jump-to-live + marks pills — popover must not cover them (open or drag). */
const TT_PILL_SELECTOR = '[data-jump-to-live-pill], [data-marks-pill]';

function clearPillOverlaps(
  table: Element,
  left: number,
  top: number,
  width: number,
  height: number,
  pad: number,
  gap: number,
): { left: number; top: number } {
  let nextLeft = left;
  let nextTop = top;
  table.querySelectorAll(TT_PILL_SELECTOR).forEach(pill => {
    const cleared = clearOnePillOverlap(table, pill, nextLeft, nextTop, width, height, pad, gap);
    nextLeft = cleared.left;
    nextTop = cleared.top;
  });
  return { left: nextLeft, top: nextTop };
}

function clearOverlaps(
  table: Element,
  left: number,
  top: number,
  width: number,
  height: number,
  pad: number,
  gap: number,
): { left: number; top: number } {
  return clearPillOverlaps(table, left, top, width, height, pad, gap);
}

type BusPulseDir = 'Incoming' | 'Outgoing';

/** Must match `animation: bus-pulse 0.42s` in index.css. */
const BUS_PULSE_MS = 420;

/** TT direction colors: Incoming sky, Outgoing fuchsia — not traffic-light colors. */
function busPulseColor(dir: BusPulseDir): string {
  return dir === 'Outgoing' ? 'var(--tt-outgoing)' : 'var(--tt-incoming)';
}

/**
 * Trigger color: bus pulse uses that direction's TT color; live job uses
 * Outgoing color; otherwise blue when lit, else dim.
 */
function sendTriggerColor(opts: {
  busPulse: BusPulseDir | null;
  jobActive: boolean;
  lit: boolean;
  fallback?: string;
}): string {
  if (opts.busPulse) return busPulseColor(opts.busPulse);
  if (opts.jobActive) return 'var(--tt-outgoing)';
  if (opts.lit) return 'var(--accent-primary)';
  return opts.fallback || 'var(--text-dim)';
}

/**
 * Drop pulse keyframe leftovers so CSS opacity/color rules apply cleanly again.
 * `transition: all` would otherwise ease filter/transform off the button and
 * leave the send glyph blank after the keyframes end.
 */
function clearSendWritePulseStyles(el: HTMLElement | null | undefined) {
  if (!el) return;
  el.style.transition = 'none';
  el.style.animation = 'none';
  el.style.filter = 'none';
  el.style.transform = 'none';
  void el.offsetWidth;
  el.style.removeProperty('transition');
  el.style.removeProperty('animation');
  el.style.removeProperty('filter');
  el.style.removeProperty('transform');
}

export function SendToGaPopover({
  address, name, dptMain, dptSub, dptCatalog: dptCatalogProp,
  title = 'Send to this GA',
  buttonClassName, buttonStyle, onGotoTelegram, latestTelegram = null,
  panelOnly = false,
  panelAnchor,
  panelListSnapshot = null,
  panelTriggerId,
  onPanelClose,
  triggerId = '',
  onAltSend,
  onCtrlSend,
  panelMatched = false,
  jobActive = false,
  suppressTriggerFocus = false,
  linkedRowId = null,
  linkedStatus = null,
  onScheduleCommit,
  onWriteWithSchedule,
  onReadWithSchedule,
  onCancelLinked,
}: Props) {
  const host = useContext(SendToGaHostContext);
  const [hovered, setHovered] = useState(false);
  const [busPulse, setBusPulse] = useState<BusPulseDir | null>(null);
  /** Bumped when a pulse ends so the send glyph mounts fresh after the keyframes. */
  const [sendIconEpoch, setSendIconEpoch] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const flashGenRef = useRef(0);
  const pulseTimerRef = useRef(0);
  const addressRef = useRef(address);

  useEffect(() => () => window.clearTimeout(pulseTimerRef.current), []);

  // Brief pulse in that direction's TT color when a bus event for this GA arrives.
  // The button stays mounted, so the attribute has to come off for the resting color.
  // A later telegram for another GA must not cancel the timer: the list updates
  // latestTelegram constantly, and clearing here left the pulse attribute on
  // after the keyframes finished. A recycled row (new GA) drops the pulse at once.
  useEffect(() => {
    if (addressRef.current !== address) {
      addressRef.current = address;
      flashGenRef.current += 1;
      window.clearTimeout(pulseTimerRef.current);
      setBusPulse(null);
      setSendIconEpoch(epoch => epoch + 1);
    }
    if (!latestTelegram) return;
    if (latestTelegram.target_address !== address) return;
    const dir = latestTelegram.direction;
    if (dir !== 'Outgoing' && dir !== 'Incoming') return;
    const gen = ++flashGenRef.current;
    setBusPulse(dir);
    window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => {
      if (flashGenRef.current !== gen) return;
      setBusPulse(null);
      setSendIconEpoch(epoch => epoch + 1);
    }, BUS_PULSE_MS);
  }, [latestTelegram, address]);

  // After the pulse attribute drops, hard-reset animation leftovers before paint
  // so panel-match / job / hover opacity and color rules apply to a visible icon.
  useLayoutEffect(() => {
    if (busPulse != null) return;
    clearSendWritePulseStyles(btnRef.current);
  }, [busPulse]);

  // Inside a host: only the trigger lives in the (virtualized) row. The panel
  // is rendered by SendToGaHost so scrolling the list cannot unmount it.
  if (host && !panelOnly) {
    const active = host.activeAddress === address;
    const lit = active || panelMatched || hovered;
    const color = sendTriggerColor({
      busPulse,
      jobActive,
      lit,
      fallback: buttonStyle?.color,
    });
    return (
      <button
        ref={btnRef}
        data-send-to-ga-trigger=""
        {...(active ? { 'data-send-popover-open': '' } : {})}
        {...(panelMatched ? { 'data-send-panel-match': '' } : {})}
        {...(jobActive ? { 'data-send-job-active': '' } : {})}
        {...(busPulse ? { 'data-bus-pulse': busPulse } : {})}
        className={buttonClassName}
        tabIndex={suppressTriggerFocus ? -1 : undefined}
        style={{
          ...buttonStyle,
          color,
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onMouseDown={suppressTriggerFocus ? (e => { e.preventDefault(); }) : undefined}
        onClick={e => {
          e.stopPropagation();
          if (e.altKey) {
            onAltSend?.();
            return;
          }
          if (e.ctrlKey || e.metaKey) {
            onCtrlSend?.({ address, name, dptMain, dptSub });
            return;
          }
          const b = btnRef.current?.getBoundingClientRect();
          if (!b) return;
          const anchor = {
            top: b.top, left: b.left, right: b.right, bottom: b.bottom,
            width: b.width, height: b.height,
          };
          // Same GA + same row trigger → toggle closed. Same GA + other row →
          // re-anchor the open panel and refresh the list-scroll snapshot.
          if (active && host.activeTriggerId === triggerId) {
            host.close();
            return;
          }
          host.open({
            address,
            name,
            dptMain,
            dptSub,
            triggerId,
            anchor,
            listSnapshot: host.captureListScroll?.() ?? null,
          });
        }}
        title={title}
      >
        <Send key={sendIconEpoch} size={12} />
      </button>
    );
  }

  return (
    <SendToGaPopoverPanel
      address={address}
      name={name}
      dptMain={dptMain}
      dptSub={dptSub}
      dptCatalog={dptCatalogProp}
      title={title}
      buttonClassName={buttonClassName}
      buttonStyle={buttonStyle}
      onGotoTelegram={onGotoTelegram}
      latestTelegram={latestTelegram}
      panelOnly={panelOnly}
      panelAnchor={panelAnchor}
      panelListSnapshot={panelListSnapshot}
      panelTriggerId={panelTriggerId}
      onPanelClose={onPanelClose}
      onAltSend={onAltSend}
      onCtrlSend={onCtrlSend}
      panelMatched={panelMatched}
      jobActive={jobActive}
      suppressTriggerFocus={suppressTriggerFocus}
      linkedRowId={linkedRowId}
      linkedStatus={linkedStatus}
      onScheduleCommit={onScheduleCommit}
      onWriteWithSchedule={onWriteWithSchedule}
      onReadWithSchedule={onReadWithSchedule}
      onCancelLinked={onCancelLinked}
      busPulse={busPulse}
      sendIconEpoch={sendIconEpoch}
    />
  );
}

function SendToGaPopoverPanel({
  address, name, dptMain, dptSub, dptCatalog: dptCatalogProp,
  title = 'Send to this GA',
  buttonClassName, buttonStyle, onGotoTelegram, latestTelegram = null,
  panelOnly = false,
  panelAnchor,
  panelListSnapshot = null,
  panelTriggerId,
  onPanelClose,
  onAltSend,
  onCtrlSend,
  panelMatched = false,
  jobActive = false,
  suppressTriggerFocus = false,
  linkedRowId = null,
  linkedStatus = null,
  onScheduleCommit,
  onWriteWithSchedule,
  onReadWithSchedule,
  onCancelLinked,
  busPulse = null,
  sendIconEpoch = 0,
}: Props & { busPulse?: BusPulseDir | null; sendIconEpoch?: number }) {
  const host = useContext(SendToGaHostContext);
  const [open, setOpen] = useState(panelOnly);
  const [hovered, setHovered] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<AnchorRect | null>(panelAnchor ?? null);

  // Standalone trigger (no host): the button lives here, so clear leftovers here.
  useLayoutEffect(() => {
    if (busPulse != null) return;
    clearSendWritePulseStyles(btnRef.current);
  }, [busPulse]);
  const [pos, setPos] = useState<{ top: number; left: number; maxWidth: number; maxHeight: number } | null>(null);
  /** List position captured when this popover opened (restore jump). */
  const [listSnapshot, setListSnapshot] = useState<ListScrollSnapshot | null>(panelListSnapshot);
  /** True once the list scrollTop differs from the open snapshot. */
  const [listScrollAway, setListScrollAway] = useState(false);
  /** True once the card has left the position place('full') anchored. */
  const [posAway, setPosAway] = useState(false);
  const anchoredPosRef = useRef<{ top: number; left: number } | null>(null);
  const listSnapshotRef = useRef(listSnapshot);
  listSnapshotRef.current = listSnapshot;
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
  } | null>(null);
  const bumpFocus = () => setFocusToken(t => t + 1);

  const adoptListSnapshot = (snap: ListScrollSnapshot | null) => {
    setListSnapshot(snap);
    setListScrollAway(false);
  };

  const listScrollEl = () => (
    tableEl()?.querySelector('[data-telegram-scroll]') as HTMLElement | null
  );

  const syncListScrollAway = (scrollTop?: number) => {
    const snap = listSnapshotRef.current;
    if (snap == null) {
      setListScrollAway(false);
      return;
    }
    const top = scrollTop ?? listScrollEl()?.scrollTop;
    if (top == null) {
      setListScrollAway(false);
      return;
    }
    setListScrollAway(top !== snap.scrollTop);
  };

  const [value, setValue] = useState('');
  const [delay, setDelay] = useState('');
  const [every, setEvery] = useState('');
  /** Ctrl/cmd-click on Read switches this. Write buttons then send a GroupValueResponse. */
  const [respond, setRespond] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [last, setLast] = useState<Telegram | null>(null);
  /** Bumped on live last updates so a late loadLast() cannot overwrite newer bus data. */
  const loadLastGenRef = useRef(0);
  /** Active wait for a GroupValueResponse after Read. */
  const [awaitingRead, setAwaitingRead] = useState(false);
  /** Bound Read/Response while waiting or just after — for green Response chrome. */
  const [statusTelegram, setStatusTelegram] = useState<Telegram | null>(null);

  const catalogFromCtx = useDptCatalog();
  const dptCatalog = dptCatalogProp ?? catalogFromCtx;

  const projectDpt = formatDpt(dptMain ?? undefined, dptSub ?? undefined);
  const [dpt, setDpt] = useState(projectDpt);
  const [seenProject, setSeenProject] = useState(projectDpt);
  if (projectDpt !== seenProject) {
    setSeenProject(projectDpt);
    setDpt(projectDpt);
    setValue('');
  }
  const overridden = projectDpt !== '' && dpt.trim() !== projectDpt;
  // Same suggestion source as the send panel: common types + project catalog,
  // then clipped to this GA's main so telegram length stays compatible.
  const dptOptions = useMemo(() => {
    const extras = dptMain != null ? [{ main: dptMain, sub: dptSub ?? null }] : [];
    let list = buildWriteDptOptions(dptCatalog, extras);
    if (dptMain != null) list = list.filter(o => Number(o.key.split('.')[0]) === dptMain);
    return list;
  }, [dptCatalog, dptMain, dptSub]);

  /** Enter/blur on any field: link when delay/every set, else clear link. */
  const commitScheduleLink = (overrides?: Partial<{ dpt: string; value: string; delay: string; every: string }>) => {
    const nextDelay = sanitizeSecondsInput(overrides?.delay ?? delay);
    const nextEvery = sanitizeSecondsInput(overrides?.every ?? every);
    if (nextDelay !== delay) setDelay(nextDelay);
    if (nextEvery !== every) setEvery(nextEvery);
    onScheduleCommit?.({
      ...correspondenceKeyFromDraft({
        address,
        dpt: overrides?.dpt ?? dpt,
        value: overrides?.value ?? value,
        delay: nextDelay,
        every: nextEvery,
      }),
      name,
    });
  };

  const onDptChange = (next: string) => {
    if (parseDptMain(dpt) !== parseDptMain(next)) setValue('');
    setDpt(next);
    setFeedback(null);
    // DptField commits on blur/Enter via onChange — treat as schedule commit.
    commitScheduleLink({ dpt: next });
  };

  const scheduleEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitScheduleLink();
    }
  };

  const tableEl = () => (
    btnRef.current?.closest('[data-telegram-table]') as HTMLElement | null
    ?? document.querySelector('[data-telegram-table]')
  );

  /** Boundary for clamping: telegram table when present, else the viewport. */
  const boundaryRect = () => {
    const boundaryEl = tableEl();
    return boundaryEl?.getBoundingClientRect() ?? {
      top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight,
      width: window.innerWidth, height: window.innerHeight,
    };
  };

  /** Closing ends any open Read wait (no Cancel button). */
  const closePopover = () => {
    setOpen(false);
    setAwaitingRead(false);
    setStatusTelegram(null);
    adoptListSnapshot(null);
    anchoredPosRef.current = null;
    setPosAway(false);
    onPanelClose?.();
  };

  const captureOpenScroll = () => {
    if (host?.captureListScroll) {
      adoptListSnapshot(host.captureListScroll());
      return;
    }
    const scrollEl = listScrollEl();
    if (!scrollEl) {
      adoptListSnapshot(null);
      return;
    }
    adoptListSnapshot({ scrollTop: scrollEl.scrollTop, key: null, offset: 0 });
  };

  const restoreOpenScroll = () => {
    const snap = listSnapshot;
    setListScrollAway(false);
    const done = snap == null
      ? undefined
      : host?.restoreListScroll
        ? host.restoreListScroll(snap)
        : (() => {
            const scrollEl = listScrollEl();
            if (scrollEl) scrollEl.scrollTop = snap.scrollTop;
          })();
    void Promise.resolve(done).then(() => { place('full'); });
  };

  /**
   * `full`: place from the trigger (open / window resize) — prefer right-below
   * the send button when that fits; otherwise keep the previous right/left +
   * top-align fallback, then clear overlaps with TT pills.
   * `bounds`: refresh max dims and nudge when card growth would leave the
   * table; may also shift to clear overlaps. List scroll does not re-anchor.
   * Never auto-closes — the popover stays until outside click / Escape / toggle.
   */
  const place = (mode: 'full' | 'bounds' = 'full'): boolean => {
    const pad = 8;
    const gap = 6;
    const bounds = boundaryRect();
    const maxWidth = Math.max(160, bounds.width - pad * 2);
    const maxHeight = Math.max(120, bounds.height - pad * 2);
    const table = tableEl();

    if (mode === 'bounds') {
      setPos(prev => {
        if (!prev) return prev;
        const width = Math.min(cardRef.current?.offsetWidth || 360, maxWidth);
        const height = Math.min(cardRef.current?.offsetHeight || 200, maxHeight);
        const minTop = bounds.top + pad;
        let top = prev.top;
        if (top + height > bounds.bottom - pad) {
          top = Math.max(minTop, bounds.bottom - pad - height);
        } else if (top < minTop) {
          top = minTop;
        }
        let left = prev.left;
        if (table) {
          const cleared = clearOverlaps(table, left, top, width, height, pad, gap);
          left = cleared.left;
          top = cleared.top;
        }
        if (
          prev.top === top
          && prev.left === left
          && prev.maxWidth === maxWidth
          && prev.maxHeight === maxHeight
        ) return prev;
        return { ...prev, top, left, maxWidth, maxHeight };
      });
      return true;
    }

    const b = btnRef.current?.getBoundingClientRect() ?? anchorRef.current;
    if (!b) return false;
    const width = Math.min(cardRef.current?.offsetWidth || 360, maxWidth);
    const height = Math.min(cardRef.current?.offsetHeight || 200, maxHeight);

    const minLeft = bounds.left + pad;
    const maxLeft = Math.max(minLeft, bounds.right - width - pad);
    const minTop = bounds.top + pad;
    const maxTop = Math.max(minTop, bounds.bottom - height - pad);

    // Prefer right-below the trigger when the card fits in the TT boundary.
    const belowRightLeft = b.right + gap;
    const belowRightTop = b.bottom + gap;
    const fitsBelowRight =
      belowRightLeft >= minLeft
      && belowRightTop >= minTop
      && belowRightLeft + width <= bounds.right - pad
      && belowRightTop + height <= bounds.bottom - pad;

    let left: number;
    let top: number;
    if (fitsBelowRight) {
      left = belowRightLeft;
      top = belowRightTop;
    } else {
      // Legacy fallback: right of trigger (top-aligned), else left, else clamp.
      const rightOf = b.right + gap;
      const leftOf = b.left - width - gap;
      if (rightOf + width <= bounds.right - pad) {
        left = rightOf;
      } else if (leftOf >= bounds.left + pad) {
        left = leftOf;
      } else {
        left = Math.min(Math.max(minLeft, rightOf), maxLeft);
      }
      top = b.top;
      if (top + height > bounds.bottom - pad) {
        top = Math.max(minTop, bounds.bottom - pad - height);
      } else if (top < minTop) {
        top = minTop;
      }
      top = Math.min(maxTop, Math.max(minTop, top));
    }

    if (table) {
      const cleared = clearOverlaps(table, left, top, width, height, pad, gap);
      left = cleared.left;
      top = cleared.top;
    }

    const next = { top, left, maxWidth, maxHeight };
    anchoredPosRef.current = { top: next.top, left: next.left };
    setPosAway(false);
    setPos(prev => (
      prev
      && prev.top === next.top
      && prev.left === next.left
      && prev.maxWidth === next.maxWidth
      && prev.maxHeight === next.maxHeight
        ? prev
        : next
    ));
    return true;
  };

  // Drag and overlap nudges move `pos` without re-anchoring. The chevron
  // shows until Restore runs place('full') again.
  useEffect(() => {
    if (!open || !pos || !anchoredPosRef.current) return;
    const a = anchoredPosRef.current;
    const away = a.top !== pos.top || a.left !== pos.left;
    setPosAway(prev => (prev === away ? prev : away));
  }, [open, pos]);

  const clampDragPos = (left: number, top: number) => {
    const pad = 8;
    const gap = 6;
    const bounds = boundaryRect();
    const maxWidth = pos?.maxWidth ?? Math.max(160, bounds.width - pad * 2);
    const maxHeight = pos?.maxHeight ?? Math.max(120, bounds.height - pad * 2);
    const width = Math.min(cardRef.current?.offsetWidth || 360, maxWidth);
    const height = Math.min(cardRef.current?.offsetHeight || 200, maxHeight);
    const minLeft = bounds.left + pad;
    const maxLeft = Math.max(minLeft, bounds.right - width - pad);
    const minTop = bounds.top + pad;
    const maxTop = Math.max(minTop, bounds.bottom - height - pad);
    let nextLeft = Math.min(maxLeft, Math.max(minLeft, left));
    let nextTop = Math.min(maxTop, Math.max(minTop, top));
    const table = tableEl();
    if (table) {
      const cleared = clearOverlaps(table, nextLeft, nextTop, width, height, pad, gap);
      nextLeft = cleared.left;
      nextTop = cleared.top;
    }
    return { left: nextLeft, top: nextTop };
  };

  const onDragHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !pos) return;
    const t = e.target as HTMLElement;
    if (t.closest('button, input, select, textarea, a, [role="listbox"], [role="option"]')) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: pos.left,
      origTop: pos.top,
    };
  };

  const onDragHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const next = clampDragPos(
      d.origLeft + (e.clientX - d.startX),
      d.origTop + (e.clientY - d.startY),
    );
    setPos(prev => (prev ? { ...prev, left: next.left, top: next.top } : prev));
  };

  const onDragHandlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* already released */ }
  };

  const toggle = () => {
    if (open) {
      closePopover();
      return;
    }
    anchorRef.current = btnRef.current?.getBoundingClientRect() ?? null;
    if (!place()) return;
    captureOpenScroll();
    setOpen(true);
    setFeedback(null);
    setAwaitingRead(false);
    setStatusTelegram(null);
    bumpFocus();
    void loadLast();
  };

  const loadLast = async () => {
    const gen = ++loadLastGenRef.current;
    try {
      const res = await fetch(apiUrl(
        `/api/telegrams?target_address=${encodeURIComponent(address)}&limit=1&telegram_type=Write,Response`,
      ));
      const json = await res.json();
      if (gen !== loadLastGenRef.current) return;
      const t = json.telegrams?.[0] as Telegram | undefined;
      setLast(t ?? null);
    } catch {
      if (gen !== loadLastGenRef.current) return;
      setLast(null);
    }
  };

  const seenHostTriggerId = useRef<string | undefined>(undefined);

  // Host panel mounts already open — place once, focus value, load last value.
  useLayoutEffect(() => {
    if (!panelOnly) return;
    anchorRef.current = panelAnchor ?? null;
    adoptListSnapshot(panelListSnapshot ?? null);
    seenHostTriggerId.current = panelTriggerId;
    place('full');
    bumpFocus();
    void loadLast();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- panel mount only
  }, [panelOnly]);

  // Same-GA move: host updates anchor + list snapshot without remounting.
  useLayoutEffect(() => {
    if (!panelOnly || !open || !panelAnchor) return;
    if (seenHostTriggerId.current === undefined) return;
    if (seenHostTriggerId.current === panelTriggerId) return;
    seenHostTriggerId.current = panelTriggerId;
    anchorRef.current = panelAnchor;
    adoptListSnapshot(panelListSnapshot ?? null);
    place('full');
    bumpFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOnly, open, panelTriggerId, panelAnchor, panelListSnapshot]);

  // Outside/Escape close only — never auto-dismiss on scroll/resize/overlap.
  // List scroll keeps top frozen; may nudge to clear TT pill overlaps.
  useLayoutEffect(() => {
    if (!open) return;
    place('full');
    const card = cardRef.current;
    const ro = typeof ResizeObserver !== 'undefined' && card
      ? new ResizeObserver(() => place('bounds'))
      : null;
    if (card && ro) ro.observe(card);
    const onResize = () => place('full');
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Werthilfe (DPT / value suggestions) first — field handlers stopPropagation
      // when they close one; this covers the same-tick case where the menu is
      // still mounted after the field scheduled its close.
      if (document.querySelector('[data-portaled-menu]')) return;
      closePopover();
    };
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (n instanceof Element && n.closest('[data-portaled-menu]')) return;
      // Row trigger handles toggle; don't race-close on its mousedown.
      if (n instanceof Element && n.closest('[data-send-to-ga-trigger]')) return;
      if (!cardRef.current?.contains(n) && !btnRef.current?.contains(n)) closePopover();
    };
    const nudgeForOverlaps = () => {
      const table = tableEl();
      if (!table) return;
      setPos(prev => {
        if (!prev) return prev;
        const pad = 8;
        const gap = 6;
        const width = Math.min(cardRef.current?.offsetWidth || 360, prev.maxWidth);
        const height = Math.min(cardRef.current?.offsetHeight || 200, prev.maxHeight);
        const cleared = clearOverlaps(table, prev.left, prev.top, width, height, pad, gap);
        if (cleared.left === prev.left && cleared.top === prev.top) return prev;
        return { ...prev, left: cleared.left, top: cleared.top };
      });
    };
    const onScroll = (e: Event) => {
      const table = tableEl();
      if (!table || !(e.target instanceof Node) || !table.contains(e.target)) return;
      nudgeForOverlaps();
      if (e.target instanceof HTMLElement && e.target.hasAttribute('data-telegram-scroll')) {
        syncListScrollAway(e.target.scrollTop);
      }
    };
    // TT pills can appear/disappear after open — re-clear so we never cover them.
    const tableForMo = tableEl();
    let pillSig = tableForMo?.querySelectorAll(TT_PILL_SELECTOR).length ?? 0;
    const mo = typeof MutationObserver !== 'undefined' && tableForMo
      ? new MutationObserver(() => {
          const next = tableForMo.querySelectorAll(TT_PILL_SELECTOR).length;
          if (next === pillSig) return;
          pillSig = next;
          nudgeForOverlaps();
        })
      : null;
    if (tableForMo && mo) mo.observe(tableForMo, { childList: true, subtree: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('scroll', onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open only; place/close via refs+RO
  }, [open]);

  // Live feed: refresh last value/timestamp on Write/Response; Read-wait status separate.
  const [seenLatest, setSeenLatest] = useState(latestTelegram);
  if (latestTelegram !== seenLatest) {
    setSeenLatest(latestTelegram);
    if (open && latestTelegram && latestTelegram.target_address === address) {
      if (isLastValueTelegram(latestTelegram)) {
        loadLastGenRef.current += 1;
        setLast(latestTelegram);
      }
      // A linked job's status jump comes from the row, not this local wait.
      if (awaitingRead && !linkedStatus?.job) {
        if (isReadTelegram(latestTelegram)) {
          setStatusTelegram(latestTelegram);
        } else if (isResponseTelegram(latestTelegram)) {
          setStatusTelegram(latestTelegram);
          setAwaitingRead(false);
          setFeedback(null);
        }
        // Writes never end a read wait.
      }
    }
  }

  const jobLocked = Boolean(linkedStatus?.job);

  const write = async (payload: BusPayload, response = respond) => {
    if (jobLocked) return;
    const nextDelay = sanitizeSecondsInput(delay);
    const nextEvery = sanitizeSecondsInput(every);
    if (nextDelay !== delay) setDelay(nextDelay);
    if (nextEvery !== every) setEvery(nextEvery);
    const scheduled = Boolean(nextDelay || nextEvery);
    // Scheduled or already linked → panel row owns the job / append-on-miss.
    if (onWriteWithSchedule && (scheduled || linkedRowId)) {
      onWriteWithSchedule({
        ...correspondenceKeyFromDraft({
          address, dpt, value, delay: nextDelay, every: nextEvery,
        }),
        name,
      }, payload, response ? { response: true } : undefined);
      return;
    }
    setBusy(true);
    setFeedback(null);
    setAwaitingRead(false);
    setStatusTelegram(null);
    try {
      await sendTelegram(address, payload, dpt || undefined, response);
      const shown = describeBusPayload(payload, dpt);
      setFeedback({ ok: true, msg: `${response ? 'Response' : 'Sent'} ${shown} to ${address}` });
      setTimeout(() => void loadLast(), 700);
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Send failed' });
    } finally {
      setBusy(false);
    }
  };

  const read = async () => {
    if (jobLocked || respond) return;
    const nextDelay = sanitizeSecondsInput(delay);
    const nextEvery = sanitizeSecondsInput(every);
    if (nextDelay !== delay) setDelay(nextDelay);
    if (nextEvery !== every) setEvery(nextEvery);
    const scheduled = Boolean(nextDelay || nextEvery);
    if (onReadWithSchedule && (scheduled || linkedRowId)) {
      onReadWithSchedule({
        ...correspondenceKeyFromDraft({
          address, dpt, value, delay: nextDelay, every: nextEvery,
        }),
        name,
      });
      return;
    }
    // Arm before the API returns so a fast bus Response still binds.
    setBusy(true);
    setFeedback(null);
    setStatusTelegram(null);
    setAwaitingRead(true);
    try {
      await readTelegram(address);
      setFeedback({ ok: true, msg: 'Read request sent' });
    } catch (err) {
      setAwaitingRead(false);
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Read failed' });
    } finally {
      setBusy(false);
    }
  };

  // Read wait must not lock DPT / value / send — only the in-flight request does.
  // A live panel job locks Write, Read, delay, and every until Cancel.
  const controlsDisabled = busy;
  const { retainClickFocus: retainReadFocus } = useRetainFocusThroughDisabled(controlsDisabled);
  const showValueField = needsValueColumn(dpt || null, parseDptMain(dpt));
  const readPhase = useGaReadPhase(address);

  // Same status shell as the send panel (always mounted; content when active).
  const statusJob = linkedStatus?.job ?? null;
  // Typing clears feedback, but an open read stays visible until a telegram binds.
  const statusFeedback = (
    feedback
    ?? (awaitingRead && !statusTelegram ? { ok: true, msg: 'Read request sent' } : null)
  ) ?? linkedStatus?.feedback ?? null;
  const statusTg = linkedStatus?.job
    ? (linkedStatus.statusTelegram ?? null)
    : (statusTelegram ?? linkedStatus?.statusTelegram ?? null);
  const statusShowCountdown = Boolean(
    statusJob && (statusJob.next_send_at || statusJob.state === 'waiting'),
  );
  const statusShowSendCount = Boolean(
    statusJob?.interval_seconds
    && statusJob.state === 'running'
    && (statusJob.sends_done ?? 0) > 0,
  );
  const statusHasChrome = Boolean(
    statusJob || awaitingRead || statusFeedback || statusTg || linkedStatus?.statusWatch === 'read',
  );
  const statusShowCancel = Boolean(statusJob);

  const lastHasValue = last != null && last.simplified_type !== 'Read';

  return (
    <>
      {!panelOnly && (
        <button
          ref={btnRef}
          data-send-to-ga-trigger=""
          {...(open ? { 'data-send-popover-open': '' } : {})}
          {...(panelMatched ? { 'data-send-panel-match': '' } : {})}
          {...(jobActive ? { 'data-send-job-active': '' } : {})}
          {...(busPulse ? { 'data-bus-pulse': busPulse } : {})}
          className={buttonClassName}
          tabIndex={suppressTriggerFocus ? -1 : undefined}
          style={{
            ...buttonStyle,
            color: sendTriggerColor({
              busPulse,
              jobActive,
              lit: open || panelMatched || hovered,
              fallback: buttonStyle?.color,
            }),
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onMouseDown={suppressTriggerFocus ? (e => { e.preventDefault(); }) : undefined}
          onClick={e => {
            e.stopPropagation();
            if (e.altKey) {
              onAltSend?.();
              return;
            }
            if (e.ctrlKey || e.metaKey) {
              onCtrlSend?.({ address, name, dptMain, dptSub });
              return;
            }
            toggle();
          }}
          title={title}
        >
          <Send key={sendIconEpoch} size={12} />
        </button>
      )}

      {open && pos && createPortal(
        <div
          ref={cardRef}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 1000,
            width: 'max-content', maxWidth: pos.maxWidth, maxHeight: pos.maxHeight,
            minWidth: Math.min(280, pos.maxWidth), overflow: 'auto',
            background: 'var(--bg-panel)', backdropFilter: 'var(--glass-blur)',
            border: '1px solid var(--border-color)', borderRadius: 10, boxShadow: 'var(--shadow-lg)',
            padding: '0.7rem 0.8rem', display: 'flex', flexDirection: 'column', gap: '0.55rem',
            boxSizing: 'border-box',
          }}
        >
          <div
            data-send-popover-drag-handle=""
            onPointerDown={onDragHandlePointerDown}
            onPointerMove={onDragHandlePointerMove}
            onPointerUp={onDragHandlePointerUp}
            onPointerCancel={onDragHandlePointerUp}
            style={{
              display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap',
              cursor: 'grab', touchAction: 'none', userSelect: 'none',
            }}
            title="Drag to move"
          >
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent-primary)' }}>{address}</span>
            {name && <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>{name}</span>}
            {(listScrollAway || posAway) && (
              <button
                type="button"
                className="quick-filter-bar-toggle"
                title="Restore list position"
                aria-label="Restore list position"
                onClick={restoreOpenScroll}
                style={{ flexShrink: 0, margin: 0, cursor: 'pointer' }}
              >
                <ChevronLeft size={13} />
              </button>
            )}
          </div>

          {lastHasValue && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
              <span>
                Last value:{' '}
                <BusValueText
                  value={last}
                  dpt={dpt}
                  as="span"
                  pulse={last.direction === 'Incoming' || last.direction === 'Outgoing' ? last.direction : null}
                  pulseKey={last.timestamp}
                />
              </span>
              <TelegramWhenJump
                timestamp={last.timestamp}
                eventType={telegramEventType(last)}
                onJump={onGotoTelegram ? () => { onGotoTelegram(last); } : undefined}
              />
            </div>
          )}

          {(() => {
            const showValue = showValueField;
            const readBtn = (
              <button
                type="button"
                className="wtb-read-btn"
                onClick={e => {
                  retainReadFocus(e);
                  if (e.ctrlKey || e.metaKey) {
                    if (jobLocked || controlsDisabled) return;
                    setRespond(v => !v);
                    return;
                  }
                  void read();
                }}
                disabled={controlsDisabled || jobLocked}
                style={secondaryBtn(controlsDisabled || jobLocked, Boolean(statusJob && !statusJob.read))}
                title={
                  jobLocked
                    ? `${respond ? 'Response' : 'Read'} (locked while this job is running)`
                    : respond
                      ? 'Write buttons send a GroupValueResponse · ctrl/cmd-click to switch to Read'
                      : 'Send a GroupValueRead; the response updates last value · ctrl/cmd-click so Write buttons send a Response'
                }
              >
                <EventTypeLabel
                  kind={respond ? 'Response' : 'Read'}
                  showIcon
                  phase={readPhase}
                  iconDim={
                    controlsDisabled || jobLocked
                      ? (statusJob && !statusJob.read ? 'muted' : 'disabled')
                      : undefined
                  }
                  iconSize={13}
                />
              </button>
            );
            const scheduleLocked = Boolean(linkedStatus?.job);
            return (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'max-content minmax(0, 1fr)',
                  gridTemplateAreas: showValue
                    ? `
                      "dpt sched"
                      "value value"
                      "write read"
                    `
                    : `
                      "dpt sched"
                      "write read"
                    `,
                  columnGap: '0.4rem',
                  rowGap: '0.65rem',
                  alignItems: 'center',
                  width: '100%',
                }}
              >
                <div style={{ gridArea: 'dpt', minWidth: '11rem', width: 'max-content' }}>
                  <DptField
                    value={dpt}
                    options={dptOptions}
                    disabled={controlsDisabled}
                    overridden={overridden}
                    title={
                      overridden
                        ? `Overriding project DPT ${projectDpt}`
                        : 'Datapoint type, e.g. 5.010 (defaults to the project DPT)'
                    }
                    onChange={onDptChange}
                    onReset={() => { setDpt(projectDpt); setValue(''); setFeedback(null); }}
                    resetValue={projectDpt}
                    resetTitle={`Reset to project DPT ${projectDpt}`}
                  />
                </div>
                <div
                  style={{
                    gridArea: 'sched',
                    display: 'flex',
                    alignItems: 'center',
                    columnGap: '0.4rem',
                    width: 'max-content',
                    justifySelf: 'start',
                  }}
                >
                  <SecondsField
                    placeholder="delay"
                    value={delay}
                    onChange={setDelay}
                    disabled={controlsDisabled || scheduleLocked}
                    title={
                      scheduleLocked
                        ? 'delay (locked while this job is running)'
                        : 'delay'
                    }
                    onBlur={sanitized => commitScheduleLink({ delay: sanitized })}
                    onKeyDown={scheduleEnter}
                  />
                  <SecondsField
                    placeholder="every"
                    value={every}
                    onChange={setEvery}
                    disabled={controlsDisabled || scheduleLocked}
                    title={
                      scheduleLocked
                        ? 'every (locked while this job is running)'
                        : 'every'
                    }
                    onBlur={sanitized => commitScheduleLink({ every: sanitized })}
                    onKeyDown={scheduleEnter}
                  />
                </div>
                <WriteControls
                  dptMain={parseDptMain(dpt)}
                  dptKey={dpt || null}
                  address={address}
                  value={value}
                  onValueChange={v => { setValue(v); setFeedback(null); }}
                  onWrite={payload => void write(payload)}
                  onError={msg => setFeedback({ ok: false, msg })}
                  disabled={controlsDisabled}
                  sendLocked={jobLocked}
                  activeJob={statusJob}
                  unit={(dpt.trim() ? dptUnit(dpt.trim()) : '') || last?.unit || ''}
                  sendFit="hug"
                  focusToken={focusToken}
                  valueColProps={showValue
                    ? {
                        style: { gridArea: 'value', width: '100%', minWidth: 0 },
                        onBlur: commitScheduleLink,
                      }
                    : { style: { display: 'none' } }}
                  sendColProps={{
                    style: {
                      gridArea: 'write',
                      width: 'max-content',
                      justifySelf: 'start',
                    },
                  }}
                  reserveValueSlot={false}
                />
                <div style={{ gridArea: 'read', width: 'max-content', justifySelf: 'end' }}>
                  {readBtn}
                </div>
              </div>
            );
          })()}

          <SendJobStatusField
            feedback={statusFeedback}
            job={statusJob}
            showCountdownCol={statusShowCountdown}
            showSendCountCol={statusShowSendCount}
            showEventCols={statusTg != null}
            showActionCol={statusHasChrome}
            actionWidth={statusShowCancel ? STATUS_ACTION_WIDTH : STATUS_CLEAR_WIDTH}
            statusTelegram={statusTg}
            address={linkedStatus?.address ?? address}
            groupName={linkedStatus?.name ?? name ?? ''}
            value={linkedStatus?.value ?? value}
            dpt={linkedStatus?.dpt ?? dpt}
            onCancel={() => {
              if (statusJob) onCancelLinked?.(linkedStatus?.rowId);
            }}
            onClear={() => {
              setFeedback(null);
              setStatusTelegram(null);
              setAwaitingRead(false);
            }}
            onJump={() => {
              if (statusTg && onGotoTelegram) onGotoTelegram(statusTg);
            }}
          />
        </div>,
        document.body
      )}
    </>
  );
}
