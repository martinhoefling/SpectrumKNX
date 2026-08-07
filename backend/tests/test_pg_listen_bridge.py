import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from knx_telegram_store import StoredTelegram, TelegramQueryResult

import pg_listen_bridge
from pg_listen_bridge import _as_utc, _replay_gap


def _stored(minutes_ago: float, destination: str = "1/1/1") -> StoredTelegram:
    return StoredTelegram(
        timestamp=datetime.now(UTC) - timedelta(minutes=minutes_ago),
        source="1.1.1",
        destination=destination,
        telegramtype="GroupValueWrite",
        direction="Incoming",
        value=20.0,
        dpt_main=9,
    )


def test_live_feed_status_reflects_bridge_state():
    with patch.object(pg_listen_bridge, "_connected", True):
        assert pg_listen_bridge.live_feed_status() == {"connected": True}

    with patch.object(pg_listen_bridge, "_connected", False):
        assert pg_listen_bridge.live_feed_status() == {"connected": False}


@pytest.mark.asyncio
async def test_replay_gap_noop_when_never_seen():
    with patch.object(pg_listen_bridge, "_last_seen", None):
        # No store.query patch: a call here would raise, proving it's skipped.
        await _replay_gap()


@pytest.mark.asyncio
@patch("pg_listen_bridge.store.query", new_callable=AsyncMock)
@patch("pg_listen_bridge.manager.broadcast", new_callable=AsyncMock)
async def test_replay_gap_broadcasts_fresh_and_advances(mock_broadcast, mock_query):
    old, new = _stored(10), _stored(1, "2/2/2")
    mock_query.return_value = TelegramQueryResult(telegrams=[old, new], total_count=2, limit_reached=False)
    since = datetime.now(UTC) - timedelta(minutes=5)

    pg_listen_bridge._last_seen = since
    await _replay_gap()

    mock_broadcast.assert_awaited_once()
    broadcast_arg = mock_broadcast.await_args.args[0]
    assert broadcast_arg["target_address"] == "2/2/2"
    assert pg_listen_bridge._last_seen == _as_utc(new.timestamp)

    query = mock_query.call_args[0][0]
    assert query.start_time == since
    assert query.order_descending is False


@pytest.mark.asyncio
@patch("pg_listen_bridge.manager.broadcast", new_callable=AsyncMock)
async def test_listen_loop_broadcasts_notified_telegrams(mock_broadcast):
    telegram = _stored(0, "3/3/3")

    async def _one_telegram_then_hang():
        # Mirrors the real generator: never completes on its own, only via
        # cancellation/exception. A generator that exhausts normally would
        # make the loop immediately reconnect and re-yield, breaking the
        # single-broadcast assertion below.
        yield telegram
        await asyncio.Event().wait()

    with (
        patch.object(pg_listen_bridge, "store") as mock_store,
        patch.object(pg_listen_bridge, "_replay_gap", new=AsyncMock()),
    ):
        mock_store.listen_for_new_telegrams = lambda: _one_telegram_then_hang()
        task = asyncio.create_task(pg_listen_bridge._listen_loop())

        # Give the loop a chance to consume the single-item generator.
        for _ in range(50):
            if mock_broadcast.await_count:
                break
            await asyncio.sleep(0.02)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    mock_broadcast.assert_awaited_once()
    assert mock_broadcast.await_args.args[0]["target_address"] == "3/3/3"
    assert pg_listen_bridge._last_seen == _as_utc(telegram.timestamp)
