## Why

Clicking a telegram row pauses live-following so the row you are reading stays
put (#266). But after visiting another main panel and returning, that row is
lost in the mixed-in pause buffer and live feed — there is no visible trace of
what you were looking at (#310). Letting the user mark rows gives a durable,
findable anchor for the telegrams they care about.

## What Changes

- Telegram List rows can be **marked** with a distinct background color.
- Click behavior on a row:
  - **Click** — clear all marks and mark only the clicked row.
  - **Shift+Click** — mark the range from the last-clicked row to the clicked row.
  - **Ctrl/Cmd+Click** — toggle the clicked row's mark, keeping existing marks.
  - **Ctrl/Cmd+Shift+Click** — add the range to the existing marks.
- The **most-recently-clicked** row gets a more prominent mark (brighter/stronger
  background) than the other marked rows.
- Marks **survive main-panel navigation** so a returning user can still find the
  rows they marked. A way to **clear all marks** is provided.
- Marking is layered onto the existing row click, which continues to pause
  live-following (#266); the two behaviors coexist.

Out of scope / related: "live scrolling / pause-buffer state should persist
across panel navigation" (also mentioned in #310) is the Telegram-List
autoscroll/anchor persistence already owned by change `qol-state-persistence`
(#203). This change relies on that for the scroll position; here we add the
persistent *marks*.

## Capabilities

### New Capabilities
- `telegram-list`: Marking/highlighting of Telegram List rows — the click,
  shift-click, and ctrl/cmd-click semantics, the prominence of the
  most-recently-clicked row, persistence of marks across main-panel navigation,
  and clearing marks.

### Modified Capabilities
<!-- None: openspec/specs/ is empty; this is the first captured capability. -->

## Impact

- **Frontend only.** No backend, API, or dependency change.
- `frontend/src/components/TelegramTable.tsx` — mark state driven by props,
  modifier-aware click handling, marked-row and latest-row styling, "clear
  marks" affordance.
- `frontend/src/App.tsx` — lift mark state (marked keys + latest key) above the
  conditionally-rendered panels so it survives navigation, mirroring the existing
  `listFollow`/`listAnchorKey` lift.
- Row identity reuses the existing `anchorKey(t)` used for anchor tracking.
