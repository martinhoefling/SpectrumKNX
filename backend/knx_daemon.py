import asyncio
import contextlib
import logging
import os
from datetime import UTC, datetime
from typing import Any

from xknx import XKNX
from xknx.core import XknxConnectionState
from xknx.dpt import DPTArray, DPTBase, DPTBinary
from xknx.io import ConnectionConfig, ConnectionType, SecureConfig
from xknx.telegram import Telegram as XknxTelegram
from xknx.telegram import TelegramDirection
from xknx.telegram.address import GroupAddress, IndividualAddress
from xknx.telegram.apci import GroupValueRead, GroupValueResponse, GroupValueWrite

from database import READ_ONLY, store
from knx_telegram_store import StoredTelegram
from parsers import format_dpt_name, get_simplified_type, parse_telegram_payload
from ws_manager import manager

log_level_str = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, log_level_str, logging.INFO))
logger = logging.getLogger("knx_daemon")
logger.setLevel(getattr(logging, log_level_str, logging.INFO))

# Sending to the bus is only meaningful in standalone mode with a live
# connection. It is on by default; set KNX_ALLOW_WRITE=false to forbid it.
ALLOW_WRITE = os.getenv("KNX_ALLOW_WRITE", "true").lower() == "true"

xknx_instance: XKNX | None = None
global_knx_project: Any | None = None
project_name_map: dict[str, dict[str, str | None]] = {"ga": {}, "ia": {}}
_connect_task: asyncio.Task | None = None
_watch_task: asyncio.Task | None = None


async def _load_project_data() -> bool:
    global global_knx_project, project_name_map, xknx_instance
    ets_project_file = os.getenv("KNX_PROJECT_PATH")
    ets_password = os.getenv("KNX_PASSWORD")

    if not ets_project_file and not ets_password:
        default_file = "/project/knx_project.knxproj"
        default_pwd = "/project/knx_project_password"
        if os.path.exists(default_file) and os.path.exists(default_pwd):
            ets_project_file = default_file
            with open(default_pwd, encoding="utf-8") as f:
                ets_password = f.read().strip()

    if not ets_project_file or not os.path.exists(ets_project_file):
        logger.warning(f"Project file not found: {ets_project_file}")
        return False

    try:
        from xknxproject import XKNXProj

        xknxproj = XKNXProj(ets_project_file, password=ets_password)
        parsed_project = xknxproj.parse()

        # Only assign to globals if parsing succeeded
        global_knx_project = parsed_project
        logger.info(f"Successfully loaded KNX project from {ets_project_file}")

        # Pre-populate name lookup maps
        new_name_map: dict[str, dict[str, str | None]] = {"ga": {}, "ia": {}}
        gas = parsed_project.get("group_addresses", {})
        for ga, data in gas.items():
            new_name_map["ga"][ga] = data.get("name")

        # Individual addresses (devices)
        devices = parsed_project.get("devices", {})
        for addr, data in devices.items():  # type: ignore[assignment]
            name = data.get("name")
            if addr:
                try:
                    ia_str = str(IndividualAddress(addr))
                    new_name_map["ia"][ia_str] = name
                except Exception:
                    new_name_map["ia"][str(addr)] = name

        project_name_map = new_name_map

        if xknx_instance:
            dpt_dict = {
                ga: data["dpt"] for ga, data in parsed_project["group_addresses"].items() if data["dpt"] is not None
            }
            xknx_instance.group_address_dpt.set(dpt_dict)  # type: ignore[arg-type]
            logger.info("Updated XKNX DPT mappings from project.")

        return True
    except Exception as e:
        logger.error(f"Error loading/parsing KNX project: {e}")
        return False


def _register_connection_state_cb(instance: XKNX) -> None:
    """Log connection state changes and push them to websocket clients."""

    def _on_state_change(state: XknxConnectionState) -> None:
        if xknx_instance is not instance:
            return  # event from a replaced instance
        logger.info(f"KNX connection state changed: {state.name}")
        asyncio.get_running_loop().create_task(
            manager.broadcast_event(
                {
                    "type": "connection_state",
                    "connected": state == XknxConnectionState.CONNECTED,
                    "state": state.name.lower(),
                    "timestamp": datetime.now(UTC),
                }
            )
        )

    instance.connection_manager.register_connection_state_changed_cb(_on_state_change)


def _create_xknx_instance() -> XKNX:
    """Create a configured XKNX instance with telegram and state callbacks registered."""
    connection_config = _build_connection_config()
    logger.info(
        f"Connecting to KNX bus: type={connection_config.connection_type.name}, "
        f"gateway={connection_config.gateway_ip if connection_config.gateway_ip else 'AUTO'}, "
        f"port={connection_config.gateway_port}, "
        f"local_ip={connection_config.local_ip if connection_config.local_ip else 'default'}, "
        f"route_back={connection_config.route_back}, "
        f"secure={'yes' if connection_config.secure_config else 'no'}"
    )
    instance = XKNX(connection_config=connection_config)

    if global_knx_project:
        dpt_dict = {
            ga: data["dpt"] for ga, data in global_knx_project["group_addresses"].items() if data["dpt"] is not None
        }
        instance.group_address_dpt.set(dpt_dict)

    # match_for_outgoing=True so telegrams we send to the bus are stored/broadcast too (#161).
    instance.telegram_queue.register_telegram_received_cb(telegram_received_cb, match_for_outgoing=True)
    _register_connection_state_cb(instance)
    return instance


async def _start_with_retry():
    """Connect to the bus, retrying with backoff until it succeeds (#166).

    Only the initial connect needs this: once connected, xknx's built-in
    auto_reconnect recovers dropped tunnels on its own.
    """
    global xknx_instance
    backoff = 1.0
    while True:
        try:
            await xknx_instance.start()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning(f"Could not connect to KNX bus: {e} - retrying in {backoff:.0f}s")
            with contextlib.suppress(Exception):
                await xknx_instance.stop()
            xknx_instance = _create_xknx_instance()
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)
        else:
            logger.info("KNX Daemon connected to bus and listening.")
            return


async def _reconnect_knx():
    """Reconnect to KNX bus with rebuilt configuration (e.g. after knxkeys change)."""
    global xknx_instance, _connect_task
    if _connect_task and not _connect_task.done():
        _connect_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _connect_task
    if xknx_instance:
        logger.info("Reconnecting to KNX bus with updated configuration...")
        try:
            await xknx_instance.stop()
        except Exception as e:
            logger.warning(f"Error stopping previous connection: {e}")

    xknx_instance = _create_xknx_instance()
    _connect_task = asyncio.create_task(_start_with_retry())


async def _watch_files():
    """Watch project and knxkeys files for changes, triggering reload/reconnect."""
    ets_project_file = os.getenv("KNX_PROJECT_PATH")
    if not ets_project_file and not os.getenv("KNX_PASSWORD"):
        ets_project_file = "/project/knx_project.knxproj"

    knxkeys_file, _ = _resolve_knxkeys_path()
    if not knxkeys_file:
        knxkeys_file = DEFAULT_KNXKEYS_FILE  # Watch the default path even if it doesn't exist yet

    proj_mtime = os.path.getmtime(ets_project_file) if ets_project_file and os.path.exists(ets_project_file) else 0
    keys_mtime = os.path.getmtime(knxkeys_file) if os.path.exists(knxkeys_file) else 0

    watched = []
    if ets_project_file:
        watched.append(ets_project_file)
    watched.append(knxkeys_file)
    logger.info(f"Starting file watcher for {watched} (interval: 60s)")

    while True:
        await asyncio.sleep(60)
        try:
            # Check project file
            if ets_project_file and os.path.exists(ets_project_file):
                current_mtime = os.path.getmtime(ets_project_file)
                if current_mtime > proj_mtime:
                    logger.info(f"Detected change in {ets_project_file}, reloading project...")
                    await _load_project_data()
                    proj_mtime = current_mtime

            # Check knxkeys file
            if os.path.exists(knxkeys_file):
                current_mtime = os.path.getmtime(knxkeys_file)
                if current_mtime > keys_mtime:
                    logger.info(f"Detected change in {knxkeys_file}, reconnecting with new credentials...")
                    await _reconnect_knx()
                    keys_mtime = current_mtime
        except Exception as e:
            logger.error(f"Error in file watcher: {e}")


async def process_telegram_async(telegram: XknxTelegram):
    try:
        ts = datetime.now(UTC)

        source_addr = str(telegram.source_address)
        target_addr = str(telegram.destination_address) if telegram.destination_address else "0/0/0"
        telegram_type_name = type(telegram.payload).__name__
        direction = "Outgoing" if telegram.direction == TelegramDirection.OUTGOING else "Incoming"

        value_numeric, value_json, raw_data, dpt_str, dpt_main, dpt_sub, unit, value_formatted, raw_hex = (
            parse_telegram_payload(telegram, xknx_instance)
        )

        # Standardize source_addr for lookup if needed
        source_name = project_name_map["ia"].get(source_addr)
        target_name = project_name_map["ga"].get(target_addr)

        # Use the library store
        await store.store(
            StoredTelegram(
                timestamp=ts,
                source=source_addr,
                destination=target_addr,
                telegramtype=telegram_type_name,
                direction=direction,
                dpt_main=dpt_main,
                dpt_sub=dpt_sub,
                payload=value_json,
                value=value_numeric,
                raw_data=raw_data.hex() if isinstance(raw_data, bytes) else raw_data,
                source_name=source_name or "",
                destination_name=target_name or "",
            )
        )

        dpt_display_name, _ = format_dpt_name(dpt_main, dpt_sub)

        telegram_dict = {
            "timestamp": ts,
            "source_address": source_addr,
            "source_name": source_name,
            "target_address": target_addr,
            "target_name": target_name,
            "direction": direction,
            "telegram_type": telegram_type_name,
            "simplified_type": get_simplified_type(telegram_type_name),
            "dpt": dpt_str,
            "dpt_main": dpt_main,
            "dpt_sub": dpt_sub,
            "dpt_name": dpt_display_name,
            "unit": unit,
            "value_numeric": value_numeric,
            "value_json": value_json,
            "value_formatted": value_formatted,
            "raw_data": raw_data.hex() if raw_data else None,
            "raw_hex": raw_hex,
        }
        await manager.broadcast(telegram_dict)

        logger.debug(
            f"DB Write: src={source_addr} ({source_name}) -> dst={target_addr} ({target_name}) | type={telegram_type_name} | dpt={dpt_str} | val={value_formatted} | raw={raw_hex}"
        )

    except Exception as e:
        logger.error(f"Error processing telegram: {e}")


def telegram_received_cb(telegram: XknxTelegram):
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(process_telegram_async(telegram))
    except Exception as e:
        logger.error(f"Failed to create task for telegram: {e}")


DEFAULT_KNXKEYS_FILE = "/project/knx_keys.knxkeys"
DEFAULT_KNXKEYS_PASSWORD_FILE = "/project/knx_keys_password"


def _resolve_knxkeys_path() -> tuple[str | None, str | None]:
    """Resolve the knxkeys file path and password, checking env vars then defaults."""
    knxkeys_file = os.getenv("KNX_KNXKEYS_FILE")
    knxkeys_password = os.getenv("KNX_KNXKEYS_PASSWORD")

    if not knxkeys_file and os.path.exists(DEFAULT_KNXKEYS_FILE):
        knxkeys_file = DEFAULT_KNXKEYS_FILE
        logger.info(f"Auto-detected knxkeys file at {DEFAULT_KNXKEYS_FILE}")
        if not knxkeys_password and os.path.exists(DEFAULT_KNXKEYS_PASSWORD_FILE):
            with open(DEFAULT_KNXKEYS_PASSWORD_FILE, encoding="utf-8") as f:
                knxkeys_password = f.read().strip()

    return knxkeys_file, knxkeys_password


def _build_secure_config() -> SecureConfig | None:
    """Build SecureConfig from environment variables, avoiding conflicting options."""
    knxkeys_file, knxkeys_password = _resolve_knxkeys_path()

    user_id = os.getenv("KNX_SECURE_USER_ID")
    user_password = os.getenv("KNX_SECURE_USER_PASSWORD")
    device_password = os.getenv("KNX_SECURE_DEVICE_PASSWORD")

    backbone_key = os.getenv("KNX_SECURE_BACKBONE_KEY")
    latency_ms = os.getenv("KNX_SECURE_LATENCY_MS")

    # Priority 1: knxkeys file (Contains both tunneling and routing credentials)
    if knxkeys_file:
        if any([user_id, user_password, device_password, backbone_key, latency_ms]):
            logger.warning("KNX_KNXKEYS_FILE is provided. Ignoring other manual KNX Secure variables.")
        return SecureConfig(
            knxkeys_file_path=knxkeys_file,
            knxkeys_password=knxkeys_password,
        )

    # Priority 2: Secure Routing (Backbone Key)
    if backbone_key:
        if any([user_id, user_password, device_password]):
            logger.warning("KNX_SECURE_BACKBONE_KEY is provided. Ignoring manual tunnel credentials.")
        return SecureConfig(
            backbone_key=backbone_key,
            latency_ms=int(latency_ms) if latency_ms else None,
        )

    # Priority 3: Manual Tunneling Credentials
    if user_id:
        return SecureConfig(
            user_id=int(user_id),
            user_password=user_password,
            device_authentication_password=device_password,
        )

    return None


def _build_connection_config() -> ConnectionConfig:
    """Build ConnectionConfig from environment variables with backward compatibility."""
    conn_type_str = os.getenv("KNX_CONNECTION_TYPE")
    knx_ip = os.getenv("KNX_GATEWAY_IP", "AUTO")
    knx_port = int(os.getenv("KNX_GATEWAY_PORT", 3671))

    # Backward compatibility logic
    if conn_type_str:
        try:
            connection_type = ConnectionType[conn_type_str.upper()]
        except KeyError:
            logger.error(f"Invalid KNX_CONNECTION_TYPE: {conn_type_str}. Falling back to AUTOMATIC.")
            connection_type = ConnectionType.AUTOMATIC
    elif knx_ip == "AUTO" or not knx_ip:
        connection_type = ConnectionType.AUTOMATIC
    else:
        connection_type = ConnectionType.TUNNELING

    individual_address = os.getenv("KNX_INDIVIDUAL_ADDRESS")
    local_ip = os.getenv("KNX_LOCAL_IP")
    route_back = os.getenv("KNX_ROUTE_BACK", "false").lower() == "true"

    multicast_group = os.getenv("KNX_MULTICAST_GROUP", "224.0.23.12")
    multicast_port = int(os.getenv("KNX_MULTICAST_PORT", 3671))

    secure_config = _build_secure_config()

    return ConnectionConfig(
        connection_type=connection_type,
        gateway_ip=knx_ip
        if connection_type not in [ConnectionType.AUTOMATIC, ConnectionType.ROUTING, ConnectionType.ROUTING_SECURE]
        else None,
        gateway_port=knx_port,
        local_ip=local_ip,
        individual_address=individual_address,
        route_back=route_back,
        multicast_group=multicast_group,
        multicast_port=multicast_port,
        secure_config=secure_config,
    )


def is_connected() -> bool:
    """Whether the KNX daemon currently holds a live connection to the bus."""
    if xknx_instance is None:
        return False
    try:
        return xknx_instance.connection_manager.connected.is_set()
    except Exception:
        return False


def write_enabled() -> bool:
    """Whether outbound telegrams (send/read) can be sent to the bus right now.

    Requires standalone mode (our own live connection), an active connection,
    and that writing has not been forbidden via KNX_ALLOW_WRITE=false.
    """
    return ALLOW_WRITE and not READ_ONLY and is_connected()


def _encode_payload(payload: Any, dpt: str | None) -> DPTArray | DPTBinary:
    """Encode a value into a KNX payload. With a DPT the value is transcoded;
    without one the payload is treated as raw bytes (int -> DPTBinary)."""
    if dpt is not None:
        transcoder = DPTBase.parse_transcoder(dpt)
        if transcoder is None:
            raise ValueError(f"Unknown DPT type: {dpt}")
        return transcoder.to_knx(payload)
    if isinstance(payload, int):
        return DPTBinary(payload)
    return DPTArray(payload)


async def send_group_value(address: str, payload: Any, dpt: str | None = None, response: bool = False) -> None:
    """Send a GroupValueWrite (or GroupValueResponse) telegram to the bus."""
    if xknx_instance is None:
        raise RuntimeError("Not connected to the KNX bus")
    encoded = _encode_payload(payload, dpt)
    telegram = XknxTelegram(
        destination_address=GroupAddress(address),
        payload=GroupValueResponse(encoded) if response else GroupValueWrite(encoded),
        source_address=xknx_instance.current_address,
    )
    await xknx_instance.telegrams.put(telegram)


async def read_group_value(address: str) -> None:
    """Send a GroupValueRead telegram; the device's response arrives via the
    normal receive path and updates the stored last value for the GA."""
    if xknx_instance is None:
        raise RuntimeError("Not connected to the KNX bus")
    telegram = XknxTelegram(
        destination_address=GroupAddress(address),
        payload=GroupValueRead(),
        source_address=xknx_instance.current_address,
    )
    await xknx_instance.telegrams.put(telegram)


def get_server_config() -> dict:
    """Return the effective server configuration for the status API, with passwords masked."""

    def mask(val: str | None) -> str | None:
        if not val:
            return None
        return "****" if len(val) <= 8 else val[:2] + "*" * (len(val) - 4) + val[-2:]

    knxkeys_file, _ = _resolve_knxkeys_path()
    ets_project_file = os.getenv("KNX_PROJECT_PATH")
    if not ets_project_file and not os.getenv("KNX_PASSWORD"):
        default_file = "/project/knx_project.knxproj"
        if os.path.exists(default_file):
            ets_project_file = default_file

    return {
        "connection": {
            "type": os.getenv("KNX_CONNECTION_TYPE", "AUTOMATIC"),
            "gateway_ip": os.getenv("KNX_GATEWAY_IP", "AUTO"),
            "gateway_port": int(os.getenv("KNX_GATEWAY_PORT", 3671)),
            "local_ip": os.getenv("KNX_LOCAL_IP"),
            "individual_address": os.getenv("KNX_INDIVIDUAL_ADDRESS"),
            "route_back": os.getenv("KNX_ROUTE_BACK", "false").lower() == "true",
            "multicast_group": os.getenv("KNX_MULTICAST_GROUP", "224.0.23.12"),
            "multicast_port": int(os.getenv("KNX_MULTICAST_PORT", 3671)),
        },
        "security": {
            "knxkeys_file": knxkeys_file,
            "knxkeys_password": mask(os.getenv("KNX_KNXKEYS_PASSWORD")),
            "user_id": os.getenv("KNX_SECURE_USER_ID"),
            "user_password": mask(os.getenv("KNX_SECURE_USER_PASSWORD")),
            "device_password": mask(os.getenv("KNX_SECURE_DEVICE_PASSWORD")),
            "backbone_key": mask(os.getenv("KNX_SECURE_BACKBONE_KEY")),
            "latency_ms": os.getenv("KNX_SECURE_LATENCY_MS"),
        },
        "files": {
            "project_file": ets_project_file,
            "project_loaded": global_knx_project is not None,
            "knxkeys_file": knxkeys_file,
            "knxkeys_found": knxkeys_file is not None and os.path.exists(knxkeys_file),
        },
        "status": {
            "connected": is_connected(),
            "write_enabled": write_enabled(),
        },
    }


async def knx_startup():
    global xknx_instance, global_knx_project, project_name_map, _connect_task, _watch_task
    logger.info("Starting KNX Daemon...")

    # Check the database connection first
    conn_check = await store.check_connection()
    if not conn_check.ok:
        logger.error(f"Database connection check failed: {conn_check.message}")
        if conn_check.detail:
            logger.error(f"Database connection details: {conn_check.detail}")
        raise RuntimeError(f"Database connection check failed: {conn_check.message}")

    logger.info("Database connection check succeeded.")

    # Initialize the Telegram Store (including schema creation/renames)
    await store.initialize()
    store.start()

    await _load_project_data()

    xknx_instance = _create_xknx_instance()
    _connect_task = asyncio.create_task(_start_with_retry())
    # Start background file watcher (project + knxkeys) even while disconnected
    _watch_task = asyncio.create_task(_watch_files())


async def knx_shutdown():
    global xknx_instance, _connect_task, _watch_task
    for task in (_connect_task, _watch_task):
        if task and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
    _connect_task = None
    _watch_task = None
    if xknx_instance:
        logger.info("Stopping KNX Daemon...")
        await xknx_instance.stop()
    await store.stop()
