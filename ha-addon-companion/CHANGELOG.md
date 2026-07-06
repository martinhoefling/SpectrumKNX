# Changelog

## 1.9.0

### Added

- Initial release of the **Spectrum KNX (HA Companion)** add-on: runs the Spectrum KNX analyzer UI directly on Home Assistant's own KNX telegram database (read-only) — no second bus connection and no separate database. Live telegrams are streamed from Home Assistant's websocket API (`knx/subscribe_telegrams`), with gap replay from the shared store after reconnects.
