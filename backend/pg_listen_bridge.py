"""Live telegram feed for postgres-readonly mode (STORE_MODE=postgres-readonly).

Home Assistant (or another writer) owns the shared Postgres database; this
module feeds the live websocket view via the knx_telegram_store library's
LISTEN/NOTIFY support (store.listen_for_new_telegrams()). Unlike
external-readonly's ha_live_bridge, our own KNX daemon still runs alongside
this mode for outbound bus writes (see knx_daemon.py) but never reports
telegrams to the store or the live feed itself — only this listener does,
driven directly by the writer's inserts, so the feed always matches what is
actually persisted. On reconnect the gap is replayed from the store, so a
brief LISTEN drop does not lose telegrams.
"""

import asyncio
import logging
from datetime import UTC, datetime

from knx_telegram_store import TelegramQuery

from database import store
from ws_manager import manager

logger = logging.getLogger("uvicorn.error")

_task: asyncio.Task | None = None
_connected: bool = False
_last_seen: datetime | None = None


def live_feed_status() -> dict:
    """Current live-feed state for the status API."""
    return {"connected": _connected}


def _as_utc(dt: datetime) -> datetime:
    """The store round-trips naive timestamps as UTC by convention."""
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


async def _replay_gap() -> None:
    """Broadcast telegrams the writer persisted while the listener was disconnected."""
    from api import _build_telegram_response

    global _last_seen
    if _last_seen is None:
        return
    try:
        result = await store.query(TelegramQuery(start_time=_last_seen, order_descending=False, limit=5000))
        fresh = [t for t in result.telegrams if _as_utc(t.timestamp) > _last_seen]
        if fresh:
            _last_seen = _as_utc(fresh[-1].timestamp)
            for telegram in _build_telegram_response(fresh):
                await manager.broadcast(telegram)
    except Exception as err:
        logger.warning(f"Gap replay from store failed: {err}")


async def _listen_loop() -> None:
    from api import _build_telegram_response

    global _connected, _last_seen
    backoff = 1.0
    while True:
        try:
            _connected = True
            backoff = 1.0
            await _replay_gap()
            async for telegram in store.listen_for_new_telegrams():
                _last_seen = _as_utc(telegram.timestamp)
                await manager.broadcast(_build_telegram_response([telegram])[0])
        except asyncio.CancelledError:
            _connected = False
            raise
        except Exception as err:
            _connected = False
            logger.warning(f"Postgres LISTEN/NOTIFY bridge disconnected: {err} — retrying in {backoff:.0f}s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)


async def postgres_listen_startup() -> None:
    """Start the LISTEN/NOTIFY task feeding the live view."""
    global _task
    logger.info("Postgres companion mode: live updates via LISTEN/NOTIFY")
    _task = asyncio.create_task(_listen_loop())


async def postgres_listen_shutdown() -> None:
    """Stop the LISTEN/NOTIFY task."""
    global _task, _connected
    _connected = False
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
