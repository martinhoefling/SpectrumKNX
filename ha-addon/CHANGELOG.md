# Changelog

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
