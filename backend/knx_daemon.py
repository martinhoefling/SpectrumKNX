import os
import logging
import asyncio
from datetime import datetime, timezone
import json

from xknx import XKNX
from xknx.telegram import Telegram as XknxTelegram
from xknx.io import ConnectionConfig, ConnectionType, GatewayScanner
from xknx.dpt.dpt_10 import KNXTime
from xknx.dpt.dpt_11 import KNXDate
from xknx.dpt.dpt_19 import KNXDateTime

from sqlalchemy import insert
from database import AsyncSessionLocal
from models import telegrams_table
from ws_manager import manager
from parsers import parse_telegram_payload, format_dpt_name, get_simplified_type

log_level_str = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, log_level_str, logging.INFO))
logger = logging.getLogger("knx_daemon")
logger.setLevel(getattr(logging, log_level_str, logging.INFO))

xknx_instance = None
global_knx_project = None
project_name_map = {"ga": {}, "ia": {}}

from xknx.telegram.address import IndividualAddress

async def process_telegram_async(telegram: XknxTelegram):
    try:
        ts = datetime.now(timezone.utc)
        
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

async def knx_startup():
    global xknx_instance, global_knx_project, project_name_map
    logger.info("Starting KNX Daemon...")
    
    knx_ip = os.getenv("KNX_GATEWAY_IP", "AUTO")
    knx_port = int(os.getenv("KNX_GATEWAY_PORT", 3671))
    ets_project_file = os.getenv("KNX_PROJECT_PATH")
    ets_password = os.getenv("KNX_PASSWORD")

    connection_config = None
    if knx_ip == "AUTO" or not knx_ip:
        logger.info("Scanning for KNX gateway...")
        try:
            async with XKNX() as xknx_for_scan:
                gateways = await GatewayScanner(xknx_for_scan).scan()
                if gateways:
                   gateway = gateways[0]
                   logger.info(f"Gateway found: {gateway.ip_addr}:{gateway.port}")
                   connection_config = ConnectionConfig(gateway_ip=gateway.ip_addr, gateway_port=gateway.port)
                else:
                   logger.warning("No KNX gateway found via AUTO scan.")
        except Exception as e:
            logger.error(f"Error during AUTO scan: {e}")
    else:
        logger.info(f"Using configured KNX gateway: {knx_ip}:{knx_port}")
        connection_config = ConnectionConfig(
            connection_type=ConnectionType.TUNNELING,
            gateway_ip=knx_ip, 
            gateway_port=knx_port
        )
        
    global_knx_project = None
    project_name_map = {"ga": {}, "ia": {}}
    
    if ets_project_file and os.path.exists(ets_project_file):
        try:
             from xknxproject import XKNXProj
             xknxproj = XKNXProj(ets_project_file, password=ets_password)
             global_knx_project = xknxproj.parse()
             logger.info(f"Loaded KNX project from {ets_project_file}")
             
             # Pre-populate name lookup maps
             gas = global_knx_project.get("group_addresses", {})
             for ga, data in gas.items():
                 project_name_map["ga"][ga] = data.get("name")
             
             # Individual addresses (devices)
             devices = global_knx_project.get("devices", {})
             for addr, data in devices.items():
                 name = data.get("name")
                 if addr:
                     # Standardize to string 1.1.1 format
                     try:
                         ia_str = str(IndividualAddress(addr))
                         project_name_map["ia"][ia_str] = name
                     except:
                         project_name_map["ia"][str(addr)] = name
                     
        except Exception as e:
             logger.error(f"Error loading KNX project names: {e}")
             
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
    except Exception as e:
        logger.error(f"Failed to connect to KNX bus: {e}")

async def knx_shutdown():
    global xknx_instance
    if xknx_instance:
        logger.info("Stopping KNX Daemon...")
        await xknx_instance.stop()
