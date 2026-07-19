# Changelog

## 1.15.1

### Fixed

- Bump knx-telegram-store to 0.10.2: the legacy-data probe run at startup no longer scans the whole telegrams table once recovery is recorded — store initialization time no longer grows with database size.

## 1.15.0

### Added

- **Telegram caching in the Group Monitor**: telegrams now persist in the browser (IndexedDB). After a reload or Home Assistant dashboard switch the buffer reappears instantly and only the missing time ranges are fetched from the backend — the workspace comes back "up to now" without any manual reload (#211, #246).
- **Workspace persistence**: the active tab, filters, open panel and visualization targets survive a reload or dashboard switch — stored in the browser in the Home Assistant iframe, reflected into a shareable `view=monitor` URL in a regular tab (#211).
- **Asynchronous history loads**: the Load History dialog closes immediately and the read runs in the background — a spinner chip next to the WS status shows progress while cached ranges appear instantly (#222).
- **Send & last-seen shortcuts on active filter rows**: the quick send-to-GA popover and the last-seen shortcut are now also available directly on the Active Filters entries — where the values being filtered on are changed most often (#214).
- **Last-value timestamp in the send popover**: the quick-send popover shows when the last value was received, making it easy to judge whether it is current or stale (#255).

### Changed

- **Pause is now loss-free**: pausing freezes the view while telegrams keep being recorded in the background — resuming reveals everything, with no 10k pause-buffer cap dropping telegrams anymore.
- **UI preferences moved from cookies to localStorage** (theme, columns, sort, chart toggles, load limit); existing settings migrate automatically (#246).
- **Clear also wipes the local telegram cache**, so cleared telegrams do not resurface after a reload.
- Toolbar cleanup: Database Maintenance moved into the main navigation dropdown, and the filter panel visibility now syncs with the active view (#241).
- Send rows use the full panel width and display the resolved group-address name (#252).

### Fixed

- **Write-to-bus panel keeps its rows** (GA, DPT, value, delay, interval) when the panel is toggled off and on — and across reloads (#254).
- Bus writes sent from the app appear in the live view again; write UI and Read action controls cleaned up (#251).
- The pan & zoom timeline updates when a chart range is selected (#250).

## 1.14.0

### Added

- **Write to bus panel**: the single send bar is now a multi-row panel — send to several group addresses at once, each row with its own GA, DPT, value, Write/Read and optional delay/cyclic scheduling, plus add/remove row controls (#215).
- **Quick "send to this GA" popover**: a send icon on group addresses across the app (group monitor rows, Last Seen Values, building tree, filter panel) opens a compact popover showing the last value with a DPT-aware write and a read — no need to open the full panel (#214).
- **Last Seen Values is now a top-level panel** reachable from the toolbar like Visualization, Traffic Statistics and Building Structure, and updates live as telegrams arrive (#212).
- **DPT-aware value entry**: calendar/time pickers for date & time DPTs (10, 11, 19), enumerated dropdowns for switch/step DPTs, and a dropdown of recently sent values (#191).
- **Telegram dots on graphs**: an optional dot at each telegram timestamp makes cyclic same-value repeats (e.g. a DPT 1.011 "alive" bit) visible; toggle in the visualization header (#195).
- **Time-axis pan & zoom**: a scrollbar/brush under the graphs — drag to pan through time, drag the edges to zoom, double-click to reset (#193).
- **Functions in the building structure**: ETS functions are shown with their group addresses, so all GAs of a function can be selected at once (#216).
- **Collapsible per-channel GA tree** in the device status view, with recent values shown inline (KNX-Lens style) (#220).
- **On/Off send buttons** for switch DPTs are now styled as clear accent action buttons, consistent with the Write button (#218).

### Changed

- Graphs extend each series' last state/value to the newest telegram, so a state still held (e.g. a presence sensor left on) is drawn out to the right edge instead of a barely-visible sliver (#208).

### Fixed

- **Single-telegram graphs**: a group address with exactly one received telegram no longer collapses the time axis to 00:00 — the axis now shows real times centered on the telegram (#239).

## 1.13.4

### Fixed

- **Consistent write controls in "Last Seen Values"**: the write row now uses the same DPT-aware controls as the send bar — On/Off buttons for switch (DPT-1) group addresses — instead of a single free-text field that rejected values like `21` with a conversion error (#213).
- **Exact group-address match ranked first**: typing a full group address (e.g. `2/4/1`) into a group-address dropdown now puts the exact match at the top and preselects it, instead of leaving a longer infix match (e.g. `12/4/1`) selected (#217).
- **Reliable graph legend toggles**: clicking a series in a graph legend no longer occasionally needs a second click to take effect, and a series hidden via the legend becomes visible again when its target is deselected and reselected (#205).

## 1.13.3

### Fixed

- **Chart hover survives live telegrams**: the synced crosshair and value legend across stacked graphs are no longer reset every time a telegram arrives — charts now update in place instead of being recreated, which also preserves zoom and legend visibility toggles (#207).
- **No duplicate graph per group address after import**: telegrams received before a project import (undecoded, no DPT) no longer produce a separate "unknown metric" graph next to the decoded one for the same GA; the address collapses to a single, correctly-scaled series (#206).

## 1.13.2

### Added

- **Direction filter**: filter the Group Monitor by telegram direction (Incoming / Outgoing), as a dimension independent of the Type filter — useful for isolating self-sent telegrams in an analysis session (#194).
- **ETS-style scroll anchoring**: the live telegram list now auto-scrolls only while parked at the live edge. Scroll away and your position is held while telegrams keep arriving; a "N new telegrams" pill jumps back to live (#202).

### Changed

- **Higher default buffer size**: the default number of telegrams kept in the live view and loaded from history was raised from 25,000 to 100,000 (#196).

### Fixed

- **Pause no longer drops telegrams**: pausing the Group Monitor and resuming discarded every telegram received during the pause; they are now buffered and backfilled on resume (#196).
- **Chart legend visibility persists**: hiding a series by clicking it in the legend is no longer undone when a new telegram for that series arrives (#192).
- **Stable chart colors**: line colors are no longer reassigned when toggling target visibility (#197).
- **Send bar recent addresses**: On/Off (DPT-1) sends are now recorded in the recent-GA dropdown, and the dropdown lists only recent addresses while the box is empty — typing shows the full project list (#190).

## 1.13.1

### Changed

- **Storage library update**: upgraded to `knx-telegram-store` 0.10.1, which fixes a startup crash on TimescaleDB-backed standalone installations (companion mode itself is unaffected — it reads Home Assistant's SQLite store).

## 1.13.0

### Added

- **Exact sub-DPT filtering**: the DPT filter now selects individual subtypes (e.g. only 1.001 Switch) instead of always matching the whole major DPT — with per-subtype counts in the live view (#180).

### Changed

- **Storage library update**: upgraded to `knx-telegram-store` 0.10.0, which adds sub-DPT query support (#180).

### Fixed

- **Boolean values shown inverted**: DPT-1 values decoded by Home Assistant as enum names ("off", "down", …) were rendered as "on" regardless of state — both in the live feed and in loaded history. Payload-less GroupValueRead telegrams no longer show fabricated values (#181).
- **Misleading connection status**: the settings page showed "KNX Connection: Disconnected" in companion mode although Home Assistant owns the bus and telegrams were flowing. It now reports the Home Assistant feed status instead (#184).

## 1.12.0

### Added

- **Device status view**: browse the ETS building structure and open any device to see all its communication objects with live values — KNX-Lens-style diagnostics in the browser (#153).
- **Shareable charts**: copy a link to any visualization (filters, targets, time window) to bookmark it — or add `&embed=1` and drop it into a Home Assistant dashboard as a self-updating chart (#150).

### Changed

- **Storage library update**: upgraded to `knx-telegram-store` 0.9.0 (#179).

## 1.11.1

### Fixed

- **Debian package dependencies**: Include `httpx` in the runtime dependencies to fix the Debian package installation and startup crash (#165).

## 1.11.0

### Added

- **Update available popup & release notes**: Added an in-app "update available" popup that shows when a newer release exists, displaying release notes and a link to the GitHub release. It can also be reopened from the Settings chip. Added a new configuration option `UPDATE_CHECK` (default `true`) to allow opt-out for offline or privacy-focused installations (#149).
- **DPT name in building structure**: The building structure view now displays the descriptive DPT name (e.g. "Scaling") under the DPT number (e.g. "DPT 5.001"), with the full name visible in a tooltip (#160).

### Fixed

- **ETS project upload in HA companion mode**: Fixed the project directory permissions/symlinks in SQLite/companion mode so that ETS projects can be successfully uploaded. Also added an in-app notice when no project is loaded, pointing users to the upload flow in Settings so they can set up filtering (#159).

## 1.10.0

### Added

- **Telegram log import/export**: export the live buffer and re-import logs for offline analysis (#99).
- **Configurable web port**: the UI listen port can now be set via configuration (#147).

### Fixed

- **Header layout**: the "Spectrum KNX" brand no longer overlaps the toolbar metrics on narrow windows (#158).
- **Large imports**: clearer, actionable error when a large zip import fails because temp storage is exhausted (#157).

## 1.9.1

### Fixed

- **Branding**: browser tab title now reads "Spectrum KNX" instead of "frontend", and the favicon and in-app logo match the add-on's waveform icon (#139).

## 1.9.0

### Added

- Initial release of the **Spectrum KNX (HA Companion)** add-on: runs the Spectrum KNX analyzer UI directly on Home Assistant's own KNX telegram database (read-only) — no second bus connection and no separate database. Live telegrams are streamed from Home Assistant's websocket API (`knx/subscribe_telegrams`), with gap replay from the shared store after reconnects.
