## Context

See `proposal.md` — Why. Current `TelegramTable.tsx` facts that shape the design:

- Rows render from `telegramRows` (the quick-filtered, delta-annotated list) via
  a virtualizer; each row div has `data-akey={anchorKey(t)}` and
  `onClick={handleRowClick}`.
- `anchorKey(t) = ${timestamp}-${source}-${target}-${raw_hex}` is the stable
  per-telegram identity already used for scroll anchoring (#202).
- `handleRowClick()` today takes no event and only pauses live-following when at
  the live edge (#266).
- Row background is currently the zebra stripe
  (`(index + stripeOffset) % 2 === 0 ? var(--bg-subtle) : transparent`).
- The component already lifts related state via optional props with internal
  fallbacks (`listFollow`/`onListFollowChange`, `listAnchorKey`/…). Marks follow
  the same pattern.

## Goals / Non-Goals

**Goals:**
- Mark rows by stable telegram identity (`anchorKey`), with the click/shift/ctrl
  semantics from the spec, and a visibly stronger treatment for the latest click.
- Survive main-panel navigation by lifting mark state to `App`, exactly like
  `listFollow`/`listAnchorKey`.

**Non-Goals:**
- Persisting marks across reload as a hard requirement (best-effort only; keyed
  by `anchorKey`, so evicted telegrams simply lose their mark).
- Any action on marked rows (bulk filter/visualize/export). Marks are purely a
  visual find-aid here.
- The "preserve live-scroll/pause across navigation" half of #310 — owned by
  `qol-state-persistence` (#203).

## Decisions

### Decision 1: Mark state = a Set of keys + a lastClicked key, lifted to App

Model marks as `markedKeys: Set<string>` (or a serializable `string[]`) plus
`lastMarkedKey: string | null`, both keyed by `anchorKey(t)`. Lift them to `App`
as `value`/`onChange` props with internal fallbacks, mirroring the existing
`listFollow`/`listAnchorKey` lift, so they survive the panel unmount on
navigation. Reuse `anchorKey` — no new identity scheme.

- **Alternative considered:** store marks by row index. Rejected — indices shift
  as live telegrams arrive; identity keys are the only thing stable across the
  list churn the issue describes.

### Decision 2: Range semantics over the current visible order at click time

Shift/Ctrl+Shift ranges are computed against the current `telegramRows` order at
the moment of the click: find the index of `lastMarkedKey` and of the clicked
row, and mark every row between them inclusive by their `anchorKey`. If
`lastMarkedKey` is absent (no prior click, or it has scrolled out of the list),
a Shift+Click marks only the clicked row.

- Marks are stored as keys, but the *range* is a one-time expansion at click
  time — later list changes don't retro-actively grow or shrink a range.

### Decision 3: Modifier-aware click handler; keep the pause behavior intact

Change `handleRowClick` to accept the `React.MouseEvent` and the clicked row's
key/index. It first applies the mark mutation based on `e.shiftKey` and
`e.ctrlKey || e.metaKey`, then performs the existing pause-on-edge logic
unchanged. Add a `data-index` read (already present) so the handler can resolve
the clicked row's position for range math. Guard text-selection: a modifier
click should not also start a browser text selection (call `preventDefault` on
shift-click as needed).

- Range marking is independent of the timestamp-sort guard that gates
  pausing/anchoring; marks work in any sort, while the pause logic keeps its
  existing `isTimeSort` guard.

### Decision 4: Styling — background over frame, two tiers via theme tokens

Marked rows get a tinted background (an accent-tinted token, e.g. a translucent
`--accent-primary` wash) that overrides the zebra stripe; the `lastMarkedKey`
row gets a stronger wash / brighter left-border accent so it reads as "the one I
clicked last." Backgrounds win over stripes because the issue explicitly prefers
a background color to a frame, and it survives the virtualizer's absolute
positioning cleanly.

### Decision 5: Clear-marks affordance near the list

Expose a "clear marks" control (e.g. a small button/pill shown only when any row
is marked, alongside the existing jump-to-live pill area). Clicking it sets
`markedKeys` empty and `lastMarkedKey` null via the lifted setter.

## Risks / Trade-offs

- **Marks reference evicted telegrams** → keys not found in `telegramRows` render
  nothing; the mark is effectively dropped for that row while others persist
  (spec-required). No error, no orphan styling.
- **Shift/Ctrl click triggering native text selection** → mitigate by
  `preventDefault` on modified clicks so marking doesn't fight the browser.
- **Large mark sets over a big buffer** → membership is a `Set` lookup per
  rendered (virtualized) row, so cost scales with visible rows, not buffer size.
- **Reload persistence expectations** → out of scope as a guarantee; if the
  `qol-state-persistence` UI-state store lands, marks can piggyback on it later
  without changing this spec.
