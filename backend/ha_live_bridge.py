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


def _ha_token() -> str:
    return os.getenv("SUPERVISOR_TOKEN") or os.getenv("HA_TOKEN", "")


def _as_utc(dt: datetime) -> datetime:
    """The sqlite store round-trips timestamps naive; they are UTC by convention."""
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


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
                backoff = 1.0
                await _replay_gap()

                async for raw in ws:
                    msg = json.loads(raw)
                    if msg.get("type") != "event":
                        continue
                    telegram = ha_telegram_to_frontend(msg["event"])
                    _note_seen(telegram["timestamp"])
                    await manager.broadcast(telegram)
        except asyncio.CancelledError:
            raise
        except Exception as err:
            logger.warning(f"HA websocket bridge disconnected: {err} — retrying in {backoff:.0f}s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)


async def _poll_loop() -> None:
    """Poll the shared store for new rows and broadcast them."""
    global _last_seen
    _last_seen = datetime.now(UTC)  # history is loaded by the frontend separately
    while True:
        await asyncio.sleep(POLL_INTERVAL)
        try:
            for telegram in await _fetch_since(_last_seen):
                await manager.broadcast(telegram)
        except asyncio.CancelledError:
            raise
        except Exception as err:
            logger.warning(f"Live poll of telegram store failed: {err}")


async def companion_startup() -> None:
    """Initialize the read-only store and start the configured live source."""
    global _task

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
    logger.info("Companion mode: reading external telegram store (read-only)")

    # A KNX project file is optional here (live names come from Home Assistant),
    # but loading one enables the building view and name fallbacks for history.
    import knx_daemon

    await knx_daemon._load_project_data()

    if LIVE_SOURCE == "ha_websocket":
        if not _ha_token():
            logger.warning("No SUPERVISOR_TOKEN/HA_TOKEN available — falling back to store polling")
            _task = asyncio.create_task(_poll_loop())
        else:
            _task = asyncio.create_task(_bridge_loop())
    elif LIVE_SOURCE == "poll":
        _task = asyncio.create_task(_poll_loop())
    elif LIVE_SOURCE == "none":
        logger.info("Live updates disabled (LIVE_SOURCE=none)")
    else:
        logger.error(f"Unknown LIVE_SOURCE '{LIVE_SOURCE}' — live updates disabled")


async def companion_shutdown() -> None:
    """Stop the live source and close the store."""
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
    await store.close()
