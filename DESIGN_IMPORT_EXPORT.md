# Telegram Import / Export (Offline Analysis) — Design & Implementation Plan

Implements [SpectrumKNX#99](https://github.com/martinhoefling/SpectrumKNX/issues/99): import
historical KNX bus recordings (ETS6 group-monitor exports, Gira IP-Router data-logger dumps)
into the telegram store for offline analysis, plus export of a telegram selection back to the
ETS6 XML format.

## 1. Source Formats (validated against real samples)

Both sources share the **same XML container schema** `http://knx.org/xml/telegrams/01`
(`<CommunicationLog>` with `<Telegram Timestamp=... Service=... FrameFormat="CommonEmi"
RawData=... />`), but differ in the cEMI frame type inside `RawData`:

| | ETS6 export | Gira data logger |
|---|---|---|
| Packaging | single `.xml` file | folder tree `YYYY/MM/DD/YYYY_MM_DD_{LAN,TP1}.xml`, hundreds of files, GBs |
| Service | `L_Data.ind` | `L_Busmon.ind` |
| RawData | full cEMI L_Data frame — `xknx.cemi.CEMIFrame.from_knx()` decodes directly | cEMI busmonitor wrapper around a **raw TP1 frame** (incl. bus ACKs and checksum) — xknx raises `UnsupportedCEMIMessage` |
| Extras | `<RecordStart>`/`<RecordStop>` elements | `<!-- timezone offset -->` comment, `System.txt` syslog (ignored) |

### Busmonitor (TP1) frames — measured facts

* Frame layout after the cEMI additional-info block: `CTRL SRC(2) DST(2) LEN/AT APDU… CHK`.
  Standard L_Data frames are identified by `(ctrl & 0xD3) == 0x90`; single-byte frames
  (`0xCC` ACK / `0x0C` NAK / busy) are link-layer acknowledgements and are skipped.
* Checksum is XOR-complement over the frame; verified `True` on all sampled frames — used to
  drop corrupted telegrams.
* Conversion to a plain cEMI `L_Data.ind` (`29 00 ctrl (len_at & 0xF0) src dst len apdu`) was
  validated: xknx decodes the reconstructed frames with correct addresses and payloads.
* **LAN/TP1 duplication:** for a sampled day, the LAN file was a **100 % multiset-subset** of
  the TP1 file (42 999 of 42 999 telegrams matched on `(src, dst, apdu)`), with a median
  timestamp skew of 6 ms (p95 8 ms, max 23 ms). TP1 additionally carries line-local traffic.

## 2. Where the code lives — library vs. app

`knx-telegram-store` is deliberately **zero-runtime-dependency** and knows nothing about the
KNX protocol. Decoding frames requires `xknx`; name/DPT enrichment requires `xknxproject`;
upload + progress requires FastAPI/WebSocket. All of these already live in SpectrumKNX.

**Split:**

* **`knx-telegram-store`** (fits cleanly, stdlib-only): the XML *container* format —
  a streaming reader and writer for `CommunicationLog` files operating on *raw hex frames*:
  * `formats/ets_xml.py`: `RawTelegramRecord` (timestamp, service, raw bytes),
    `iter_communication_log(source)` (incremental `iterparse`, constant memory),
    `write_communication_log(records, dest, ...)` (streaming writer, ETS6-compatible output).
  * No decoding, no xknx — usable by any consumer (HA companion, CLI tools).
* **SpectrumKNX backend** (everything protocol- and app-specific):
  * `telegram_import.py`: busmon→L_Data adapter, cEMI decode via xknx, enrichment through the
    existing `parsers.parse_telegram_payload` pipeline + project name map, de-duplication,
    batched `store_many`, import job state machine.
  * `api.py`: upload endpoint (xml/zip), job status polling, export download endpoint.
* **SpectrumKNX frontend**: new *Import / Export* view in the top-left `NavDropdown`.

Export cannot live in the library because `StoredTelegram.raw_data` holds only the **APDU
payload bytes**, not the original frame — rebuilding a cEMI frame needs xknx re-encoding.

## 3. Import pipeline (backend)

```
upload (.xml | .zip)
  └─ stream to temp file (spooled; never fully in memory)
      └─ enumerate sources: single xml, or zip entries *.xml (System.txt etc. ignored)
          └─ group entries whose telegram time ranges overlap (peek first Timestamp)
              └─ per group: k-way merge streams by timestamp
                  ├─ L_Data.ind  → CEMIFrame.from_knx(raw)
                  ├─ L_Busmon.ind → TP1 adapter → CEMIFrame.from_knx(reconstructed)
                  │     (skip ACK/NAK, skip checksum failures — counted)
                  ├─ window de-dup (cross-media, in-batch)
                  ├─ idempotency de-dup (vs. store)
                  ├─ enrich → StoredTelegram (existing parsers.py + project name map)
                  └─ store.store_many(batch)          # batches of 5 000
```

* Runs as a single background `asyncio` task; CPU-heavy parsing yields regularly
  (`await asyncio.sleep(0)` between batches) so the live daemon and API stay responsive.
* One import job at a time (409 on concurrent start). Cancellable.
* Zip entries are processed via `zipfile` streams — a multi-GB upload is decompressed
  incrementally, bounded by one day-group of telegrams in memory (≈100 k telegrams).

### De-duplication (two layers)

1. **Cross-media window de-dup** (within the import): key `(src, dst, apdu-bytes)` inside a
   sliding **200 ms** window across the merged streams of one overlap group. Collapses the
   LAN/TP1 pairs measured above (max observed skew 23 ms) while keeping genuinely repeated
   telegrams (e.g. cyclic transmissions are seconds apart; even dimming steps are ≫200 ms).
   The earliest timestamp of a pair wins → deterministic output.
2. **Idempotency de-dup** (against the store): before inserting a batch spanning
   `[t0, t1]`, query existing telegrams in that range (`TelegramQuery(start_time, end_time)`)
   and skip exact `(timestamp, source, destination, raw_data, telegramtype)` matches.
   Because layer 1 is deterministic, re-importing the same file is a no-op.

Imported telegrams land in the **main store** (`direction="Incoming"`), so every existing
feature (history search, filters, context windows, charts) works on them unchanged — the core
ask of #99. A separate "dataset" namespace was considered and rejected for now: it would
require a schema/query extension in the library and UI scoping everywhere; if needed later it
can be added as a nullable `dataset` column without breaking this design.

### Job state & progress

In-memory singleton `ImportJob`:

```python
{ "id": str, "state": "running|done|failed|cancelled",
  "filename": str, "files_total": int, "files_done": int, "current_file": str,
  "bytes_total": int, "bytes_done": int,          # upload-side progress
  "telegrams_parsed": int, "telegrams_imported": int,
  "duplicates_skipped": int, "acks_skipped": int, "errors": int,
  "started_at": iso, "finished_at": iso|None, "error": str|None }
```

Progress is **polled** via `GET /api/import/status` (frontend polls ~500 ms while a job is
running). Polling was chosen over pushing on the existing `/ws/telegrams` socket because the
job state is trivially small, survives page reloads, and needs no WS protocol change; a WS
push can be layered on later without API changes.

## 4. HTTP API

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/import` | multipart upload, one `.xml` or `.zip`. Starts the job; `409` if one is running, `403` in `READ_ONLY` (companion) mode. Returns job id. |
| `GET` | `/api/import/status` | current/last job state (see above); `{"state": "idle"}` if none. |
| `POST` | `/api/import/cancel` | request cancellation of the running job. |
| `GET` | `/api/export` | same filter query params as `/api/telegrams` (+`start_time`/`end_time`); streams an ETS6-compatible `CommunicationLog` XML download. |

Export re-encodes each `StoredTelegram` into a cEMI `L_Data.ind` frame via xknx
(`GroupValueWrite/Response` from `raw_data`/`payload` + DPT heuristics, `GroupValueRead`
empty) and feeds the library's `write_communication_log`. Round-trip fidelity: addresses,
type, APDU and timestamp are exact; original bus-monitor metadata (ACKs, checksums,
connection name) is not reproduced.

## 5. Frontend — “Import / Export” view

* New entry in the top-left `NavDropdown` (`App.tsx`): `{ id: 'import', label: 'Import / Export', icon: FolderInput }` alongside Group Monitor / History Search / Settings.
* New component `ImportExportView.tsx` (full-pane view like live/history, not an overlay):
  * **Import card** — drag-&-drop / file picker (`.xml`, `.zip`); shows selected file, size;
    *Start import* button. Disabled with an explanatory note in companion/read-only mode.
  * **Progress card** — while running: overall progress bar (files done / total; bytes for
    single files), current file name, live counters (parsed / imported / duplicates /
    ACKs skipped / errors), cancel button. Terminal states render a summary (and error
    details on failure). Poll `GET /api/import/status` every 500 ms; on mount, pick up any
    already-running job (page-reload safe).
  * **Export card** — time-range picker + optional source/destination/type filters; *Download
    ETS6 XML* button hitting `/api/export`.
* Styling reuses `glass` cards / `nav-item` conventions from existing overlays.

## 6. Implementation plan

1. **Library** (`knx-telegram-store`, minor version bump → 0.6.0):
   `formats/ets_xml.py` + unit tests (parse ETS6 fixture incl. `RecordStart`, parse Gira
   fixture incl. timezone comment, writer round-trip). Dev-install (`pip install -e`) into the
   SpectrumKNX backend venv (currently pins 0.3.2 from PyPI — the two known pre-existing
   daemon-test failures stem from that pin and are unaffected by this feature).
2. **Backend importer** (`backend/telegram_import.py`): TP1 busmon adapter (+checksum),
   frame→`StoredTelegram` via existing parser pipeline, overlap grouping + k-way merge,
   window & idempotency de-dup, batched writes, `ImportJob` state machine.
3. **API** (`backend/api.py`): the four endpoints above, READ_ONLY gating consistent with
   `/api/project/upload`.
4. **Frontend**: `NavDropdown` entry + `ImportExportView.tsx` + status polling hook.
5. **Tests / validation**: unit tests for adapter, de-dup and job flow (backend), format
   round-trip (library); end-to-end: import the ETS6 sample and one full Gira day
   (TP1+LAN ≈ 87 k raw → expect ≈ 44 k stored, 43 k duplicates skipped), then re-import
   → 0 new rows.

## 7. Out of scope / future work

* Optional `dataset` tag column for isolating imports from live capture.
* Fuzzy de-dup against *live-captured* history (live daemon timestamps ≠ logger timestamps).
* WS push for progress; multi-job queue.
* Import of `.knxproj` alongside logs (already covered by the existing project upload).
