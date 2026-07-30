## Why

The DPT a GA carries in the ETS project is sometimes wrong. When it is, the Send
panel prefills that wrong DPT, shows it read-only, and every send uses it — so a
GA whose project DPT is `5.001` (0–100 %) rejects a value like `128`, and there
is no way to send it. Today the only workaround is to fix the DPT in ETS, export
the `.knxproj`, and re-import it into SpectrumKNX just for a quick test (#342).

The wire path already supports this: `/api/knx/send` transcodes with exactly the
DPT string the frontend sends and never re-consults the project. The project DPT
is only used frontend-side to prefill the field. So the fix is purely a frontend
one — make that prefilled DPT editable.

## What Changes

- In the main Send panel ("Write to bus"), the per-row **DPT becomes editable**.
  The GA's project DPT remains the default; the user can override it for that row.
- The write **input widget follows the effective (possibly overridden) DPT**, not
  the project DPT: overriding to DPT 1 shows On/Off, DPT 10/11/19 show the
  time/date pickers, others show the free-value input — matching how the panel
  already adapts to a GA's DPT.
- The send (immediate and scheduled) uses the **effective DPT**. An unknown/empty
  DPT surfaces the backend's existing validation error inline, as today.
- The override is per-row and persists with the existing row persistence; a way
  to **reset a row back to its project DPT** is provided.

## Capabilities

### New Capabilities
- `bus-write`: How the Send ("Write to bus") panel resolves the DPT used to
  transcode a value — project default, user override, effect on the input widget,
  and reset — plus the send behavior that already exists around it.

### Modified Capabilities
<!-- None: openspec/specs/ is empty; this is the first captured capability. -->

## Impact

- **Frontend only. No backend, API, or dependency change** — `/api/knx/send` and
  `/api/knx/send/scheduled` already accept and honor an arbitrary `dpt` string.
- `frontend/src/components/WriteToBusPanel.tsx` — replace the read-only DPT label
  with an editable DPT control; derive the widget DPT from the row's DPT; add
  reset-to-project.
- `frontend/src/components/WriteControls.tsx` — no behavior change; it already
  selects the widget from `dptMain`. It will simply receive the effective DPT.
- Small DPT-string→main parse helper (inverse of `formatDpt`) in
  `frontend/src/utils/knxSend.ts` (or `utils/dpt.ts`).
- Out of scope: the other send surfaces (`SendToGaPopover`, Last Seen Values
  write controls). This change targets the main Send panel only, per #342.
