# Changelog

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
