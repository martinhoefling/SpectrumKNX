import os
import subprocess
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from xknx.telegram.address import IndividualAddress

import knx_daemon  # import global config
from database import get_db
from models import telegrams_table
from parsers import (
    format_dpt_name,
    format_value_nicely,
    get_simplified_type,
)
from ws_manager import manager

router = APIRouter()

def get_backend_version() -> str:
    """Returns the backend version from ENV or git"""
    version = os.getenv("APP_VERSION", "")
    if not version or version == "dev":
        try:
            # Fallback to git if running locally
            version = subprocess.check_output(
                ["git", "describe", "--tags", "--always"], 
                stderr=subprocess.DEVNULL,
                text=True
            ).strip()
        except Exception:
            version = "dev"
    return version

@router.get("/api/version")
async def get_version():
    """Returns the backend version from ENV or git"""
    return {"version": get_backend_version()}


def _build_telegram_response(rows) -> list:
    """Shared serializer used by both the history and delta-expanded queries."""
    response_data = []
    for row in rows:
        r = dict(row)
        if r["raw_data"]:
            r["raw_data"] = r["raw_data"].hex()

        source_addr = r.get("source_address")
        target_addr = r.get("target_address")
        type_name = r.get("telegram_type")

        # Enrich from project
        r["source_name"] = knx_daemon.project_name_map["ia"].get(source_addr)
        r["target_name"] = knx_daemon.project_name_map["ga"].get(target_addr)
        r["simplified_type"] = get_simplified_type(type_name)

        d_name, unit = format_dpt_name(r.get("dpt_main"), r.get("dpt_sub"))
        r["dpt_name"] = d_name
        r["unit"] = unit

        r["value_formatted"] = format_value_nicely(
            r.get("value_numeric") if r.get("value_numeric") is not None else r.get("value_json"),
            r.get("dpt_main"),
            r.get("dpt_sub")
        )

        r["raw_hex"] = f"0x{r['raw_data']}" if r.get("raw_data") and len(r["raw_data"]) > 1 else r.get("raw_data")

        response_data.append(r)
    return response_data


@router.get("/api/telegrams")
async def get_telegrams(
    db: AsyncSession = Depends(get_db),
    limit: int = 25000,
    offset: int = 0,
    # Multi-value: comma-separated strings
    source_address: str | None = None,
    target_address: str | None = None,
    telegram_type: str | None = None,
    dpt_main: str | None = None,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    # Time-delta context window (milliseconds, applied directionally)
    delta_before_ms: int = 0,
    delta_after_ms: int = 0,
):
    # Parse comma-separated multi-value params
    source_list = [s.strip() for s in source_address.split(",")] if source_address else []
    target_list = [s.strip() for s in target_address.split(",")] if target_address else []
    type_list = [s.strip() for s in telegram_type.split(",")] if telegram_type else []
    # type_list may contain simplified names (Write/Read/Response), map back to technical names
    type_map_reverse = {"Write": "GroupValueWrite", "Read": "GroupValueRead", "Response": "GroupValueResponse"}
    type_list_db = [type_map_reverse.get(t, t) for t in type_list]
    dpt_main_list = [int(d.strip()) for d in dpt_main.split(",") if d.strip().isdigit()] if dpt_main else []

    def apply_filters(query):
        if source_list:
            query = query.where(telegrams_table.c.source_address.in_(source_list))
        if target_list:
            query = query.where(telegrams_table.c.target_address.in_(target_list))
        if type_list_db:
            query = query.where(telegrams_table.c.telegram_type.in_(type_list_db))
        if dpt_main_list:
            query = query.where(telegrams_table.c.dpt_main.in_(dpt_main_list))
        if start_time:
            query = query.where(telegrams_table.c.timestamp >= start_time)
        if end_time:
            query = query.where(telegrams_table.c.timestamp <= end_time)
        return query

    base_query = apply_filters(select(telegrams_table))

    if delta_before_ms > 0 or delta_after_ms > 0:
        # Step 1: Get timestamps of matching rows
        ts_query = apply_filters(
            select(telegrams_table.c.timestamp)
        ).order_by(desc(telegrams_table.c.timestamp)).limit(limit)
        ts_result = await db.execute(ts_query)
        matching_timestamps = [row[0] for row in ts_result.fetchall()]

        if not matching_timestamps:
            return {"telegrams": [], "metadata": {"total_count": 0, "limit": limit, "offset": offset, "limit_reached": False}}

        before = timedelta(milliseconds=delta_before_ms)
        after = timedelta(milliseconds=delta_after_ms)
        min_ts = min(matching_timestamps) - before
        max_ts = max(matching_timestamps) + after

        # Context query: all rows in the expanded time window (coarse), then filter to ±delta of any match
        # We use the DB for the coarse range, then Python for precise per-timestamp check
        context_base = select(telegrams_table).where(
            telegrams_table.c.timestamp >= min_ts
        ).where(
            telegrams_table.c.timestamp <= max_ts
        )
        if start_time:
            context_base = context_base.where(telegrams_table.c.timestamp >= start_time)
        if end_time:
            context_base = context_base.where(telegrams_table.c.timestamp <= end_time)

        ctx_result = await db.execute(context_base.order_by(desc(telegrams_table.c.timestamp)))
        all_context_rows = ctx_result.mappings().all()

        # Precise filter: keep row if its timestamp is within ±delta of any matching timestamp
        matching_ts_set = set(t.replace(tzinfo=None) if t.tzinfo else t for t in matching_timestamps)

        def is_in_delta(row_ts):
            ts = row_ts.replace(tzinfo=None) if hasattr(row_ts, 'tzinfo') and row_ts.tzinfo else row_ts
            for mts in matching_ts_set:
                diff_ms = (ts - mts).total_seconds() * 1000
                # Row is within window if it is at most delta_before_ms before OR delta_after_ms after
                if -delta_before_ms <= diff_ms <= delta_after_ms:
                    return True
            return False

        filtered_rows = [r for r in all_context_rows if is_in_delta(r["timestamp"])]
        total_count = len(filtered_rows)
        paged_rows = filtered_rows[offset: offset + limit]

        return {
            "telegrams": _build_telegram_response(paged_rows),
            "metadata": {
                "total_count": total_count,
                "limit": limit,
                "offset": offset,
                "limit_reached": total_count > (offset + limit),
            },
        }

    # Standard path (no time-delta)
    count_query = select(func.count()).select_from(base_query.subquery())
    total_count = await db.scalar(count_query) or 0

    data_query = base_query.order_by(desc(telegrams_table.c.timestamp)).offset(offset).limit(limit)
    result = await db.execute(data_query)
    rows = result.mappings().all()

    return {
        "telegrams": _build_telegram_response(rows),
        "metadata": {
            "total_count": total_count,
            "limit": limit,
            "offset": offset,
            "limit_reached": total_count > (offset + limit),
        },
    }


@router.get("/api/filter-options")
async def get_filter_options():
    """
    Returns project-derived filter option lists for populating the FilterPanel.
    Sources and targets come from the loaded KNX project; falls back to empty lists
    if no project is loaded.
    """
    sources = []
    targets = []
    dpts = {}  # keyed by "main.sub" string to deduplicate

    if knx_daemon.global_knx_project:
        # Sources — from devices (individual addresses)
        devices = knx_daemon.global_knx_project.get("devices", {})
        for addr, data in devices.items():
            try:
                ia_str = str(IndividualAddress(addr))
            except Exception:
                ia_str = str(addr)
            sources.append({"address": ia_str, "name": data.get("name", "")})

        # Targets & DPTs — from group addresses
        gas = knx_daemon.global_knx_project.get("group_addresses", {})
        for ga_addr, data in gas.items():
            targets.append({"address": ga_addr, "name": data.get("name", "")})

            dpt_info = data.get("dpt")
            if dpt_info:
                main = dpt_info.get("main")
                sub = dpt_info.get("sub")
                if main is not None:
                    key = f"{main}.{sub:03d}" if sub is not None else str(main)
                    if key not in dpts:
                        d_name, _ = format_dpt_name(main, sub)
                        dpts[key] = {"main": main, "sub": sub, "label": d_name or key}

    # Sort sources and targets by address for consistent display
    sources.sort(key=lambda x: x["address"])
    targets.sort(key=lambda x: x["address"])
    dpt_list = sorted(dpts.values(), key=lambda x: (x["main"], x.get("sub") or 0))

    return {
        "sources": sources,
        "targets": targets,
        "types": ["Write", "Read", "Response"],
        "dpts": dpt_list,
    }


@router.get("/api/project")
async def get_project():
    """Returns logically mapped group addresses and devices from the project file"""
    if not knx_daemon.global_knx_project:
        return {"status": "no_project_loaded", "group_addresses": {}, "devices": {}}

    return {
        "status": "ok",
        "group_addresses": knx_daemon.global_knx_project.get("group_addresses", {}),
        "devices": knx_daemon.global_knx_project.get("devices", {}),
    }


@router.websocket("/ws/telegrams")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Client sends filters over WS as JSON
            try:
                filters = await websocket.receive_json()
                await manager.update_filters(websocket, filters)
            except ValueError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
