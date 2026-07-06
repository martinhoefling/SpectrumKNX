from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from knx_telegram_store import StoredTelegram, TelegramQueryResult

import ha_live_bridge
from ha_live_bridge import _as_utc, _fetch_since, _note_seen, ha_telegram_to_frontend


def _ha_telegram(**overrides) -> dict:
    """A TelegramDict as HA's knx/subscribe_telegrams emits it."""
    telegram = {
        "data_secure": False,
        "destination": "1/2/3",
        "destination_name": "Kitchen Temperature",
        "direction": "Incoming",
        "payload": [12, 26],
        "source": "1.1.5",
        "source_name": "Sensor Kitchen",
        "telegramtype": "GroupValueWrite",
        "timestamp": "2026-07-06T20:00:00+00:00",
        "dpt_main": 9,
        "dpt_sub": 1,
        "dpt_name": "temperature",
        "unit": "°C",
        "value": 21.5,
    }
    telegram.update(overrides)
    return telegram


def test_convert_numeric_telegram():
    result = ha_telegram_to_frontend(_ha_telegram())

    assert result["source_address"] == "1.1.5"
    assert result["source_name"] == "Sensor Kitchen"
    assert result["target_address"] == "1/2/3"
    assert result["target_name"] == "Kitchen Temperature"
    assert result["telegram_type"] == "GroupValueWrite"
    assert result["simplified_type"] == "Write"
    assert result["dpt"] == "9.001"
    assert result["value_numeric"] == 21.5
    assert result["value_json"] is None
    assert result["raw_data"] == "0c1a"
    assert result["raw_hex"] == "0x0c1a"
    assert result["timestamp"] == "2026-07-06T20:00:00+00:00"


def test_convert_bool_telegram():
    result = ha_telegram_to_frontend(_ha_telegram(payload=1, dpt_main=1, dpt_sub=1, unit=None, value=True))

    assert result["dpt"] == "1.001"
    # Booleans are not numeric values
    assert result["value_numeric"] is None
    assert result["value_json"] is True
    # A DPTBinary int payload does not map back to data bytes
    assert result["raw_data"] is None


def test_convert_undecoded_telegram():
    result = ha_telegram_to_frontend(
        _ha_telegram(payload=[1, 2, 3], dpt_main=None, dpt_sub=None, dpt_name=None, unit=None, value=None)
    )
    assert result["dpt"] is None
    assert result["value_numeric"] is None
    assert result["raw_data"] == "010203"


def test_note_seen_tracks_newest():
    ha_live_bridge._last_seen = None
    _note_seen("2026-07-06T20:00:00+00:00")
    _note_seen("2026-07-06T19:00:00+00:00")  # older — must not regress
    _note_seen("not a timestamp")  # ignored
    assert ha_live_bridge._last_seen == datetime(2026, 7, 6, 20, 0, tzinfo=UTC)


def _stored(minutes_ago: float) -> StoredTelegram:
    return StoredTelegram(
        # naive UTC, as the sqlite store round-trips timestamps
        timestamp=datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=minutes_ago),
        source="1.1.1",
        destination="1/1/1",
        telegramtype="GroupValueWrite",
        direction="Incoming",
        value=20.0,
        dpt_main=9,
    )


@pytest.mark.asyncio
@patch("ha_live_bridge.store.query", new_callable=AsyncMock)
async def test_fetch_since_filters_and_advances(mock_query):
    old, new = _stored(10), _stored(1)
    mock_query.return_value = TelegramQueryResult(telegrams=[old, new], total_count=2, limit_reached=False)

    since = datetime.now(UTC) - timedelta(minutes=5)
    result = await _fetch_since(since)

    assert len(result) == 1
    assert result[0]["target_address"] == "1/1/1"
    assert ha_live_bridge._last_seen == _as_utc(new.timestamp)

    query = mock_query.call_args[0][0]
    assert query.start_time == since
    assert query.order_descending is False
