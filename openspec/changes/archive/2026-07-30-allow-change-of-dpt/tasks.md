## 1. DPT parse helper

- [x] 1.1 Add `parseDptMain(dpt: string): number | undefined` (inverse of `formatDpt`) in `frontend/src/utils/knxSend.ts` — `"5.010" -> 5`, `"1" -> 1`, `"" -> undefined`.
- [x] 1.2 Unit-test `parseDptMain` (valid `main.sub`, bare main, empty, malformed).

## 2. Editable DPT in the Send panel

- [x] 2.1 In `WriteToBusPanel.tsx`, replace the read-only `DPT {row.dpt || '—'}` span with a text input bound to `row.dpt` via `updateRow(id, { dpt, feedback: null })`.
- [x] 2.2 Add a `<datalist>` of known DPTs (from `filterOptions.dpts` plus common ones) to guide entry; keep input free-text (no hard gate).
- [x] 2.3 On a DPT edit that changes the DPT *main*, clear `row.value` so a stale value can't be sent to the switched widget.
- [x] 2.4 Pass `filterOptions`/`targets` DPT context into the panel as needed for the datalist.

## 3. Drive the widget from the effective DPT

- [x] 3.1 Change the `WriteControls` props from `dptMain={known?.main}` to `dptMain={parseDptMain(row.dpt)}`, keeping `dptKey={row.dpt || null}`. No change to `WriteControls` itself.
- [x] 3.2 Verify On/Off (DPT 1), time/date pickers (10/11/19), and free-value (others) all follow an overridden `row.dpt`.

## 4. Reset to project DPT

- [x] 4.1 Compute the row's project DPT string from `known?.main/sub` via `formatDpt`; treat the row as "overridden" when `row.dpt !== projectDpt` and a project default exists.
- [x] 4.2 Show a "reset to project DPT" affordance only when overridden; clicking it sets `row.dpt` back to the project string.

## 5. Verify

- [x] 5.1 Extend/add `WriteToBusPanel` tests: prefill from project; override changes effective DPT + widget; send posts the overridden DPT; unknown DPT surfaces the backend error inline; reset restores the project DPT.
- [x] 5.2 Run frontend lint + unit tests; fix fallout.
- [x] 5.3 Manual pass against the #342 case: GA with project DPT `5.001`, override to `5.010`, send `128`, confirm it is accepted.
