"""Live telegram feed for companion mode (STORE_MODE=external-readonly).

Home Assistant's KNX integration owns the bus connection and the telegram
database; this module only feeds the live websocket view. Two sources:

- ha_websocket (default): subscribe to HA's ``knx/subscribe_telegrams`` over
  the Supervisor core websocket proxy — push, sub-second latency. On
  reconnect the gap is replayed from the (shared) store, so nothing is lost.
- poll: query the store for new rows on an interval — no HA API dependency,
  latency ≈ HA's flush interval + poll interval. Also useful for pointing a
  dev instance at any store sqlite file.
"""

import asyncio
import json
import logging
import os
from datetime import UTC, datetime

import websockets
from knx_telegram_store import TelegramQuery

from database import store
from parsers import format_dpt_name, format_value_nicely, get_simplified_type
from ws_manager import manager

logger = logging.getLogger("uvicorn.error")

HA_WS_URL = os.getenv("HA_WS_URL", "ws://supervisor/core/websocket")
LIVE_SOURCE = os.getenv("LIVE_SOURCE", "ha_websocket")  # ha_websocket | poll | none
POLL_INTERVAL = float(os.getenv("LIVE_POLL_INTERVAL", "1.0"))

_task: asyncio.Task | None = None
_last_seen: datetime | None = None
_active_source: str = "none"  # resolved live source after fallbacks
_connected: bool = False

# How often to look again while the store still holds pre-UTC timestamps (#462).
TIMESTAMP_RECHECK_INTERVAL = 300.0
_timestamp_task: asyncio.Task | None = None
_legacy_timestamps: bool = False


def live_feed_status() -> dict:
    """Current live-feed state for the status API (companion mode, #184)."""
    return {"source": _active_source, "connected": _connected, "legacy_timestamps": _legacy_timestamps}


def get_last_telegram_timestamp() -> datetime | None:
    """Returns the timestamp of the last telegram seen by the HA bridge."""
    return _last_seen


def _ha_token() -> str:
    return os.getenv("SUPERVISOR_TOKEN") or os.getenv("HA_TOKEN", "")


def _as_utc(dt: datetime) -> datetime:
    """Normalise a timestamp to aware UTC.

    knx-telegram-store>=0.14 already returns aware UTC, so the naive branch
    only covers a store written by an older version that has not been
    converted yet, and HA event payloads parsed straight from ISO strings.
    """
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


async def check_timestamp_convention() -> bool:
    """Record whether the store still holds pre-UTC timestamps (#462).

    Home Assistant used to stamp telegrams with its local wall clock, and
    knx-telegram-store>=0.14 reads every stored timestamp as UTC. Until Home
    Assistant converts its database those rows are off by its UTC offset, which
    shifts history and makes `_fetch_since` compare stored rows against real
    instants from the live feed: east of UTC they all look new and repeat, west
    of UTC new ones are dropped. Only the owner may convert, so all we can do
    is say so. The check is a plain SELECT and safe on a read-only connection.
    """
    global _legacy_timestamps
    try:
        pending = await store.needs_timestamp_migration()
    except Exception as err:
        logger.debug(f"Could not determine the store's timestamp convention: {err}")
        return _legacy_timestamps
    if pending and not _legacy_timestamps:
        logger.warning(
            "Home Assistant's KNX telegram database still holds local-time timestamps. "
            "History is shown shifted by Home Assistant's UTC offset and the live view may "
            "repeat or miss telegrams. Only Home Assistant can convert it: update to a release "
            "whose KNX integration does. This warning clears by itself once that has happened."
        )
    elif _legacy_timestamps and not pending:
        logger.info("Home Assistant has converted its KNX telegram database to UTC timestamps.")
    _legacy_timestamps = pending
    return pending


async def _timestamp_watch_loop() -> None:
    """Re-check until Home Assistant has converted its database, then stop."""
    while _legacy_timestamps:
        await asyncio.sleep(TIMESTAMP_RECHECK_INTERVAL)
        await check_timestamp_convention()


def ha_telegram_to_frontend(t: dict) -> dict:
    """Convert an HA TelegramDict event into the frontend live-feed format."""
    dpt_main = t.get("dpt_main")
    dpt_sub = t.get("dpt_sub")
    value = t.get("value")
    value_numeric = value if isinstance(value, int | float) and not isinstance(value, bool) else None
    value_json = value if value_numeric is None else None

    # HA sends the decoded payload (DPTArray tuple / DPTBinary int), not the
    # raw frame; the tuple maps back to the data bytes, a bare int does not.
    payload = t.get("payload")
    raw_data = bytes(payload).hex() if isinstance(payload, list | tuple) else None

    dpt_name, unit = format_dpt_name(dpt_main, dpt_sub)
    if dpt_main and dpt_sub is not None:
        dpt_str = f"{dpt_main}.{dpt_sub:03d}"
    else:
        dpt_str = str(dpt_main) if dpt_main else None

    return {
        "timestamp": t.get("timestamp"),
        "source_address": t.get("source"),
        "source_name": t.get("source_name") or None,
        "target_address": t.get("destination"),
        "target_name": t.get("destination_name") or None,
        "telegram_type": t.get("telegramtype"),
        "simplified_type": get_simplified_type(t.get("telegramtype")),
        "dpt": dpt_str,
        "dpt_main": dpt_main,
        "dpt_sub": dpt_sub,
        "dpt_name": dpt_name,
        "unit": unit or t.get("unit"),
        "value_numeric": value_numeric,
        "value_json": value_json,
        "value_formatted": format_value_nicely(value, dpt_main, dpt_sub),
        "raw_data": raw_data,
        "raw_hex": f"0x{raw_data}" if raw_data and len(raw_data) > 1 else raw_data,
    }


def _note_seen(timestamp: str | None) -> None:
    global _last_seen
    if not timestamp:
        return
    try:
        ts = _as_utc(datetime.fromisoformat(timestamp))
    except ValueError:
        return
    if _last_seen is None or ts > _last_seen:
        _last_seen = ts


async def _fetch_since(since: datetime) -> list[dict]:
    """Fetch store rows newer than `since`, oldest first, as frontend dicts."""
    from api import _build_telegram_response

    global _last_seen
    result = await store.query(TelegramQuery(start_time=since, order_descending=False, limit=5000))
    fresh = [t for t in result.telegrams if _as_utc(t.timestamp) > since]
    if fresh:
        _last_seen = _as_utc(fresh[-1].timestamp)
    return _build_telegram_response(fresh)


async def _replay_gap() -> None:
    """Broadcast telegrams persisted while the bridge was disconnected."""
    if _last_seen is None:
        return
    try:
        for telegram in await _fetch_since(_last_seen):
            await manager.broadcast(telegram)
    except Exception as err:
        logger.warning(f"Gap replay from store failed: {err}")


async def _bridge_loop() -> None:
    """Subscribe to HA's KNX telegram stream and forward it to our live feed."""
    global _connected
    backoff = 1.0
    while True:
        try:
            async with websockets.connect(HA_WS_URL, max_queue=4096) as ws:
                msg = json.loads(await ws.recv())
                if msg.get("type") == "auth_required":
                    await ws.send(json.dumps({"type": "auth", "access_token": _ha_token()}))
                    msg = json.loads(await ws.recv())
                    if msg.get("type") != "auth_ok":
                        raise RuntimeError(f"Home Assistant websocket auth failed: {msg.get('message', msg)}")

                await ws.send(json.dumps({"id": 1, "type": "knx/subscribe_telegrams"}))
                result = json.loads(await ws.recv())
                if not result.get("success"):
                    raise RuntimeError(f"knx/subscribe_telegrams failed: {result}")

                logger.info("Connected to Home Assistant websocket, subscribed to KNX telegrams")
                _connected = True
                backoff = 1.0
                # Home Assistant converts on start, and a restart drops this
                # socket — so a reconnect is when the answer is likely to change.
                if _legacy_timestamps:
                    await check_timestamp_convention()
                await _replay_gap()

                async for raw in ws:
                    msg = json.loads(raw)
                    if msg.get("type") != "event":
                        continue
                    telegram = ha_telegram_to_frontend(msg["event"])
                    _note_seen(telegram["timestamp"])
                    await manager.broadcast(telegram)
        except asyncio.CancelledError:
            _connected = False
            raise
        except Exception as err:
            _connected = False
            logger.warning(f"HA websocket bridge disconnected: {err} — retrying in {backoff:.0f}s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)


async def _poll_loop() -> None:
    """Poll the shared store for new rows and broadcast them."""
    global _connected, _last_seen
    _last_seen = datetime.now(UTC)  # history is loaded by the frontend separately
    _connected = True  # store readability was verified at startup
    while True:
        await asyncio.sleep(POLL_INTERVAL)
        try:
            for telegram in await _fetch_since(_last_seen):
                await manager.broadcast(telegram)
            _connected = True
        except asyncio.CancelledError:
            _connected = False
            raise
        except Exception as err:
            _connected = False
            logger.warning(f"Live poll of telegram store failed: {err}")


async def companion_startup() -> None:
    """Initialize the read-only store and start the configured live source."""
    global _task, _timestamp_task, _active_source

    conn_check = await store.check_connection()
    if not conn_check.ok:
        raise RuntimeError(f"Telegram store not readable: {conn_check.message}")

    await store.initialize()
    if await store.needs_migration():
        # Never migrate a database owned by another process.
        logger.warning(
            "The telegram store schema needs a migration that only its owner "
            "(Home Assistant) may run — queries may fail or miss data until then."
        )
    if await check_timestamp_convention():
        _timestamp_task = asyncio.create_task(_timestamp_watch_loop())
    logger.info("Companion mode: reading external telegram store (read-only)")

    # A KNX project file is optional here (live names come from Home Assistant),
    # but loading one enables the building view and name fallbacks for history.
    import knx_daemon

    await knx_daemon._load_project_data()

    if LIVE_SOURCE == "ha_websocket":
        if not _ha_token():
            logger.warning("No SUPERVISOR_TOKEN/HA_TOKEN available — falling back to store polling")
            _active_source = "poll"
            _task = asyncio.create_task(_poll_loop())
        else:
            _active_source = "ha_websocket"
            _task = asyncio.create_task(_bridge_loop())
    elif LIVE_SOURCE == "poll":
        _active_source = "poll"
        _task = asyncio.create_task(_poll_loop())
    elif LIVE_SOURCE == "none":
        logger.info("Live updates disabled (LIVE_SOURCE=none)")
    else:
        logger.error(f"Unknown LIVE_SOURCE '{LIVE_SOURCE}' — live updates disabled")


async def companion_shutdown() -> None:
    """Stop the live source and close the store."""
    global _task, _timestamp_task, _connected
    _connected = False
    for task in (_task, _timestamp_task):
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
    _task = _timestamp_task = None
    await store.close()
