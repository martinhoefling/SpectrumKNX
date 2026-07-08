"""Import of historical KNX telegram logs (ETS6 / Gira ``CommunicationLog`` XML).

See DESIGN_IMPORT_EXPORT.md. The XML container parsing lives in
``knx_telegram_store.formats``; this module adds everything protocol- and
app-specific: busmonitor (TP1) frame conversion, cEMI decoding via xknx,
enrichment through the shared parser pipeline, de-duplication and the
background import job with progress reporting.
"""

from __future__ import annotations

import asyncio
import heapq
import logging
import os
import uuid
import zipfile
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import IO, Any

from knx_telegram_store.formats import RawTelegramRecord, iter_communication_log
from xknx.cemi import CEMIFrame
from xknx.exceptions import XKNXException
from xknx.telegram import Telegram as XknxTelegram
from xknx.telegram.apci import GroupValueRead, GroupValueResponse, GroupValueWrite

import knx_daemon
from knx_telegram_store import StoredTelegram, TelegramQuery
from parsers import parse_telegram_payload

logger = logging.getLogger("uvicorn.error")

# Cross-media de-dup window: Gira logs the same telegram on TP1 and LAN with a
# measured skew of ≤23ms (median 6ms); genuinely repeated telegrams are ≫200ms apart.
DEDUP_WINDOW = timedelta(milliseconds=200)
BATCH_SIZE = 5_000


# ── Busmonitor (TP1 raw frame) → cEMI L_Data conversion ──────────────────────


def busmon_to_ldata(raw: bytes) -> tuple[bytes | None, str]:
    """Converts a cEMI L_Busmon.ind frame into a plain cEMI L_Data.ind frame.

    Returns ``(cemi_bytes, "data")`` for L_Data frames, or ``(None, kind)``
    where kind is "ack" (link-layer ACK/NAK/BUSY), "corrupt" (checksum
    mismatch) or "other" (non-L_Data traffic such as poll frames).
    """
    if len(raw) < 2 or raw[0] != 0x2B:
        return None, "other"
    additional_info_length = raw[1]
    tp1 = raw[2 + additional_info_length :]
    if len(tp1) <= 1:
        # Single byte: link-layer acknowledgement (0xCC ACK / 0x0C NAK / 0xC0 BUSY)
        return None, "ack"

    checksum = 0xFF
    for byte in tp1[:-1]:
        checksum ^= byte
    if checksum != tp1[-1]:
        return None, "corrupt"

    control = tp1[0]
    if (control & 0xD3) == 0x90 and len(tp1) >= 8:
        # Standard frame: CTRL SRC(2) DST(2) LEN/AT APDU… CHK
        length = tp1[5] & 0x0F
        apdu = tp1[6 : 6 + length + 1]
        if len(apdu) != length + 1:
            return None, "corrupt"
        cemi = bytes([0x29, 0x00, control, tp1[5] & 0xF0]) + tp1[1:5] + bytes([length]) + apdu
        return cemi, "data"
    if (control & 0xD3) == 0x10:
        # Extended frame: CTRL CTRLE SRC(2) DST(2) LEN APDU… CHK — layout after
        # CTRL already matches cEMI L_Data, only the checksum must go.
        return bytes([0x29, 0x00]) + tp1[:-1], "data"
    return None, "other"


def record_to_cemi(record: RawTelegramRecord) -> tuple[bytes | None, str]:
    """Normalizes a log record to a decodable cEMI L_Data frame."""
    if record.service == "L_Busmon.ind":
        return busmon_to_ldata(record.raw_data)
    return record.raw_data, "data"


# ── Decoding & enrichment ────────────────────────────────────────────────────


def decode_cemi(cemi: bytes) -> XknxTelegram | None:
    """Decodes a cEMI L_Data frame into an xknx telegram (None if unsupported)."""
    try:
        frame = CEMIFrame.from_knx(cemi)
        telegram = frame.data.telegram()  # type: ignore[union-attr]
    except (XKNXException, AttributeError, IndexError, ValueError):
        # ValueError: xknx raises bare ValueErrors for e.g. invalid secure APCI services
        return None
    xknx = knx_daemon.xknx_instance
    if xknx is not None:
        xknx.group_address_dpt.set_decoded_data(telegram)
    return telegram


def build_stored_telegram(telegram: XknxTelegram, timestamp: datetime) -> StoredTelegram:
    """Maps an xknx telegram to a StoredTelegram — mirrors the live daemon mapping."""
    source_addr = str(telegram.source_address)
    target_addr = str(telegram.destination_address) if telegram.destination_address else "0/0/0"

    value_numeric, value_json, raw_data, _dpt_str, dpt_main, dpt_sub, _unit, _value_formatted, _raw_hex = (
        parse_telegram_payload(telegram, knx_daemon.xknx_instance)
    )
    return StoredTelegram(
        timestamp=timestamp,
        source=source_addr,
        destination=target_addr,
        telegramtype=type(telegram.payload).__name__,
        direction="Incoming",
        dpt_main=dpt_main,
        dpt_sub=dpt_sub,
        payload=value_json,
        value=value_numeric,
        raw_data=raw_data.hex() if isinstance(raw_data, bytes) else raw_data,
        source_name=knx_daemon.project_name_map["ia"].get(source_addr) or "",
        destination_name=knx_daemon.project_name_map["ga"].get(target_addr) or "",
    )


def _dedup_key(telegram: StoredTelegram) -> tuple:
    """Identity key for idempotency de-dup; timestamps normalized to naive UTC
    (SQL backends return naive UTC datetimes)."""
    ts = telegram.timestamp
    if ts.tzinfo is not None:
        ts = ts.astimezone(UTC).replace(tzinfo=None)
    return (ts, telegram.source, telegram.destination, telegram.telegramtype, telegram.raw_data or "")


# ── Import sources (single xml / zip of xml) ─────────────────────────────────


@dataclass
class ImportSource:
    """One parseable XML stream within the upload."""

    name: str
    open_stream: Callable[[], IO[bytes]]


def _list_sources(path: str, filename: str) -> list[ImportSource]:
    if zipfile.is_zipfile(path):
        archive = zipfile.ZipFile(path)
        sources = []
        for info in archive.infolist():
            base = os.path.basename(info.filename)
            if info.is_dir() or not base.lower().endswith(".xml") or base.startswith("."):
                continue

            def _opener(name: str = info.filename) -> IO[bytes]:
                return archive.open(name)

            sources.append(ImportSource(name=info.filename, open_stream=_opener))
        return sources
    return [ImportSource(name=filename, open_stream=lambda: open(path, "rb"))]


def _peek_first_timestamp(source: ImportSource) -> datetime | None:
    try:
        with source.open_stream() as stream:
            for record in iter_communication_log(stream):
                return record.timestamp
    except Exception:
        return None
    return None


def _group_sources(sources: list[ImportSource]) -> list[list[ImportSource]]:
    """Groups sources that may contain the same telegrams on different media.

    Gira loggers write one LAN and one TP1 file per day; files of the same
    (UTC) day are merged and de-duplicated together. Sources without a single
    parseable telegram are kept (their parse errors surface in the job counters).
    """
    dated: list[tuple[datetime | None, ImportSource]] = [(_peek_first_timestamp(s), s) for s in sources]
    groups: dict[Any, list[ImportSource]] = {}
    for first_ts, source in dated:
        key = first_ts.date() if first_ts else ("undated", source.name)
        groups.setdefault(key, []).append(source)
    return [group for _, group in sorted(groups.items(), key=lambda item: str(item[0]))]


# ── Import job ───────────────────────────────────────────────────────────────


@dataclass
class ImportJob:
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    state: str = "running"  # running | done | failed | cancelled
    filename: str = ""
    files_total: int = 0
    files_done: int = 0
    current_file: str = ""
    telegrams_parsed: int = 0
    telegrams_imported: int = 0
    duplicates_skipped: int = 0
    acks_skipped: int = 0
    non_group_skipped: int = 0  # device programming / TPCI control traffic
    errors: int = 0
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    finished_at: datetime | None = None
    error: str | None = None
    cancel_requested: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "state": self.state,
            "filename": self.filename,
            "files_total": self.files_total,
            "files_done": self.files_done,
            "current_file": self.current_file,
            "telegrams_parsed": self.telegrams_parsed,
            "telegrams_imported": self.telegrams_imported,
            "duplicates_skipped": self.duplicates_skipped,
            "acks_skipped": self.acks_skipped,
            "non_group_skipped": self.non_group_skipped,
            "errors": self.errors,
            "started_at": self.started_at.isoformat(),
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "error": self.error,
        }


current_job: ImportJob | None = None
_job_task: asyncio.Task | None = None


class _ImportCancelled(Exception):
    pass


def _iter_group_telegrams(group: list[ImportSource], job: ImportJob) -> Iterator[StoredTelegram]:
    """Merges a group's streams by timestamp, converts, de-dups and enriches.

    Runs in a worker thread (pure CPU + file IO); mutates job counters, which
    is safe for int increments under the GIL.
    """

    def _stream(source: ImportSource) -> Iterator[tuple[datetime, bytes]]:
        try:
            with source.open_stream() as stream:
                for record in iter_communication_log(stream):
                    if job.cancel_requested:
                        raise _ImportCancelled
                    job.telegrams_parsed += 1
                    cemi, kind = record_to_cemi(record)
                    if cemi is None:
                        if kind == "ack":
                            job.acks_skipped += 1
                        else:
                            job.errors += 1
                        continue
                    yield record.timestamp, cemi
        except _ImportCancelled:
            raise
        except Exception as e:
            logger.warning(f"Import: failed to parse {source.name}: {e}")
            job.errors += 1

    job.current_file = ", ".join(os.path.basename(s.name) for s in group)
    recent: dict[bytes, datetime] = {}
    last_prune = datetime.min.replace(tzinfo=UTC)
    for timestamp, cemi in heapq.merge(*(_stream(s) for s in group), key=lambda item: item[0]):
        # Key excludes msg-code/add-info/ctrl bytes: the router decrements the
        # hop count when forwarding, so the TP1 and LAN copies of the same
        # telegram differ in ctrl2. src+dst+len+apdu identifies the telegram.
        key = cemi[4:]
        kept_at = recent.get(key)
        if kept_at is not None and timestamp - kept_at <= DEDUP_WINDOW:
            job.duplicates_skipped += 1
            continue
        recent[key] = timestamp
        if timestamp - last_prune > timedelta(seconds=5):
            recent = {frame: ts for frame, ts in recent.items() if timestamp - ts <= DEDUP_WINDOW}
            last_prune = timestamp

        telegram = decode_cemi(cemi)
        if telegram is None:
            job.errors += 1
            continue
        if not isinstance(telegram.payload, GroupValueWrite | GroupValueRead | GroupValueResponse):
            job.non_group_skipped += 1
            continue
        yield build_stored_telegram(telegram, timestamp)
    job.files_done += len(group)


def _next_batch(iterator: Iterator[StoredTelegram]) -> list[StoredTelegram]:
    batch = []
    for telegram in iterator:
        batch.append(telegram)
        if len(batch) >= BATCH_SIZE:
            break
    return batch


async def _existing_keys(store, start: datetime, end: datetime) -> set[tuple]:
    """Keys of telegrams already stored in [start, end] for idempotent re-import."""
    keys: set[tuple] = set()
    offset = 0
    while True:
        result = await store.query(
            TelegramQuery(start_time=start, end_time=end, limit=BATCH_SIZE * 4, offset=offset, order_descending=False)
        )
        keys.update(_dedup_key(t) for t in result.telegrams)
        if not result.limit_reached:
            return keys
        offset += len(result.telegrams)


async def _run_import(store, path: str, filename: str, job: ImportJob) -> None:
    try:
        sources = await asyncio.to_thread(_list_sources, path, filename)
        if not sources:
            raise ValueError("No XML files found in upload")
        job.files_total = len(sources)
        groups = await asyncio.to_thread(_group_sources, sources)

        for group in groups:
            if job.cancel_requested:
                raise _ImportCancelled
            iterator = _iter_group_telegrams(group, job)
            while True:
                batch = await asyncio.to_thread(_next_batch, iterator)
                if not batch:
                    break
                existing = await _existing_keys(store, batch[0].timestamp, batch[-1].timestamp)
                fresh = [t for t in batch if _dedup_key(t) not in existing]
                job.duplicates_skipped += len(batch) - len(fresh)
                if fresh:
                    await store.store_many(fresh)
                    job.telegrams_imported += len(fresh)
                if job.cancel_requested:
                    raise _ImportCancelled

        job.state = "done"
        logger.info(
            f"Import finished: {job.telegrams_imported} imported, "
            f"{job.duplicates_skipped} duplicates, {job.errors} errors ({filename})"
        )
    except _ImportCancelled:
        job.state = "cancelled"
        logger.info(f"Import cancelled ({filename})")
    except Exception as e:
        job.state = "failed"
        job.error = str(e)
        logger.error(f"Import failed ({filename}): {e}")
    finally:
        job.finished_at = datetime.now(UTC)
        job.current_file = ""
        try:
            os.unlink(path)
        except OSError:
            pass


def start_import(store, path: str, filename: str) -> ImportJob:
    """Starts a background import of the uploaded file. Raises if one is running."""
    global current_job, _job_task
    if current_job is not None and current_job.state == "running":
        raise RuntimeError("An import is already running")
    current_job = ImportJob(filename=filename)
    _job_task = asyncio.get_running_loop().create_task(_run_import(store, path, filename, current_job))
    return current_job


def cancel_import() -> bool:
    """Requests cancellation of the running import. Returns False if none runs."""
    if current_job is None or current_job.state != "running":
        return False
    current_job.cancel_requested = True
    return True
