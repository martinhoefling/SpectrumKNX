## Context

See `proposal.md` — Why. Current wiring in `WriteToBusPanel.tsx`:

- Each `Row` already has a `dpt: string` field, persisted to localStorage and
  passed to `sendTelegram(address, payload, row.dpt.trim() || undefined)` /
  `startScheduledSend(...)`. **The send already uses `row.dpt`.**
- `onAddressChange` prefills `row.dpt` from the project via
  `formatDpt(match.main, match.sub)`.
- The DPT is rendered read-only: `<span>DPT {row.dpt || '—'}</span>`.
- `WriteControls` picks its widget from `dptMain`, but the panel passes
  `dptMain={known?.main}` (the **project** main) and `dptKey={row.dpt || null}`.

Backend (`_encode_payload` in `knx_daemon.py`) transcodes with `parse_transcoder(dpt)`
using the caller's DPT verbatim and never consults the project. No backend change
is needed.

## Goals / Non-Goals

**Goals:**
- Make `row.dpt` user-editable and make the whole row (widget + send) driven by
  it, with the project DPT as the default and a reset affordance.
- Keep `WriteControls` untouched — feed it the effective DPT.

**Non-Goals:**
- Changing the DPT anywhere it is stored (project file, DB). The override is a
  transient, per-row send-time choice only.
- Other send surfaces (`SendToGaPopover`, Last Seen Values). Main panel only.
- A DPT registry/validation UI. Validation stays where it is: the backend rejects
  unknown DPTs and the panel shows the error inline.

## Decisions

### Decision 1: Derive the widget DPT from `row.dpt`, not the project main

Replace `dptMain={known?.main}` with `dptMain={parseDptMain(row.dpt)}` and keep
`dptKey={row.dpt || null}`. Add a small inverse-of-`formatDpt` helper:
`parseDptMain("5.010") -> 5`, `parseDptMain("") -> undefined`. This makes the
On/Off / time / date / free-value widget follow the override automatically, with
zero change to `WriteControls`.

- **Alternative considered:** thread a separate `effectiveDpt` prop. Rejected —
  `row.dpt` already *is* the effective DPT once it's editable; a second source of
  truth invites drift.

### Decision 2: DPT editor is a free-text input with suggestions

Replace the read-only DPT span with a small text input bound to `row.dpt`
(`updateRow(id, { dpt, feedback: null })`), backed by a `<datalist>` of known
DPTs assembled from `filterOptions.dpts` (and the common ones) for
autocomplete-style hints.

- **Why free text, not a fixed dropdown:** the valid DPT set is large and the
  backend is the authority; a text input lets power users type any `main.sub`
  while the datalist still guides the common cases. Typos fail loudly on send
  (Decision 3), which is acceptable for a quick-test feature.
- **Format hint only:** light client-side shape check (`^\d{1,3}(\.\d{1,3})?$`)
  may style an obviously malformed entry, but MUST NOT block sending — the
  backend remains the transcoding authority.

### Decision 3: No client-side DPT validation gate

When `row.dpt` is unknown/empty, do not pre-empt the send. Let the request go and
render the backend's existing `400` detail in the row's `feedback` (the current
error path already does this). This keeps one source of truth for what's
transcodable and matches today's behavior for a mistyped value.

### Decision 4: Reset via an affordance shown only when overridden

Track the project default per row (already available as `known?.main/sub` →
`formatDpt`). Show a small "reset to project DPT" control (e.g. a ↺ icon next to
the DPT input) only when `row.dpt` differs from the project default and a project
default exists. Reset sets `row.dpt` back to the project string.

- "Overridden" is derived (`row.dpt !== projectDpt`), not a stored flag — no new
  persisted state, and it survives reload correctly because both sides are
  recomputed from `row.dpt` + `targets`.

### Decision 5: Value handling when the widget type changes

Changing the DPT can switch the widget (e.g. free-value → On/Off, or → time
picker), leaving a now-meaningless `value`. On a DPT edit, clear `row.value` when
the DPT *main* changes, so a stale string can't be sent to the new widget. Same
row, same feedback-clear pattern already used elsewhere.

## Risks / Trade-offs

- **User enters a DPT that transcodes but is semantically wrong** → out of scope
  to catch; this is a power-user quick-test tool, and the bus/device behavior is
  the user's responsibility. The project default and reset make the safe path the
  default.
- **Datalist DPT list is incomplete** → it is a hint, not a constraint; free text
  still accepts anything, so completeness is non-critical.
- **Persisted override surprises a later user** → overrides already persist like
  every other row input (#254); the visible reset affordance and the always-shown
  project name make an override discoverable.
