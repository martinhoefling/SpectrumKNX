# Changelog

## 2.0.0-beta.4

### Changed

- **MCP Context Optimization**: Removed high-cardinality project resources (`group-addresses`, `devices`, `topology`, `locations`, `functions`) to prevent LLM context bloat. Kept lightweight `knx://project` overview index and updated canned prompts to instruct agents to use paginated discovery tools.

## 2.0.0-beta.3

### Fixed

- **MCP Transport Security**: Configured FastMCP transport security settings to allow network clients and custom Host headers without 421 Misdirected Request errors.

## 2.0.0-beta.2

### Added

- **MCP Server Integration**: Introduces Model Context Protocol (MCP) server endpoints at `/mcp`. Allows external AI assistants to read and write to the KNX bus, explore ETS projects, filter telegrams, list group addresses, and query active data.
- **Frontend Revamp App-Shell**: Implements a new five-panel layout switch for the frontend, providing a streamlined and modern navigation experience.
- **Simplified Filter Pane**: Adds an edit/active toggle view to simplify filter configuration.
- **DPT Override in Write-to-Bus**: Allows users to manually override Datapoint Types (DPT) directly in the Write-to-Bus panel.
- **Session State Persistence**: Automatically persists the active session UI state across navigation and browser updates.
- **Focused Telegram Highlighting**: Highlights/marks the focused rows in the telegram list for improved readability.
- **Numerical Sorting**: Sorts group and physical addresses numerically in the Last Seen Values panel.
- **Visualization Panel Header Controls**: Added a header close X control to the Visualization panel, and repurposed the Targets list X to clear targets.

### Changed

- **Visualization Chart Alignment**: Aligns chart borders, moves the timeline legend to the left, and prevents scale clipping when zooming or panning.
- **Visualization Persistence**: Keeps charts on-screen automatically as the history/live buffer grows.
- **Docker Build Optimization**: Bundles git within the backend Docker image to ensure `docker compose --build` runs successfully.
- **xknx Update**: Upgraded xknx to 3.17.0.

### Fixed

- **History Load Cancellation**: Cancels any in-flight background history loading tasks when the buffer is cleared.
- **History Buffer Gaps**: Fixed a bug where permanent time gaps could form in the async history buffer.
- **History Search Timezone Offset**: Fixed timezone offset errors when specifying custom date ranges in history search.

## 1.16.2

### Added

- **Plot group addresses without a project datatype**: the visualization now offers a datatype picker for a selected group address that has no DPT in the ETS project, decoding its raw payload (8/16/32-bit integers, the KNX 2-byte float, IEEE 4-byte float, percent scalings) so it can be graphed (#315).
- **"Load cached telegrams on startup" setting**: the group monitor restores its browser cache on load by default; turning the new setting off starts the view empty, showing only live telegrams and manual history loads (#246).

### Changed

- **History loading stops when the buffer is full**: paging older history no longer churns through chunks that are immediately evicted, and "Load history" is disabled while the buffer is full (#313).
- **Readable visualization time ruler when zoomed out**: wider tick spacing on multi-day ranges, plus an always-visible start/end time under each chart (#314).

### Fixed

- **Stable visualization chart order**: the per-metric charts no longer change vertical order as live telegrams or history chunks arrive (#312).
- **Fewer group-monitor gaps**: a time range is only marked loaded once its telegrams are actually cached, so a failed cache write no longer leaves a permanent gap in the timeline (#317).

## 1.16.1

### Added

- **Progressive history loading**: history now loads in newest-first chunks and paints after each chunk, and startup restores only the most recent telegrams (older history is fetched on demand). The telegram list and charts build quickly even on low-power hosts like a Raspberry Pi, instead of waiting for the whole history read to finish (#284).

### Changed

- **Buffer controls moved into the status bar**: the clear and load-history actions now sit next to the buffer count, with an inline marker when the buffer is full (#284).
- **Building structure — readable function group-address table**: a function's associated group addresses now show their real ETS name and DPT instead of an internal role UUID, reordered to GA · Name · DPT · Time · Value with absolute timestamps and a per-row send-to-bus action (#295).

### Fixed

- **Freeze-on-click in the group monitor** now holds with newest-on-bottom sorting even when the buffer is full: selecting a telegram keeps it in place instead of drifting upward as older rows are evicted (#297).
- Telegram-cache retention probe no longer requests a missing endpoint (#294).

## 1.16.0

### Added

- **Quick filter bar in the telegram table**: a per-column regex/literal filter row on top of the main filter, for fast ad-hoc narrowing without opening the filter panel (#271).
- **Group addresses as a sortable last-values table in the building view**: expanding a communication object or a function now shows its group addresses with name, role, last value and age, sortable by any column; the transmitting object's sending GA is highlighted (#268, #269).
- **"Quick goto time" in the telegram list**: a clock button opens a time-entry popover that jumps the list to the telegram nearest that time and pauses live-follow — the jump-to-live pill brings you back (#282).
- **Date-aware visualization labels**: axis ticks, tooltips and the pan/zoom timeline now show a date alongside the time once the visible range spans more than one day, and the drag-to-zoom selection is now visible while dragging (#281).
- **DPT filter grouped by main data type** for easier browsing of large project DPT lists (#273).
- **Double-click a pan/zoom timeline handle** to snap that edge to the earliest / newest data (#267).

### Changed

- **Zebra stripes stay with their telegram**, and clicking a row pauses live-follow so the row you are reading no longer shifts as new telegrams arrive (#266).

### Fixed

- **Visualization no longer resets to the full time range** when a new telegram arrives — the zoom and the pan/zoom timeline now stay in sync (#281).

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

### Fixed

- **Startup crash on TimescaleDB with compressed chunks**: once the compression policy (introduced in 1.12.0) had compressed older chunks, the storage library's recurring startup data backfill exceeded TimescaleDB's tuple decompression limit (or hit the DML block on older TimescaleDB versions) and crashed the app on every boot. Upgraded to `knx-telegram-store` 0.10.1, which guards the backfill, lifts the limit for its own transaction, and never fails startup over it.

## 1.13.0

### Added

- **Exact sub-DPT filtering**: the DPT filter now selects individual subtypes (e.g. only 1.001 Switch) instead of always matching the whole major DPT — with per-subtype counts in the live view (#180).
- **Send bar address helpers**: clicking the empty group-address box lists the last 10 sent GAs, and every telegram row gets a shortcut that opens the send bar with that GA and its DPT prefilled (#187).

### Changed

- **Storage library update**: upgraded to `knx-telegram-store` 0.10.0, which adds sub-DPT query support (#180).

### Fixed

- **Boolean display values**: DPT-1 values decoded by Home Assistant as enum names ("off", "down", …) were rendered as "on" regardless of state, and payload-less GroupValueRead telegrams showed fabricated values ("None"/"off") instead of "-". DPT-1 subtypes now also render their proper names (1.008 → up/down, 1.100 → cool/heat) (#181).

## 1.12.0

### Added

- **Delayed & cyclic send-to-bus**: schedule one-shot delayed sends or cyclic re-sends of group-address telegrams from the Group Monitor, like the ETS group monitor (#167).
- **Device status view**: browse the ETS building structure and open any device to see all its communication objects with live values — KNX-Lens-style diagnostics in the browser (#153).
- **Shareable charts**: copy a link to any visualization (filters, targets, time window) to bookmark it — or add `&embed=1` and drop it into a Home Assistant dashboard as a self-updating chart (#150).

### Changed

- **TimescaleDB is now optional**: upgraded to `knx-telegram-store` 0.9.0. The PostgreSQL backend detects the TimescaleDB extension at startup and uses hypertable partitioning plus native compression when available; without the extension it runs on plain PostgreSQL with identical functionality (#179).

### Fixed

- **KNX connection retry**: the daemon now retries the KNX connection until the bus interface is reachable instead of giving up when the gateway is briefly unavailable at startup (#171).

## 1.11.1

### Fixed

- **Debian package dependencies**: Include `httpx` in the runtime dependencies to fix the Debian package installation and startup crash (#165).

## 1.11.0

### Added

- **Update available popup & release notes**: Added an in-app "update available" popup that shows when a newer release exists, displaying release notes and a link to the GitHub release. It can also be reopened from the Settings chip. Added a new configuration option `UPDATE_CHECK` (default `true`) to allow opt-out for offline or privacy-focused installations (#149).
- **DPT name in building structure**: The building structure view now displays the descriptive DPT name (e.g. "Scaling") under the DPT number (e.g. "DPT 5.001"), with the full name visible in a tooltip (#160).

### Fixed

- **Store outgoing telegrams**: Telegrams sent directly to the bus via the "send to bus" feature are now correctly captured, stored in the database, and broadcasted to the frontend with the correct "Outgoing" direction, instead of leaving the telegram log incomplete (#161).
- **ETS project upload in HA companion mode**: Fixed the project directory permissions/symlinks in SQLite/companion mode so that ETS projects can be successfully uploaded. Also added an in-app notice when no project is loaded, pointing users to the upload flow in Settings so they can set up filtering (#159).

## 1.10.0

### Added

- **Send to bus**: send and read group-address telegrams directly from the Group Monitor when write access is enabled (#146).
- **Telegram log import/export**: export the live buffer and re-import logs for offline analysis (#99).
- **Configurable web port**: the UI listen port can now be set via configuration (#147).

### Fixed

- **Header layout**: the "Spectrum KNX" brand no longer overlaps the toolbar metrics on narrow windows (#158).
- **Large imports**: clearer, actionable error when a large zip import fails because temp storage is exhausted (#157).
- **Database Maintenance**: "Reclaim space" is no longer offered on the PostgreSQL backend — plain `VACUUM` cannot shrink PostgreSQL's files, so the button visibly did nothing. SQLite is unaffected (knx-telegram-store 0.7.1).

## 1.9.1

### Fixed

- **Branding**: browser tab title now reads "Spectrum KNX" instead of "frontend", and the favicon and in-app logo match the add-on's waveform icon (#139).

## 1.9.0

### Added

- **Companion mode support**: the shared image now supports `STORE_MODE=external-readonly` with a live-telegram bridge to Home Assistant's websocket API, powering the new **Spectrum KNX (HA Companion)** add-on.

## 1.8.0

### Added

- **Database Maintenance**: new toolbar screen showing database size, telegram count and covered time range, with purge (dry-run preview, presets or custom cutoff date, delete-all) and space reclamation (VACUUM) (#135).

## 1.7.2

### Fixed

- **Sidebar Panel**: Use valid MDI icon `mdi:chart-timeline-variant` for sidebar panel (#128).
- **Building Structure**: Sort communication objects by number and display object function alongside name (#129).
- **Building Structure**: Sort building structure spaces alphabetically (#130).
- **Add-on Schema**: Fix Supervisor options schema format for connection type and log level choices.

## 1.7.1

### Added

- **Building Structure**: filter buttons to add all group addresses of a whole device or of a single channel to the target filter, in addition to the existing per-KO and source-PA filters (#119).
- **Traffic Statistics**: the Group Addresses and Physical Addresses tabs are now drill-down trees — expand a GA to see which devices (PAs) sent to it, or expand a PA to see the group addresses it wrote to, each with its share of the traffic (#121).
- Home Assistant add-on icon and logo so the add-on is recognisable in the store and supervisor (#123).

### Changed

- **Building Structure**: the expand/collapse state of the tree is now remembered when leaving and returning to the view (#118).
- **Building Structure**: "Show last seen values" on a communication object now covers all of its connected group addresses instead of only the first one, tagging each row with the matching GA (#120).

### Fixed

- Telegram table: widening the Source and Target columns now reveals more of the device/GA name instead of truncating at a fixed width (#117).
