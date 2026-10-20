"""Export of stored telegrams as ETS6-compatible ``CommunicationLog`` XML or CSV.

``StoredTelegram.raw_data`` holds only the APDU payload bytes, so full cEMI
frames are re-encoded via xknx. Addresses, telegram type, APDU and timestamp
are exact; transport-level details of the original capture (hop count,
bus ACKs) are not reproduced. See DESIGN_IMPORT_EXPORT.md.
"""

from __future__ import annotations

import csv
import io
from datetime import UTC

from knx_telegram_store import StoredTelegram
from knx_telegram_store.formats import RawTelegramRecord
from xknx.cemi import CEMIFrame, CEMILData, CEMIMessageCode
from xknx.dpt import DPTArray, DPTBinary
from xknx.exceptions import XKNXException
from xknx.telegram import Telegram as XknxTelegram
from xknx.telegram.address import GroupAddress, IndividualAddress
from xknx.telegram.apci import APCI, GroupValueRead, GroupValueResponse, GroupValueWrite

# DPT main numbers whose payload travels inside the APCI byte (DPTBinary, ≤6 bit)
_BINARY_DPT_MAINS = {1, 2, 3, 23}


def _build_apci(telegram: StoredTelegram) -> APCI | None:
    if telegram.telegramtype == "GroupValueRead":
        return GroupValueRead()
    if telegram.telegramtype not in ("GroupValueWrite", "GroupValueResponse"):
        return None
    if not telegram.raw_data:
        return None
    payload = bytes.fromhex(telegram.raw_data)
    # Single-byte payloads are ambiguous: DPTBinary (value in the APCI byte)
    # vs. a one-byte DPTArray. Prefer the DPT metadata; fall back to treating
    # small unknown values as binary (switches dominate undecoded traffic).
    if len(payload) == 1 and (
        telegram.dpt_main in _BINARY_DPT_MAINS or (telegram.dpt_main is None and payload[0] <= DPTBinary.APCI_BITMASK)
    ):
        value: DPTArray | DPTBinary = DPTBinary(payload[0])
    else:
        value = DPTArray(payload)
    if telegram.telegramtype == "GroupValueResponse":
        return GroupValueResponse(value)
    return GroupValueWrite(value)


def stored_to_record(telegram: StoredTelegram) -> RawTelegramRecord | None:
    """Re-encodes a stored telegram as a raw cEMI log record (None if impossible)."""
    apci = _build_apci(telegram)
    if apci is None:
        return None
    try:
        xknx_telegram = XknxTelegram(
            destination_address=GroupAddress(telegram.destination),
            source_address=IndividualAddress(telegram.source),
            payload=apci,
        )
        data = CEMILData.init_from_telegram(xknx_telegram, src_addr=IndividualAddress(telegram.source))
        frame = CEMIFrame(code=CEMIMessageCode.L_DATA_IND, data=data)
        raw = bytes(frame.to_knx())
    except (XKNXException, ValueError):
        return None
    timestamp = telegram.timestamp if telegram.timestamp.tzinfo else telegram.timestamp.replace(tzinfo=UTC)
    return RawTelegramRecord(timestamp=timestamp, service="L_Data.ind", raw_data=raw)


# ── CSV (#522) ──────────────────────────────────────────────────────────────
# Columns of the CSV export, keyed by the field of the API telegram dict
# (``api._build_telegram_response``). Kept in sync with the frontend's
# ``utils/telegramCsv.ts``, which exports the telegram list's current view.
CSV_COLUMNS: list[tuple[str, str]] = [
    ("timestamp", "timestamp"),
    ("source_address", "source"),
    ("source_name", "source_name"),
    ("target_address", "target"),
    ("target_name", "target_name"),
    ("simplified_type", "type"),
    ("direction", "direction"),
    ("dpt", "dpt"),
    ("dpt_name", "dpt_name"),
    ("value_formatted", "value"),
    ("value_numeric", "value_numeric"),
    ("unit", "unit"),
    ("raw_hex", "raw"),
]

CSV_DELIMITERS = {"comma": ",", "semicolon": ";"}


def _csv_cell(row: dict, key: str) -> object:
    if key == "dpt":
        main, sub = row.get("dpt_main"), row.get("dpt_sub")
        if main is None:
            return ""
        return f"{main}.{sub:03d}" if sub is not None else str(main)
    value = row.get(key)
    if key == "timestamp" and hasattr(value, "isoformat"):
        return value.astimezone(UTC).isoformat() if value.tzinfo else value.isoformat()
    return "" if value is None else value


def csv_header(delimiter: str = ",") -> str:
    """The CSV header line, prefixed with a UTF-8 BOM so Excel detects the encoding."""
    buf = io.StringIO()
    csv.writer(buf, delimiter=delimiter).writerow(label for _, label in CSV_COLUMNS)
    return "\ufeff" + buf.getvalue()


def csv_rows(rows: list[dict], delimiter: str = ",") -> str:
    """CSV lines for API telegram dicts, without a header."""
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=delimiter)
    for row in rows:
        writer.writerow(_csv_cell(row, key) for key, _ in CSV_COLUMNS)
    return buf.getvalue()
