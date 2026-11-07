import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Radio, Plus, Trash2, AlertTriangle, CheckCircle2, Timer, RotateCcw, Clock } from 'lucide-react';

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
  type ScheduledSendStatus,
} from '../utils/knxSend';
import { GaCombobox } from './GaCombobox';
import { WriteControls } from './WriteControls';
import { secondaryBtn } from '../utils/buttonStyles';
import { loadRecentGas, pushRecentGa } from '../utils/recentGas';
import { dptDesignation } from '../utils/dpt';

interface Props {
  /** Group addresses from the loaded project (with optional DPT main/sub). */
  targets: FilterOption[];
  onClose: () => void;
  /** Newest telegram from the live feed; keeps each row's last value current (#439). */
  latestTelegram?: Telegram | null;
  /** Project DPT catalog (`label` is "5.001 - Percent") so hints can name types the project uses. */
  dptCatalog?: FilterOption[];
  /** Jump the telegram list to the telegram that carried this row's last value. */
  onGotoTelegram?: (telegram: Telegram) => void;
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
  busy: boolean;
  feedback: { ok: boolean; msg: string } | null;
  /**
   * Set by Read: the timestamp of the value shown when the request went out
   * ('' when there was none). The row is "waiting for a response" for as long
   * as the shown value is still that one. Compared by identity, not by clock,
   * so browser/server time differences cannot matter.
   */
  readBaseline: string | null;
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

// Common DPTs offered as datalist hints when overriding a GA's type (#342).
// The input stays free-text; these just guide the frequent cases.
const COMMON_DPTS = [
  '1.001', '1.002', '2.001', '3.007', '4.001', '5.001', '5.004', '5.010',
  '6.010', '7.001', '8.001', '9.001', '9.004', '10.001', '11.001', '12.001',
  '13.001', '14.056', '16.000', '17.001', '18.001', '19.001', '20.102', '232.600',
];

let rowSeq = 0;
const newRow = (): Row => ({
  id: `row-${rowSeq++}`, address: '', name: '', dpt: '', value: '', delay: '', every: '', busy: false, feedback: null,
  readBaseline: null,
});

// ── Row persistence (#254) ───────────────────────────────────────────────────
// The panel unmounts when toggled off; without this every configured row would
// be lost. Only the durable inputs are stored — busy/feedback are transient,
// and scheduled jobs live server-side (re-attached via the status poll).

const ROWS_STORAGE_KEY = 'spectrumknx-write-panel-rows';
const MAX_STORED_ROWS = 20;

type StoredRow = Pick<Row, 'address' | 'dpt' | 'value' | 'delay' | 'every'>;

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
        dpt: str(s?.dpt),
        value: str(s?.value),
        delay: str(s?.delay),
        every: str(s?.every),
      };
    });
  } catch {
    return null;
  }
}

function saveRows(rows: Row[]): void {
  try {
    const stored: StoredRow[] = rows.map(({ address, dpt, value, delay, every }) => ({
      address, dpt, value, delay, every,
    }));
    localStorage.setItem(ROWS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage unavailable — the rows just won't survive the next toggle.
  }
}

/**
 * "Write to bus" panel: send to several group addresses from stacked rows,
 * each with its own GA/DPT/value/Write/Read and optional delay/cyclic
 * scheduling, plus per-row add/remove (#215).
 *
 * The backend runs a single scheduled (delayed/cyclic) job at a time, so at
 * most one row can have an active timer; immediate writes/reads work on any
 * row regardless. Removing the row that owns the active job cancels it first.
 *
 * Rows persist to localStorage so toggling the panel keeps its state (#254).
 */
export function WriteToBusPanel({ targets, latestTelegram, dptCatalog = [], onGotoTelegram }: Props) {
  const [rows, setRows] = useState<Row[]>(() => loadStoredRows() ?? [newRow()]);
  const [recentGas, setRecentGas] = useState<string[]>(loadRecentGas);
  const [job, setJob] = useState<ScheduledSendStatus | null>(null);
  const pollRef = useRef<number | null>(null);
  const watchingRef = useRef(false);

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
  const dptOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const key of COMMON_DPTS) byKey.set(key, dptDesignation(key));
    for (const t of targets) {
      if (t.main == null) continue;
      const key = formatDpt(t.main, t.sub);
      if (!byKey.has(key)) byKey.set(key, '');
    }
    for (const d of dptCatalog) {
      if (d.main == null) continue;
      const key = formatDpt(d.main, d.sub);
      const name = dptDesignation(key, d.label);
      if (name) byKey.set(key, name);
      else if (!byKey.has(key)) byKey.set(key, '');
    }
    return [...byKey.entries()]
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => {
        const [am, as = 0] = a.key.split('.').map(Number);
        const [bm, bs = 0] = b.key.split('.').map(Number);
        return am - bm || as - bs;
      });
  }, [targets, dptCatalog]);

  // Last value per row (#439): fetched once per entered GA, then kept current
  // from the live feed — which keeps flowing while the telegram list is paused,
  // so a read's response shows up here without hunting for it in the list.
  const rowAddresses = useMemo(
    () => rows.map(r => r.address.trim()).filter(a => GA_RE.test(a)),
    [rows],
  );
  const lastValues = useLastSeenValues(rowAddresses, latestTelegram, { ignoreReads: true });

  const jobActive = job != null && (job.state === 'waiting' || job.state === 'running');

  // Pick up an already-active job (e.g. after a page reload) and clean up the poller.
  useEffect(() => {
    void refreshJob();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveRows(rows);
  }, [rows]);

  const updateRow = (id: string, patch: Partial<Row>) =>
    setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));

  const addRowAfter = (id: string) => {
    setRows(rs => {
      const index = rs.findIndex(r => r.id === id);
      const next = newRow();
      if (index < 0) return [...rs, next];
      return [...rs.slice(0, index + 1), next, ...rs.slice(index + 1)];
    });
  };

  const removeRow = async (id: string) => {
    const row = rows.find(r => r.id === id);
    // Removing the row that owns the running timer must cancel it, so we don't
    // leave an untracked cyclic send firing (TabSel, forum post #130).
    if (row && jobActive && job?.address === row.address.trim()) {
      await cancelScheduledSend().catch(() => {});
      await refreshJob();
    }
    setRows(rs => (rs.length > 1 ? rs.filter(r => r.id !== id) : rs));
  };

  const applyResolved = (id: string, option: FilterOption) => {
    updateRow(id, {
      address: option.address ?? '',
      name: option.name ?? '',
      feedback: null,
      readBaseline: null,
      dpt: option.main != null ? formatDpt(option.main, option.sub) : '',
    });
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
      feedback: null,
      readBaseline: null,
      dpt: match && match.main != null ? formatDpt(match.main, match.sub) : '',
    });
  };

  const onAddressCommit = (id: string, text: string) => {
    const match = byAddress.get(text.trim());
    updateRow(id, { name: match?.name ?? '' });
  };

  const onNameChange = (id: string, next: string, option?: FilterOption) => {
    if (option) {
      applyResolved(id, option);
      return;
    }
    updateRow(id, { name: next, feedback: null });
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
    updateRow(id, { name: text, address: '', dpt: '', feedback: null, readBaseline: null });
  };

  // Editable DPT (#342): overriding the project default. When the DPT *main*
  // changes the write widget switches (On/Off ↔ pickers ↔ free value), so a
  // stale value must be cleared to avoid sending it to the new widget.
  const onDptChange = (id: string, next: string) => {
    const row = rows.find(r => r.id === id);
    const mainChanged = row && parseDptMain(row.dpt) !== parseDptMain(next);
    updateRow(id, { dpt: next, feedback: null, ...(mainChanged ? { value: '' } : {}) });
  };

  const write = async (row: Row, payload: boolean | number | string) => {
    const delaySeconds = parseFloat(row.delay) || 0;
    const intervalSeconds = parseFloat(row.every) || 0;
    const scheduled = delaySeconds > 0 || intervalSeconds > 0;
    updateRow(row.id, { busy: true, feedback: null });
    try {
      if (scheduled) {
        await startScheduled(row, payload, delaySeconds, intervalSeconds);
      } else {
        await sendTelegram(row.address.trim(), payload, row.dpt.trim() || undefined);
        const shown = typeof payload === 'boolean' ? (payload ? 'on' : 'off') : row.value || '(raw)';
        updateRow(row.id, { feedback: { ok: true, msg: `Sent ${shown} to ${row.address.trim()}` } });
      }
      setRecentGas(pushRecentGa(row.address.trim()));
    } catch (err) {
      updateRow(row.id, { feedback: { ok: false, msg: err instanceof Error ? err.message : 'Request failed' } });
    } finally {
      updateRow(row.id, { busy: false });
    }
  };

  const read = async (row: Row) => {
    updateRow(row.id, { busy: true, feedback: null });
    try {
      await readTelegram(row.address.trim());
      updateRow(row.id, {
        feedback: { ok: true, msg: `Read request sent to ${row.address.trim()}` },
        readBaseline: lastValues[row.address.trim()]?.timestamp ?? '',
      });
      setRecentGas(pushRecentGa(row.address.trim()));
    } catch (err) {
      updateRow(row.id, { feedback: { ok: false, msg: err instanceof Error ? err.message : 'Request failed' } });
    } finally {
      updateRow(row.id, { busy: false });
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '0.5rem',
      padding: '0.6rem 0.85rem', flexShrink: 0, width: '100%',
      background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)',
    }}>
      {rows.map(row => {
        const known = byAddress.get(row.address.trim());
        // The write widget follows the row's *effective* (possibly overridden)
        // DPT, not the project default (#342).
        const dptMain = parseDptMain(row.dpt);
        const projectDpt = known && known.main != null ? formatDpt(known.main, known.sub) : '';
        const overridden = projectDpt !== '' && row.dpt.trim() !== projectDpt;
        const addressValid = GA_RE.test(row.address.trim());
        const lastTelegram = addressValid ? lastValues[row.address.trim()] : undefined;
        const lastHasValue = lastTelegram != null && lastTelegram.simplified_type !== 'Read';
        const scheduledDisabled = row.busy || !addressValid;
        // A GA's telegram length is fixed by its project DPT main, so the hint
        // lists only that main's subtypes (5.001 may become 5.010, not 9.001).
        const allowedDpts = known?.main == null
          ? []
          : dptOptions.filter(o => Number(o.key.split('.')[0]) === known.main);
        return (
          <div key={row.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap', width: '100%' }}>
              {/* Left Group: address and name, each with the same suggestion list */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: '1 1 auto', minWidth: '180px' }}>
                <GaCombobox
                  value={row.address}
                  onChange={(next, option) => onAddressChange(row.id, next, option)}
                  onCommit={text => onAddressCommit(row.id, text)}
                  options={targets}
                  recentAddresses={recentGas}
                  placeholder="Group address (e.g. 1/2/3)"
                  width={150}
                />
                <div style={{ flex: '1 1 200px', minWidth: 160 }}>
                  <GaCombobox
                    display="name"
                    value={row.name}
                    onChange={(next, option) => onNameChange(row.id, next, option)}
                    onCommit={text => onNameCommit(row.id, text)}
                    options={targets}
                    recentAddresses={recentGas}
                    placeholder="Group name"
                    width="100%"
                  />
                </div>
                {addressValid && (
                  <LastValue
                    telegram={lastTelegram}
                    awaiting={row.readBaseline != null && (lastTelegram?.timestamp ?? '') === row.readBaseline}
                  />
                )}
                {lastHasValue && lastTelegram && (
                  <button
                    type="button"
                    className="quick-filter-bar-toggle"
                    title="Go to telegram"
                    aria-label="Go to telegram"
                    onClick={() => onGotoTelegram?.(lastTelegram)}
                  >
                    <Clock size={13} />
                  </button>
                )}
              </div>

              {/* Right Group: Action controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', flexShrink: 0 }}>
                <WriteControls
                  dptMain={dptMain}
                  dptKey={row.dpt || null}
                  address={row.address || null}
                  value={row.value}
                  onValueChange={v => updateRow(row.id, { value: v, feedback: null })}
                  onWrite={payload => void write(row, payload)}
                  disabled={scheduledDisabled}
                />

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>DPT</span>
                  <DptField
                    value={row.dpt}
                    options={allowedDpts}
                    disabled={!addressValid}
                    overridden={overridden}
                    title={
                      !addressValid
                        ? 'Enter a group address first'
                        : overridden
                          ? `Overriding project DPT ${projectDpt}`
                          : 'Datapoint type, e.g. 5.010 (defaults to the project DPT)'
                    }
                    onChange={next => onDptChange(row.id, next)}
                  />
                  {overridden && (
                    <button
                      className="icon-button"
                      onClick={() => updateRow(row.id, { dpt: projectDpt, value: '', feedback: null })}
                      title={`Reset to project DPT ${projectDpt}`}
                      style={{ color: 'var(--text-dim)', padding: '0.1rem' }}
                    >
                      <RotateCcw size={13} />
                    </button>
                  )}
                </div>

                <input
                  className="glass-input"
                  placeholder="Delay s"
                  value={row.delay}
                  onChange={e => updateRow(row.id, { delay: e.target.value, feedback: null })}
                  title="Wait this many seconds before sending"
                  style={{ width: 70 }}
                />

                <input
                  className="glass-input"
                  placeholder="Every s"
                  value={row.every}
                  onChange={e => updateRow(row.id, { every: e.target.value, feedback: null })}
                  title="Repeat the send at this interval in seconds (min 1) until cancelled"
                  style={{ width: 70 }}
                />

                <button
                  onClick={() => void read(row)}
                  disabled={row.busy || !addressValid}
                  style={secondaryBtn(row.busy || !addressValid)}
                  title="Send a GroupValueRead; the response shows up as this row's last value"
                >
                  <Radio size={14} /> Read
                </button>

                <button
                  className="icon-button"
                  onClick={() => void removeRow(row.id)}
                  disabled={rows.length === 1}
                  title={rows.length === 1 ? 'At least one row is required' : 'Delete this row'}
                  style={{ color: 'var(--text-dim)', opacity: rows.length === 1 ? 0.4 : 1 }}
                >
                  <Trash2 size={15} />
                </button>
                <button
                  className="icon-button"
                  onClick={() => addRowAfter(row.id)}
                  title="Add a row below"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>

            {row.feedback && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', color: row.feedback.ok ? 'var(--success)' : 'var(--error)' }}>
                {row.feedback.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {row.feedback.msg}
              </div>
            )}
          </div>
        );
      })}

      {jobActive && job && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.72rem', color: 'var(--accent-primary)' }}>
          <Timer size={13} />
          <span>{describeJob(job)}</span>
          <button onClick={() => void cancelJob()} style={secondaryBtn(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );

  async function startScheduled(row: Row, payload: unknown, delaySeconds: number, intervalSeconds: number) {
    if (jobActive) {
      updateRow(row.id, { feedback: { ok: false, msg: 'A scheduled send is already active — cancel it first' } });
      return;
    }
    if (intervalSeconds > 0 && intervalSeconds < 1) {
      updateRow(row.id, { feedback: { ok: false, msg: 'Interval must be at least 1 second' } });
      return;
    }
    const status = await startScheduledSend(row.address.trim(), payload, row.dpt.trim() || undefined, {
      delaySeconds: delaySeconds > 0 ? delaySeconds : undefined,
      intervalSeconds: intervalSeconds > 0 ? intervalSeconds : undefined,
    });
    watchingRef.current = true;
    setJob(status);
    startPolling();
  }

  async function refreshJob() {
    let status: ScheduledSendStatus;
    try {
      status = await getScheduledSendStatus();
    } catch {
      return; // transient fetch error — keep polling
    }
    if (status.state === 'waiting' || status.state === 'running') {
      watchingRef.current = true;
      setJob(status);
      if (pollRef.current == null) startPolling();
      return;
    }
    stopPolling();
    setJob(null);
  }

  async function cancelJob() {
    try {
      await cancelScheduledSend();
    } catch {
      // ignore — refreshJob reflects the real state
    }
    await refreshJob();
  }

  function startPolling() {
    stopPolling();
    pollRef.current = window.setInterval(() => void refreshJob(), POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }
}

/**
 * The row's group address as last seen on the bus (#439): value, what kind of
 * telegram carried it, and when. Flashes briefly whenever it changes, so the
 * answer to a read is hard to miss.
 */
function LastValue({ telegram, awaiting }: { telegram: Telegram | undefined; awaiting: boolean }) {
  const hasValue = telegram != null && telegram.simplified_type !== 'Read';
  const at = telegram ? new Date(telegram.timestamp) : null;
  const sameDay = at != null && at.toDateString() === new Date().toDateString();
  const when = at == null
    ? ''
    : at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      + (sameDay ? '' : ` · ${at.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })}`);
  return (
    <span
      // Remounting on a new telegram restarts the highlight animation.
      key={telegram?.timestamp ?? 'none'}
      className={hasValue ? 'wtb-last-value wtb-last-value-flash' : 'wtb-last-value'}
      title={telegram
        ? `Last telegram on this group address: ${telegram.simplified_type ?? telegram.telegram_type} from ${telegram.source_address}${telegram.source_name ? ` (${telegram.source_name})` : ''}, ${at!.toLocaleString()}`
        : 'No telegram recorded for this group address yet'}
    >
      <span style={{ color: 'var(--text-dim)' }}>Last:</span>
      {hasValue ? (
        <>
          <strong style={{ color: 'var(--text-main)', fontFamily: "'JetBrains Mono', monospace" }}>
            {telegram.value_formatted ?? telegram.value_numeric ?? telegram.raw_hex ?? '—'}
            {telegram.unit ? ` ${telegram.unit}` : ''}
          </strong>
          <span style={{ color: 'var(--text-dim)' }}>
            {telegram.simplified_type ?? telegram.telegram_type} · {when}
          </span>
        </>
      ) : (
        <span style={{ color: 'var(--text-dim)' }}>
          {telegram ? `no value yet (read request ${when})` : 'no value yet'}
        </span>
      )}
      {awaiting && <span style={{ color: 'var(--warning-text)' }}>· waiting for response…</span>}
      <style>{`
        .wtb-last-value {
          display: inline-flex; align-items: baseline; gap: 0.35rem;
          font-size: 0.72rem; padding: 0.1rem 0.4rem; border-radius: 4px; white-space: nowrap;
        }
        .wtb-last-value-flash { animation: wtb-last-value-flash 1.6s ease-out; }
        @keyframes wtb-last-value-flash {
          from { background: rgba(99, 102, 241, 0.35); }
          to { background: transparent; }
        }
      `}</style>
    </span>
  );
}

interface DptChoice {
  key: string;
  name: string;
}

/**
 * DPT entry for one row. Editable only once that row has a group address.
 * The suggestion list is portaled and pinned under this input, because the
 * panel sits in an overflow-hidden column; each row shows the DPT number
 * with its designation beside it.
 */
function DptField({ value, options, disabled, overridden, title, onChange }: {
  value: string;
  options: DptChoice[];
  disabled: boolean;
  overridden: boolean;
  title: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const exact = options.some(o => o.key.toLowerCase() === q);
    if (!q || exact) return options;
    return options.filter(o => o.key.toLowerCase().includes(q) || o.name.toLowerCase().includes(q));
  }, [value, options]);

  const active = matches.length === 0 ? 0 : Math.min(highlight, matches.length - 1);

  const place = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 240);
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
  }, [open, matches.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (inputRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const pick = (choice: DptChoice) => {
    onChange(choice.key);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      setHighlight(h => {
        const current = Math.min(h, Math.max(matches.length - 1, 0));
        return Math.max(0, Math.min(matches.length - 1, current + dir));
      });
      return;
    }
    if (e.key === 'Enter' && open && matches[active]) {
      e.preventDefault();
      pick(matches[active]);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        className="glass-input"
        aria-label="Datapoint type"
        value={value}
        disabled={disabled}
        placeholder="—"
        title={title}
        onChange={e => { onChange(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => { if (!disabled) { setOpen(true); setHighlight(0); } }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        style={{
          width: 78,
          padding: '0.2rem 0.35rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.72rem',
          borderColor: overridden ? 'var(--accent-primary)' : undefined,
          opacity: disabled ? 0.45 : 1,
        }}
      />
      {open && !disabled && matches.length > 0 && box && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label="Datapoint types"
          style={{
            position: 'fixed', top: box.top, left: box.left, width: box.width, zIndex: 80,
            maxHeight: 240, overflowY: 'auto',
            background: 'var(--bg-panel)', border: '1px solid var(--border-color)',
            borderRadius: 8, boxShadow: 'var(--shadow-lg)', padding: '0.25rem',
          }}
        >
          {matches.map((o, i) => (
            <button
              type="button"
              key={o.key}
              role="option"
              aria-selected={i === active}
              onMouseDown={e => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                display: 'flex', alignItems: 'baseline', gap: '0.55rem',
                width: '100%', textAlign: 'left', border: 'none', borderRadius: 6, cursor: 'pointer',
                padding: '0.3rem 0.45rem',
                background: i === active ? 'rgba(99,102,241,0.18)' : 'transparent',
              }}
            >
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: 'var(--text-main)' }}>{o.key}</span>
              {o.name && <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>{o.name}</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

function describeJob(job: ScheduledSendStatus): string {
  if (job.state === 'waiting') {
    const at = job.next_send_at ? ` at ${new Date(job.next_send_at).toLocaleTimeString()}` : '';
    return `Delayed send to ${job.address} — first send${at}`;
  }
  if (job.interval_seconds) {
    const skipped = job.sends_skipped ? ` (${job.sends_skipped} skipped)` : '';
    return `Cyclic send to ${job.address} every ${job.interval_seconds}s — ${job.sends_done ?? 0} sent${skipped}`;
  }
  return `Sending to ${job.address}…`;
}
