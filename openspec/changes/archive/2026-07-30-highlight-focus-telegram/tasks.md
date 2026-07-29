## 1. Lift mark state

- [x] 1.1 Add `markedKeys` (serializable `string[]`/`Set<string>`) and `lastMarkedKey` (`string | null`) to `App.tsx`, above the conditionally-rendered panels, mirroring the existing `listFollow`/`listAnchorKey` lift.
- [x] 1.2 Pass them into `TelegramTable` as `value`/`onChange` props; add matching optional props + internal-fallback state in `TelegramTable`, following the `quickFilter*`/`listFollow` pattern already in the component.

## 2. Modifier-aware click + mark semantics

- [x] 2.1 Change `handleRowClick` to receive the `React.MouseEvent`, the clicked row's `anchorKey`, and its index in `telegramRows`.
- [x] 2.2 Implement mark mutation: plain click = replace set with clicked; Ctrl/Cmd = toggle clicked; Shift = range from `lastMarkedKey`→clicked (inclusive, current visible order); Ctrl/Cmd+Shift = add that range. Update `lastMarkedKey` to the clicked row in all cases.
- [x] 2.3 Compute ranges against the current `telegramRows` order; when `lastMarkedKey` is absent, Shift/Ctrl+Shift marks only the clicked row.
- [x] 2.4 Preserve the existing pause-on-edge behavior (#266) after applying marks; `preventDefault` on modified clicks so native text selection doesn't fire.

## 3. Styling

- [x] 3.1 Render a marked row with a distinct tinted background that overrides the zebra stripe.
- [x] 3.2 Render the `lastMarkedKey` row with a stronger/brighter treatment (e.g. deeper wash + accent left-border) so it is the most prominent.
- [x] 3.3 Verify legibility in both light and dark themes using existing theme tokens.

## 4. Clear marks

- [x] 4.1 Add a "clear marks" affordance shown only when at least one row is marked; it empties `markedKeys` and nulls `lastMarkedKey`.

## 5. Persistence across navigation

- [x] 5.1 Confirm marks survive navigating to another panel and back (state lives in `App`); a telegram no longer in the list loses its mark without dropping marks on the remaining rows.

## 6. Verify

- [x] 6.1 Add `TelegramTable` tests: plain click replaces; Ctrl/Cmd toggles/adds; Shift range; Ctrl/Cmd+Shift adds range; latest-clicked prominence; clear-marks; click still pauses following.
- [x] 6.2 Run frontend lint + unit tests; fix fallout.
- [x] 6.3 Manual pass: mark rows, navigate away and back, confirm marks and the latest-clicked prominence persist and the marked rows are findable in the mixed live/pause list. (Verified via Playwright drive against the Vite dev server: plain/shift/ctrl click semantics, marks survive a Visualizer round-trip, latest prominence + accent bar, clear-marks pill — 8/8 checks; screenshots in /tmp/spectrum-verify/.)
