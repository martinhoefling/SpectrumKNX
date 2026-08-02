"""Tests for the telegram log importer (see DESIGN_IMPORT_EXPORT.md).

Covers the protocol-specific logic that lives in the app: the TP1 busmonitor
frame adapter (incl. checksum), cEMI decoding, de-duplication (window +
idempotency) and the background import job's counters and lifecycle.
"""

import os
import tempfile
from datetime import UTC, datetime, timedelta, timezone

import pytest
from knx_telegram_store.formats import RawTelegramRecord

import knx_daemon
import telegram_import as ti
from knx_telegram_store import StoredTelegram, TelegramQueryResult


@pytest.fixture(autouse=True)
def _clean_daemon_globals():
    """Isolate from other tests that patch knx_daemon globals to mocks — the
    importer decodes via the real parser pipeline and needs a clean daemon."""
    saved_xknx = knx_daemon.xknx_instance
    saved_map = knx_daemon.project_name_map
    knx_daemon.xknx_instance = None
    knx_daemon.project_name_map = {"ga": {}, "ia": {}}
    try:
        yield
    finally:
        knx_daemon.xknx_instance = saved_xknx
        knx_daemon.project_name_map = saved_map


# Real frames sampled from a Gira data logger (see the library format fixtures).
BUSMON_LDATA = bytes.fromhex("2B090301030604BAD64193BC1012143DE3008000C8C3")  # 1.0.18 → 2/4/61 write
BUSMON_ACK = bytes.fromhex("2B090301040604BAD6A0ACCC")  # single-byte link-layer ACK
ETS_LDATA = bytes.fromhex("2900BCE010180504010081")  # ETS6 export, decodes directly


# ── Busmonitor (TP1) → cEMI conversion ───────────────────────────────────────


def test_busmon_standard_ldata_frame():
    cemi, kind = ti.busmon_to_ldata(BUSMON_LDATA)
    assert kind == "data"
    # Reconstructed as a plain cEMI L_Data.ind (29 00 ...); checksum byte dropped.
    assert cemi is not None
    assert cemi[:2] == bytes([0x29, 0x00])
    assert cemi == bytes.fromhex("2900bce01012143d03008000c8")


def test_busmon_single_byte_is_ack():
    assert ti.busmon_to_ldata(BUSMON_ACK) == (None, "ack")


def test_busmon_checksum_mismatch_is_corrupt():
    corrupt = BUSMON_LDATA[:-1] + bytes([BUSMON_LDATA[-1] ^ 0xFF])
    assert ti.busmon_to_ldata(corrupt) == (None, "corrupt")


def test_busmon_non_ldata_control_is_other():
    # ctrl=0x00 → (ctrl & 0xD3) matches neither the standard nor extended mask.
    body = bytes([0x00, 0x11, 0x22])
    checksum = 0xFF
    for byte in body:
        checksum ^= byte
    frame = bytes([0x2B, 0x00]) + body + bytes([checksum])
    assert ti.busmon_to_ldata(frame) == (None, "other")


def test_busmon_wrong_message_code_is_other():
    # Not a cEMI L_Busmon.ind (first byte ≠ 0x2B).
    assert ti.busmon_to_ldata(bytes([0x11, 0x00])) == (None, "other")


def test_record_to_cemi_dispatches_on_service():
    busmon = RawTelegramRecord(datetime.now(UTC), "L_Busmon.ind", BUSMON_LDATA)
    cemi, kind = ti.record_to_cemi(busmon)
    assert kind == "data"
    assert cemi == bytes.fromhex("2900bce01012143d03008000c8")

    # L_Data.ind passes through untouched.
    ldata = RawTelegramRecord(datetime.now(UTC), "L_Data.ind", ETS_LDATA)
    assert ti.record_to_cemi(ldata) == (ETS_LDATA, "data")


# ── Decoding ─────────────────────────────────────────────────────────────────


def test_decode_cemi_valid_frame():
    telegram = ti.decode_cemi(ETS_LDATA)
    assert telegram is not None
    assert str(telegram.source_address) == "1.0.24"
    assert str(telegram.destination_address) == "0/5/4"


def test_decode_cemi_garbage_returns_none():
    assert ti.decode_cemi(b"\x00\x01\x02") is None


# ── De-dup key normalization ─────────────────────────────────────────────────


def _stored(**kw) -> StoredTelegram:
    base = dict(
        source="1.1.1",
        destination="1/2/3",
        telegramtype="GroupValueWrite",
        direction="Incoming",
        dpt_main=1,
        dpt_sub=1,
        payload=None,
        value=1.0,
        raw_data="01",
    )
    base.update(kw)
    return StoredTelegram(**base)


def test_dedup_key_normalizes_aware_and_naive_timestamps():
    aware = _stored(timestamp=datetime(2026, 3, 5, 1, 0, 0, tzinfo=timezone(timedelta(hours=1))))
    naive_utc = _stored(timestamp=datetime(2026, 3, 5, 0, 0, 0))  # same instant, naive UTC
    assert ti._dedup_key(aware) == ti._dedup_key(naive_utc)


# ── Source grouping ──────────────────────────────────────────────────────────


def test_group_sources_buckets_by_first_timestamp_date():
    def _src(name, xml):
        import io

        return ti.ImportSource(name=name, open_stream=lambda x=xml: io.BytesIO(x.encode()))

    day1 = '<CommunicationLog xmlns="http://knx.org/xml/telegrams/01"><Telegram Timestamp="2026-03-05T00:00:40.000Z" Service="L_Data.ind" RawData="2900BCE010180504010081" /></CommunicationLog>'
    day2 = '<CommunicationLog xmlns="http://knx.org/xml/telegrams/01"><Telegram Timestamp="2026-03-06T00:00:40.000Z" Service="L_Data.ind" RawData="2900BCE010180504010081" /></CommunicationLog>'
    groups = ti._group_sources([_src("lan.xml", day1), _src("tp1.xml", day2), _src("lan2.xml", day1)])
    # Two dates → two groups; the two day-1 files land together.
    assert len(groups) == 2
    assert {len(g) for g in groups} == {1, 2}


# ── Job lifecycle ────────────────────────────────────────────────────────────


def test_import_job_to_dict_shape():
    job = ti.ImportJob(filename="x.xml")
    d = job.to_dict()
    assert d["state"] == "running"
    assert d["filename"] == "x.xml"
    assert set(d) >= {
        "id",
        "telegrams_parsed",
        "telegrams_imported",
        "duplicates_skipped",
        "acks_skipped",
        "non_group_skipped",
        "errors",
        "finished_at",
    }


def test_cancel_import_returns_false_when_idle():
    ti.current_job = None
    assert ti.cancel_import() is False


# ── Full import flow (window + idempotency de-dup, counters) ──────────────────

# Two near-simultaneous busmon copies of the same telegram (window duplicate),
# one distinct ETS L_Data telegram, one link-layer ACK (skipped).
_IMPORT_XML = """<CommunicationLog xmlns="http://knx.org/xml/telegrams/01">
  <Telegram Timestamp="2026-03-05T00:00:38.994Z" Service="L_Busmon.ind" RawData="2B090301030604BAD64193BC1012143DE3008000C8C3" />
  <Telegram Timestamp="2026-03-05T00:00:39.000Z" Service="L_Busmon.ind" RawData="2B090301030604BAD64193BC1012143DE3008000C8C3" />
  <Telegram Timestamp="2026-03-05T00:00:40.000Z" Service="L_Data.ind" RawData="2900BCE010180504010081" />
  <Telegram Timestamp="2026-03-05T00:00:41.000Z" Service="L_Busmon.ind" RawData="2B090301040604BAD6A0ACCC" />
</CommunicationLog>
"""


class _FakeStore:
    """Minimal async store: accumulates saved telegrams, queries return them all."""

    def __init__(self):
        self.saved: list[StoredTelegram] = []

    async def query(self, query, **kwargs):
        return TelegramQueryResult(telegrams=list(self.saved), total_count=len(self.saved), limit_reached=False)

    async def store_many(self, batch):
        self.saved.extend(batch)


def _write_temp_xml() -> str:
    fd, path = tempfile.mkstemp(suffix=".xml")
    os.write(fd, _IMPORT_XML.encode())
    os.close(fd)
    return path


@pytest.mark.asyncio
async def test_run_import_counts_and_dedups():
    store = _FakeStore()
    job = ti.ImportJob(filename="log.xml")
    await ti._run_import(store, _write_temp_xml(), "log.xml", job)

    assert job.state == "done"
    assert job.telegrams_parsed == 4
    assert job.telegrams_imported == 2  # window-dup pair collapsed, ACK dropped
    assert job.duplicates_skipped == 1  # the second busmon copy
    assert job.acks_skipped == 1
    assert job.errors == 0
    assert len(store.saved) == 2
    assert job.finished_at is not None

    # Re-importing the same file is idempotent (layer-2 de-dup against the store).
    job2 = ti.ImportJob(filename="log.xml")
    await ti._run_import(store, _write_temp_xml(), "log.xml", job2)
    assert job2.telegrams_imported == 0
    assert job2.duplicates_skipped == 3
    assert len(store.saved) == 2


@pytest.mark.asyncio
async def test_run_import_cleans_up_temp_file():
    store = _FakeStore()
    path = _write_temp_xml()
    await ti._run_import(store, path, "log.xml", ti.ImportJob(filename="log.xml"))
    assert not os.path.exists(path)


@pytest.mark.asyncio
async def test_start_import_rejects_concurrent_job():
    # A job in the "running" state blocks a second start (409 upstream).
    ti.current_job = ti.ImportJob(filename="running.xml")
    try:
        with pytest.raises(RuntimeError, match="already running"):
            ti.start_import(_FakeStore(), "/tmp/does-not-matter.xml", "log2.xml")
        # cancel flips the flag so a later start is allowed.
        assert ti.cancel_import() is True
        assert ti.current_job.cancel_requested is True
    finally:
        ti.current_job = None


def test_list_sources_corrupt_zip_raises_actionable_error(monkeypatch, tmp_path):
    """A zip that passes is_zipfile but fails to parse (e.g. truncated central
    directory) surfaces a clear message instead of a raw struct.error."""
    import struct
    import zipfile

    fake = tmp_path / "corrupt.zip"
    fake.write_bytes(b"PK\x03\x04corrupt")

    monkeypatch.setattr(ti.zipfile, "is_zipfile", lambda _p: True)

    def _boom(*_a, **_k):
        raise struct.error("unpack requires a buffer of 4 bytes")

    monkeypatch.setattr(ti.zipfile, "ZipFile", _boom)

    with pytest.raises(ValueError, match="Could not read the zip archive"):
        ti._list_sources(str(fake), "corrupt.zip")

    # sanity: real BadZipFile is also wrapped
    monkeypatch.setattr(ti.zipfile, "ZipFile", lambda *_a, **_k: (_ for _ in ()).throw(zipfile.BadZipFile("bad")))
    with pytest.raises(ValueError, match="Could not read the zip archive"):
        ti._list_sources(str(fake), "corrupt.zip")


def test_list_sources_single_xml_passthrough(tmp_path):
    xml = tmp_path / "log.xml"
    xml.write_bytes(b"<CommunicationLog/>")
    sources = ti._list_sources(str(xml), "log.xml")
    assert len(sources) == 1
    assert sources[0].name == "log.xml"
