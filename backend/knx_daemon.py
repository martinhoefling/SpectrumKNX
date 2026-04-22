import asyncio
import logging
import os
from datetime import UTC, datetime

from sqlalchemy import insert
from xknx import XKNX
from xknx.io import ConnectionConfig, ConnectionType, SecureConfig
from xknx.telegram import Telegram as XknxTelegram
from xknx.telegram.address import IndividualAddress

from database import AsyncSessionLocal
from models import telegrams_table
from parsers import format_dpt_name, get_simplified_type, parse_telegram_payload
from ws_manager import manager

log_level_str = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, log_level_str, logging.INFO))
logger = logging.getLogger("knx_daemon")
logger.setLevel(getattr(logging, log_level_str, logging.INFO))

xknx_instance = None
global_knx_project = None
project_name_map = {"ga": {}, "ia": {}}

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
        new_name_map = {"ga": {}, "ia": {}}
        gas = global_knx_project.get("group_addresses", {})
        for ga, data in gas.items():
            new_name_map["ga"][ga] = data.get("name")
        
        # Individual addresses (devices)
        devices = global_knx_project.get("devices", {})
        for addr, data in devices.items():
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
                ga: data["dpt"]
                for ga, data in global_knx_project["group_addresses"].items()
                if data["dpt"] is not None
            }
            xknx_instance.group_address_dpt.set(dpt_dict)
            logger.info("Updated XKNX DPT mappings from project.")
            
        return True
    except Exception as e:
        logger.error(f"Error loading/parsing KNX project: {e}")
        return False

async def _reconnect_knx():
    """Reconnect to KNX bus with rebuilt configuration (e.g. after knxkeys change)."""
    global xknx_instance
    if xknx_instance:
        logger.info("Reconnecting to KNX bus with updated configuration...")
        try:
            await xknx_instance.stop()
        except Exception as e:
            logger.warning(f"Error stopping previous connection: {e}")
    
    connection_config = _build_connection_config()
    xknx_instance = XKNX(connection_config=connection_config)
    
    if global_knx_project:
        dpt_dict = {
            ga: data["dpt"]
            for ga, data in global_knx_project["group_addresses"].items()
            if data["dpt"] is not None
        }
        xknx_instance.group_address_dpt.set(dpt_dict)

    xknx_instance.telegram_queue.register_telegram_received_cb(telegram_received_cb)
    try:
        await xknx_instance.start()
        logger.info("KNX Daemon reconnected to bus successfully.")
    except Exception as e:
        logger.error(f"Failed to reconnect to KNX bus: {e}")

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
        
        value_numeric, value_json, raw_data, dpt_str, dpt_main, dpt_sub, unit, value_formatted, raw_hex = parse_telegram_payload(telegram, xknx_instance)
        
        # Standardize source_addr for lookup if needed, but str(IndividualAddress) is usually consistent
        source_name = project_name_map["ia"].get(source_addr)
        target_name = project_name_map["ga"].get(target_addr)
                 
        async with AsyncSessionLocal() as session:
            stmt = insert(telegrams_table).values(
                timestamp=ts,
                source_address=source_addr,
                target_address=target_addr,
                telegram_type=telegram_type_name,
                dpt=dpt_str,
                dpt_main=dpt_main,
                dpt_sub=dpt_sub,
                raw_data=raw_data,
                value_numeric=value_numeric,
                value_json=value_json
            )
            await session.execute(stmt)
            await session.commit()
            
            dpt_display_name, _ = format_dpt_name(dpt_main, dpt_sub)

            telegram_dict = {
                "timestamp": ts,
                "source_address": source_addr,
                "source_name": source_name,
                "target_address": target_addr,
                "target_name": target_name,
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
                "raw_hex": raw_hex
            }
            await manager.broadcast(telegram_dict)
            
            logger.debug(f"DB Write: src={source_addr} ({source_name}) -> dst={target_addr} ({target_name}) | type={telegram_type_name} | dpt={dpt_str} | val={value_formatted} | raw={raw_hex}")
            
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
        gateway_ip=knx_ip if connection_type not in [ConnectionType.AUTOMATIC, ConnectionType.ROUTING, ConnectionType.ROUTING_SECURE] else None,
        gateway_port=knx_port,
        local_ip=local_ip,
        individual_address=individual_address,
        route_back=route_back,
        multicast_group=multicast_group,
        multicast_port=multicast_port,
        secure_config=secure_config
    )

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

    connected = False
    if xknx_instance is not None:
        try:
            connected = xknx_instance.connection_manager.connected.is_set()
        except Exception:
            connected = False

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
            "connected": connected,
        },
    }

async def knx_startup():
    global xknx_instance, global_knx_project, project_name_map
    logger.info("Starting KNX Daemon...")
    
    connection_config = _build_connection_config()
    
    logger.info(
        f"Connecting to KNX bus: type={connection_config.connection_type.name}, "
        f"gateway={connection_config.gateway_ip if connection_config.gateway_ip else 'AUTO'}, "
        f"port={connection_config.gateway_port}, "
        f"local_ip={connection_config.local_ip if connection_config.local_ip else 'default'}, "
        f"route_back={connection_config.route_back}, "
        f"secure={'yes' if connection_config.secure_config else 'no'}"
    )
        
    await _load_project_data()
             
    xknx_instance = XKNX(connection_config=connection_config)
    
    if global_knx_project:
        dpt_dict = {
            ga: data["dpt"]
            for ga, data in global_knx_project["group_addresses"].items()
            if data["dpt"] is not None
        }
        xknx_instance.group_address_dpt.set(dpt_dict)

    xknx_instance.telegram_queue.register_telegram_received_cb(telegram_received_cb)
    try:
        await xknx_instance.start()
        logger.info("KNX Daemon connected to bus and listening.")
        # Start background file watcher (project + knxkeys)
        asyncio.create_task(_watch_files())
    except Exception as e:
        logger.error(f"Failed to connect to KNX bus: {e}")

async def knx_shutdown():
    global xknx_instance
    if xknx_instance:
        logger.info("Stopping KNX Daemon...")
        await xknx_instance.stop()
