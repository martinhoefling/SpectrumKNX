import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Send, Radio, AlertTriangle, Clock, Timer, X } from 'lucide-react';

import { apiUrl } from '../utils/basePath';
import { formatDpt, parseDptMain, readTelegram, sendTelegram } from '../utils/knxSend';
import { buildWriteDptOptions, dptUnit } from '../utils/dpt';
import { describeBusPayload, type BusPayload } from '../utils/dptValues';
import type { FilterOption } from '../types/filters';
import type { Telegram } from '../hooks/useWebSocket';
import { useDptCatalog } from './DptCatalogContext';
import { DptField } from './DptField';
import { WriteControls } from './WriteControls';
import { BusValueText } from './BusValueText';
import { TelegramWhenJump, telegramEventType } from './TelegramWhenJump';
import { secondaryBtn } from '../utils/buttonStyles';
import {
  sanitizeSecondsInput,
  correspondenceKeyFromDraft,
  type SendCorrespondenceKey,
} from '../utils/sendCorrespondence';
import type { LinkedRowStatus } from './WriteToBusPanel';

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
  restoreListScroll: ((snap: ListScrollSnapshot) => void) | null;
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
  onScheduleCommit,
  onWriteWithSchedule,
  onCancelLinked,
  onAltSend,
  onCtrlSend,
}: {
  children: React.ReactNode;
  latestTelegram?: Telegram | null;
  onGotoTelegram?: (telegram: Telegram) => void;
  captureListScroll?: () => ListScrollSnapshot | null;
  restoreListScroll?: (snap: ListScrollSnapshot) => void;
  linkedRowId?: string | null;
  linkedStatus?: LinkedRowStatus | null;
  onScheduleCommit?: (draft: SendCorrespondenceKey & { name?: string | null }) => void;
  onWriteWithSchedule?: (
    draft: SendCorrespondenceKey & { name?: string | null },
    payload: BusPayload,
  ) => void;
  onCancelLinked?: () => void;
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
          linkedRowId={linkedRowId}
          linkedStatus={linkedStatus}
          onScheduleCommit={onScheduleCommit}
          onWriteWithSchedule={onWriteWithSchedule}
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
  /** Send panel top-row matches this GA — keep the icon blue while the panel is open. */
  panelMatched?: boolean;
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
  ) => void;
  onCancelLinked?: () => void;
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

function isReadRequestFeedback(feedback: { ok: boolean; msg: string } | null): boolean {
  return Boolean(feedback?.ok && /^Read request/i.test(feedback.msg));
}

function isSentFeedback(feedback: { ok: boolean; msg: string } | null): boolean {
  return Boolean(feedback?.ok && /^Sent /i.test(feedback.msg));
}

function rectsOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

/**
 * Push `left` right past any send trigger that intersects the proposed card
 * rect (even partially). Clamps to the table boundary; may still overlap when
 * there is no room — callers never auto-close for that.
 */
function clearSendOverlaps(
  table: Element,
  left: number,
  top: number,
  width: number,
  height: number,
  pad: number,
  gap: number,
): number {
  const bounds = table.getBoundingClientRect();
  const maxLeft = Math.max(bounds.left + pad, bounds.right - width - pad);
  const triggers = table.querySelectorAll('[data-send-to-ga-trigger]');
  let next = left;
  for (let guard = 0; guard < 8; guard += 1) {
    const card = { left: next, top, right: next + width, bottom: top + height };
    let nudged = next;
    triggers.forEach(el => {
      const r = el.getBoundingClientRect();
      if (rectsOverlap(card, r)) nudged = Math.max(nudged, r.right + gap);
    });
    if (nudged === next) break;
    next = nudged;
  }
  if (next + width > bounds.right - pad) next = maxLeft;
  return next;
}

/**
 * Shift the card so it does not cover the jump-to-live pill (centered at the
 * live edge). Prefer vertical clearance; fall back to horizontal.
 */
function clearLivePillOverlap(
  table: Element,
  left: number,
  top: number,
  width: number,
  height: number,
  pad: number,
  gap: number,
): { left: number; top: number } {
  const pill = table.querySelector('[data-jump-to-live-pill]');
  if (!pill) return { left, top };
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

function clearOverlaps(
  table: Element,
  left: number,
  top: number,
  width: number,
  height: number,
  pad: number,
  gap: number,
): { left: number; top: number } {
  const afterSend = clearSendOverlaps(table, left, top, width, height, pad, gap);
  return clearLivePillOverlap(table, afterSend, top, width, height, pad, gap);
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
  suppressTriggerFocus = false,
  linkedRowId = null,
  linkedStatus = null,
  onScheduleCommit,
  onWriteWithSchedule,
  onCancelLinked,
}: Props) {
  const host = useContext(SendToGaHostContext);
  const [hovered, setHovered] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Inside a host: only the trigger lives in the (virtualized) row. The panel
  // is rendered by SendToGaHost so scrolling the list cannot unmount it.
  if (host && !panelOnly) {
    const active = host.activeAddress === address;
    const lit = active || panelMatched || hovered;
    return (
      <button
        ref={btnRef}
        data-send-to-ga-trigger=""
        {...(active ? { 'data-send-popover-open': '' } : {})}
        {...(panelMatched ? { 'data-send-panel-match': '' } : {})}
        className={buttonClassName}
        tabIndex={suppressTriggerFocus ? -1 : undefined}
        style={{
          ...buttonStyle,
          color: lit ? 'var(--accent-primary)' : (buttonStyle?.color || 'var(--text-dim)')
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
        <Send size={12} />
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
      suppressTriggerFocus={suppressTriggerFocus}
      linkedRowId={linkedRowId}
      linkedStatus={linkedStatus}
      onScheduleCommit={onScheduleCommit}
      onWriteWithSchedule={onWriteWithSchedule}
      onCancelLinked={onCancelLinked}
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
  suppressTriggerFocus = false,
  linkedRowId = null,
  linkedStatus = null,
  onScheduleCommit,
  onWriteWithSchedule,
  onCancelLinked,
}: Props) {
  const host = useContext(SendToGaHostContext);
  const [open, setOpen] = useState(panelOnly);
  const [hovered, setHovered] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<AnchorRect | null>(panelAnchor ?? null);
  const [pos, setPos] = useState<{ top: number; left: number; maxWidth: number; maxHeight: number } | null>(null);
  /** List position captured when this popover opened (restore jump). */
  const [listSnapshot, setListSnapshot] = useState<ListScrollSnapshot | null>(panelListSnapshot);
  const bumpFocus = () => setFocusToken(t => t + 1);

  const [value, setValue] = useState('');
  const [delay, setDelay] = useState('');
  const [every, setEvery] = useState('');
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

  const scheduleFieldProps = {
    onBlur: commitScheduleLink,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitScheduleLink();
      }
    },
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
    setListSnapshot(null);
    onPanelClose?.();
  };

  const captureOpenScroll = () => {
    if (host?.captureListScroll) {
      setListSnapshot(host.captureListScroll());
      return;
    }
    const scrollEl = tableEl()?.querySelector('[data-telegram-scroll]') as HTMLElement | null;
    if (!scrollEl) {
      setListSnapshot(null);
      return;
    }
    setListSnapshot({ scrollTop: scrollEl.scrollTop, key: null, offset: 0 });
  };

  const restoreOpenScroll = () => {
    if (!listSnapshot) return;
    if (host?.restoreListScroll) {
      host.restoreListScroll(listSnapshot);
      return;
    }
    const scrollEl = tableEl()?.querySelector('[data-telegram-scroll]') as HTMLElement | null;
    if (scrollEl) scrollEl.scrollTop = listSnapshot.scrollTop;
  };

  /**
   * `full`: place from the trigger (open / window resize) — prefer right of the
   * send button so the trigger stays visible; fall back to the left side; then
   * clear any (partial) overlap with other send triggers by shifting right.
   * `bounds`: refresh max dims and nudge `top` up when card growth would paint
   * past the table bottom; may also shift `left` right to clear send overlaps.
   * List scroll does not re-anchor to the trigger (top stays frozen).
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
    // Prefer right of the trigger so the send button stays visible; flip left
    // when that would leave the boundary; clamp only as a last resort.
    const rightOf = b.right + gap;
    const leftOf = b.left - width - gap;
    let left = rightOf;
    if (rightOf + width <= bounds.right - pad) {
      left = rightOf;
    } else if (leftOf >= bounds.left + pad) {
      left = leftOf;
    } else {
      left = Math.min(Math.max(minLeft, rightOf), maxLeft);
    }

    // Top-align with the trigger; clamp vertically inside the boundary.
    const minTop = bounds.top + pad;
    let top = b.top;
    if (top + height > bounds.bottom - pad) {
      top = Math.max(minTop, bounds.bottom - pad - height);
    } else if (top < minTop) {
      top = minTop;
    }

    if (table) {
      const cleared = clearOverlaps(table, left, top, width, height, pad, gap);
      left = cleared.left;
      top = cleared.top;
    }

    const next = { top, left, maxWidth, maxHeight };
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
    setListSnapshot(panelListSnapshot ?? null);
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
    setListSnapshot(panelListSnapshot ?? null);
    place('full');
    bumpFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOnly, open, panelTriggerId, panelAnchor, panelListSnapshot]);

  // Outside/Escape close only — never auto-dismiss on scroll/resize/overlap.
  // List scroll keeps top frozen; may shift left right to clear send overlaps.
  useLayoutEffect(() => {
    if (!open) return;
    place('full');
    const card = cardRef.current;
    const ro = typeof ResizeObserver !== 'undefined' && card
      ? new ResizeObserver(() => place('bounds'))
      : null;
    if (card && ro) ro.observe(card);
    const onResize = () => place('full');
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePopover(); };
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
    };
    // Live pill can appear after open (follow paused + newer telegrams) — re-clear.
    const tableForMo = tableEl();
    let hadPill = Boolean(tableForMo?.querySelector('[data-jump-to-live-pill]'));
    const mo = typeof MutationObserver !== 'undefined' && tableForMo
      ? new MutationObserver(() => {
          const hasPill = Boolean(tableForMo.querySelector('[data-jump-to-live-pill]'));
          if (hasPill === hadPill) return;
          hadPill = hasPill;
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
      if (awaitingRead) {
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

  const write = async (payload: BusPayload) => {
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
      }, payload);
      return;
    }
    setBusy(true);
    setFeedback(null);
    setAwaitingRead(false);
    setStatusTelegram(null);
    try {
      await sendTelegram(address, payload, dpt || undefined);
      const shown = describeBusPayload(payload, dpt);
      setFeedback({ ok: true, msg: `Sent ${shown} to ${address}` });
      setTimeout(() => void loadLast(), 700);
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Send failed' });
    } finally {
      setBusy(false);
    }
  };

  const read = async () => {
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

  const unansweredRead = awaitingRead || isReadRequestFeedback(feedback);
  const pendingReadTip = 'read request sent';
  const responseOk = !awaitingRead && isResponseTelegram(statusTelegram);
  const responseTip = 'read response detected';
  const showStatus = Boolean(feedback || awaitingRead || statusTelegram);
  // Read wait must not lock DPT / value / send — only the in-flight request does.
  const controlsDisabled = busy;

  let statusIcon = null;
  let statusColor = 'var(--success)';
  let statusText: string | null = null;
  if (feedback && !feedback.ok) {
    statusIcon = <AlertTriangle size={13} style={{ flexShrink: 0 }} />;
    statusColor = 'var(--error)';
    statusText = feedback.msg;
  } else if (unansweredRead) {
    statusIcon = <Radio size={13} style={{ color: 'var(--warning)', flexShrink: 0 }} />;
    statusColor = 'var(--warning)';
    statusText = pendingReadTip;
  } else if (responseOk) {
    statusIcon = <Radio size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />;
    statusColor = 'var(--success)';
    statusText = responseTip;
  } else if (isSentFeedback(feedback)) {
    statusIcon = <Send size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />;
    statusColor = 'var(--success)';
    statusText = feedback!.msg;
  } else if (feedback?.ok) {
    statusIcon = <Send size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />;
    statusColor = 'var(--success)';
    statusText = feedback.msg;
  }

  const lastHasValue = last != null && last.simplified_type !== 'Read';

  return (
    <>
      {!panelOnly && (
        <button
          ref={btnRef}
          data-send-to-ga-trigger=""
          {...(open ? { 'data-send-popover-open': '' } : {})}
          {...(panelMatched ? { 'data-send-panel-match': '' } : {})}
          className={buttonClassName}
          tabIndex={suppressTriggerFocus ? -1 : undefined}
          style={{
            ...buttonStyle,
            color: (open || panelMatched || hovered) ? 'var(--accent-primary)' : (buttonStyle?.color || 'var(--text-dim)')
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
          <Send size={12} />
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
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent-primary)' }}>{address}</span>
            {name && <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>{name}</span>}
            {listSnapshot != null && (
              <button
                type="button"
                className="quick-filter-bar-toggle"
                title="Restore list position"
                aria-label="Restore list position"
                onClick={restoreOpenScroll}
                style={{ flexShrink: 0, margin: 0 }}
              >
                <Clock size={13} />
              </button>
            )}
          </div>

          {lastHasValue && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
              <span>
                Last value:{' '}
                <BusValueText value={last} dpt={dpt} as="span" />
              </span>
              <TelegramWhenJump
                timestamp={last.timestamp}
                eventType={telegramEventType(last)}
                onJump={onGotoTelegram ? () => { onGotoTelegram(last); } : undefined}
              />
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(11rem, max-content) max-content',
              gridTemplateAreas: `
                "dpt value"
                "write write"
              `,
              columnGap: '0.4rem',
              rowGap: '0.65rem',
              alignItems: 'center',
              justifyContent: 'start',
              width: 'max-content',
              maxWidth: '100%',
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
                resetTitle={`Reset to project DPT ${projectDpt}`}
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
              unit={(dpt.trim() ? dptUnit(dpt.trim()) : '') || last?.unit || ''}
              sendFit="hug"
              focusToken={focusToken}
              valueColProps={{
                style: { gridArea: 'value', width: 'max-content' },
                onBlur: commitScheduleLink,
              }}
              sendColProps={{ style: { gridArea: 'write', width: '100%' } }}
              reserveValueSlot={false}
              sendEnd={(
                <button
                  type="button"
                  className="wtb-read-btn"
                  onClick={() => void read()}
                  disabled={controlsDisabled}
                  style={secondaryBtn(controlsDisabled)}
                  title="Send a GroupValueRead; the response updates last value"
                >
                  <Radio size={13} /> Read
                </button>
              )}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
              delay
              <input
                className="glass-input"
                value={delay}
                disabled={controlsDisabled || Boolean(linkedStatus?.job)}
                placeholder="s"
                title="Delay before first send (seconds)"
                style={{ width: '3.2rem', padding: '0.2rem 0.35rem', fontSize: '0.72rem' }}
                onChange={e => setDelay(e.target.value)}
                {...scheduleFieldProps}
              />
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
              every
              <input
                className="glass-input"
                value={every}
                disabled={controlsDisabled || Boolean(linkedStatus?.job)}
                placeholder="s"
                title="Cyclic interval (seconds)"
                style={{ width: '3.2rem', padding: '0.2rem 0.35rem', fontSize: '0.72rem' }}
                onChange={e => setEvery(e.target.value)}
                {...scheduleFieldProps}
              />
            </label>
          </div>

          {linkedStatus?.job && (
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap',
                fontSize: '0.72rem', color: 'var(--accent-primary)',
              }}
            >
              <Timer size={12} />
              <span>
                {linkedStatus.job.state}
                {linkedStatus.job.sends_done != null ? ` · ${linkedStatus.job.sends_done} sent` : ''}
              </span>
              {onCancelLinked && (
                <button
                  type="button"
                  className="wtb-read-btn"
                  onClick={() => onCancelLinked()}
                  style={secondaryBtn(false)}
                  title="Cancel scheduled send"
                >
                  <X size={12} /> Cancel
                </button>
              )}
            </div>
          )}

          {showStatus && (statusIcon || statusText) && (
            <div
              data-status-field
              aria-label={unansweredRead ? pendingReadTip : responseOk ? responseTip : undefined}
              title={unansweredRead ? pendingReadTip : responseOk ? responseTip : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap',
                fontSize: '0.72rem',
                color: statusColor,
              }}
            >
              {statusIcon}
              {statusText ? <span>{statusText}</span> : null}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
