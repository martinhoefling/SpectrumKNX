"""Tests for the telegram exporter (see DESIGN_IMPORT_EXPORT.md).

The exporter re-encodes a ``StoredTelegram`` (which keeps only the APDU payload)
into a full cEMI ``L_Data.ind`` frame via xknx and wraps it in a
``CommunicationLog`` record. These tests pin the APCI reconstruction rules and
verify an export→re-import round trip preserves addresses, type and payload.
"""

import io
from datetime import UTC, datetime

import telegram_export as te
from telegram_import import decode_cemi
from knx_telegram_store import StoredTelegram
from knx_telegram_store.formats import format_telegram_element, iter_communication_log


def _stored(**kw) -> StoredTelegram:
    base = dict(
        timestamp=datetime(2026, 3, 5, 0, 0, 0, tzinfo=UTC),
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


# ── APCI reconstruction ──────────────────────────────────────────────────────


def test_build_apci_read_has_no_payload():
    apci = te._build_apci(_stored(telegramtype="GroupValueRead", raw_data=None))
    assert type(apci).__name__ == "GroupValueRead"


def test_build_apci_binary_payload_uses_dptbinary():
    # 1-bit DPT, single byte within the APCI mask → carried inside the APCI byte.
    apci = te._build_apci(_stored(telegramtype="GroupValueWrite", dpt_main=1, raw_data="01"))
    assert type(apci.value).__name__ == "DPTBinary"


def test_build_apci_multibyte_payload_uses_dptarray():
    apci = te._build_apci(_stored(telegramtype="GroupValueWrite", dpt_main=5, raw_data="00c8"))
    assert type(apci.value).__name__ == "DPTArray"
    assert apci.value.value == (0x00, 0xC8)


def test_build_apci_response_type():
    apci = te._build_apci(_stored(telegramtype="GroupValueResponse", dpt_main=1, raw_data="01"))
    assert type(apci).__name__ == "GroupValueResponse"


def test_build_apci_unknown_type_returns_none():
    assert te._build_apci(_stored(telegramtype="IndividualAddressRead", raw_data="01")) is None


def test_build_apci_write_without_payload_returns_none():
    assert te._build_apci(_stored(telegramtype="GroupValueWrite", raw_data=None)) is None


# ── stored_to_record ─────────────────────────────────────────────────────────


def test_stored_to_record_produces_ldata_ind():
    record = te.stored_to_record(_stored(source="1.0.18", destination="2/4/61", dpt_main=5, raw_data="00c8"))
    assert record is not None
    assert record.service == "L_Data.ind"
    assert record.raw_data.startswith(bytes([0x29, 0x00]))  # cEMI L_Data.ind message code


def test_stored_to_record_naive_timestamp_made_utc_aware():
    record = te.stored_to_record(_stored(timestamp=datetime(2026, 3, 5, 12, 0, 0)))
    assert record.timestamp.tzinfo is not None
    assert record.timestamp == datetime(2026, 3, 5, 12, 0, 0, tzinfo=UTC)


def test_stored_to_record_unencodable_returns_none():
    # A group-write with no payload cannot be re-encoded.
    assert te.stored_to_record(_stored(telegramtype="GroupValueWrite", raw_data=None)) is None


# ── Export → re-import round trip ────────────────────────────────────────────


def _round_trip(stored: StoredTelegram):
    record = te.stored_to_record(stored)
    assert record is not None
    xml = (
        '<CommunicationLog xmlns="http://knx.org/xml/telegrams/01">\n'
        + format_telegram_element(record, connection_name="Spectrum KNX Export")
        + "</CommunicationLog>\n"
    )
    parsed = list(iter_communication_log(io.BytesIO(xml.encode())))
    assert len(parsed) == 1
    return decode_cemi(parsed[0].raw_data)


def test_round_trip_preserves_addresses_type_and_payload():
    telegram = _round_trip(_stored(source="1.0.18", destination="2/4/61", dpt_main=5, raw_data="00c8"))
    assert str(telegram.source_address) == "1.0.18"
    assert str(telegram.destination_address) == "2/4/61"
    assert type(telegram.payload).__name__ == "GroupValueWrite"
    assert telegram.payload.value.value == (0x00, 0xC8)


def test_round_trip_group_value_read():
    telegram = _round_trip(_stored(telegramtype="GroupValueRead", raw_data=None))
    assert type(telegram.payload).__name__ == "GroupValueRead"
    assert str(telegram.destination_address) == "1/2/3"
