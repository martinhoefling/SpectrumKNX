"""Export of stored telegrams as ETS6-compatible ``CommunicationLog`` XML.

``StoredTelegram.raw_data`` holds only the APDU payload bytes, so full cEMI
frames are re-encoded via xknx. Addresses, telegram type, APDU and timestamp
are exact; transport-level details of the original capture (hop count,
bus ACKs) are not reproduced. See DESIGN_IMPORT_EXPORT.md.
"""

from __future__ import annotations

from datetime import UTC

from knx_telegram_store.formats import RawTelegramRecord
from xknx.cemi import CEMIFrame, CEMILData, CEMIMessageCode
from xknx.dpt import DPTArray, DPTBinary
from xknx.exceptions import XKNXException
from xknx.telegram import Telegram as XknxTelegram
from xknx.telegram.address import GroupAddress, IndividualAddress
from xknx.telegram.apci import APCI, GroupValueRead, GroupValueResponse, GroupValueWrite

from knx_telegram_store import StoredTelegram

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
