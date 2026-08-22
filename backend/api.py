import asyncio
import dataclasses
import json
import logging
import os
import subprocess
import tempfile
from datetime import UTC, datetime
from typing import Any

from fastapi import (
    APIRouter,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import StreamingResponse
from knx_telegram_store import TelegramQuery
from knx_telegram_store.formats import COMMUNICATION_LOG_FOOTER, COMMUNICATION_LOG_HEADER, format_telegram_element
from pydantic import BaseModel, Field
from sqlalchemy import text
from xknx.exceptions import ConversionError, CouldNotParseAddress
from xknx.telegram.address import GroupAddress, IndividualAddress

import cyclic_send
import ha_live_bridge
import knx_daemon  # import global config
import pg_listen_bridge
import telegram_export
import telegram_import
import update_check
from database import READ_ONLY, STORE_MODE, engine, store
from parsers import (
    format_dpt_name,
    format_value_nicely,
    get_simplified_type,
)
from ws_manager import manager

logger = logging.getLogger("uvicorn.error")

router = APIRouter()

EXPORT_PAGE_SIZE = 10_000


def get_backend_version() -> str:
    """Returns the backend version from ENV or git"""
    version = os.getenv("APP_VERSION", "")
    if not version or version == "dev":
        try:
            # Fallback to git if running locally
            version = subprocess.check_output(
                ["git", "describe", "--tags", "--always"], stderr=subprocess.DEVNULL, text=True
            ).strip()
        except Exception:
            version = "dev"
    return version


@router.get("/api/version")
async def get_version():
    """Returns the backend version from ENV or git"""
    return {"version": get_backend_version()}


@router.get("/health")
@router.get("/api/health")
@router.get("/health/liveness")
@router.get("/api/health/liveness")
@router.get("/health/readiness")
@router.get("/api/health/readiness")
async def get_health(request: Request, response: Response, probe_type: str | None = None):
    """Health check endpoint for monitoring systems and Kubernetes probes.

    Checks:
    - database: reachability and store query execution.
    - knx_connection: active bus connection in standalone/postgres-readonly modes,
      or live feed status in external-readonly mode.
    - telegrams: timestamp of the last telegram processed and time elapsed.
    """
    path = request.url.path
    if path.endswith("/liveness") or probe_type == "liveness":
        check_type = "liveness"
    elif path.endswith("/readiness") or probe_type == "readiness":
        check_type = "readiness"
    else:
        check_type = "full"

    # 1. Database Check & Latest DB Telegram
    db_status = "ok"
    db_error = None
    latest_db_telegram_ts = None

    try:
        res = await store.query(TelegramQuery(limit=1, order_descending=True))
        if res.telegrams:
            t_ts = res.telegrams[0].timestamp
            if t_ts.tzinfo is None:
                t_ts = t_ts.replace(tzinfo=UTC)
            latest_db_telegram_ts = t_ts
    except Exception as e:
        db_status = "error"
        db_error = str(e)

    # 2. KNX Connection Check
    knx_status = "n/a"
    knx_connected = None

    if STORE_MODE in ("standalone", "postgres-readonly"):
        knx_connected = knx_daemon.is_connected()
        knx_status = "ok" if knx_connected else "disconnected"
    elif STORE_MODE == "external-readonly":
        feed_stat = ha_live_bridge.live_feed_status()
        knx_connected = feed_stat.get("connected", False)
        knx_status = "ok" if knx_connected else "disconnected"

    # 3. Telegram Activity Tracking
    in_mem_ts = None
    if STORE_MODE in ("standalone", "postgres-readonly"):
        in_mem_ts = knx_daemon.get_last_telegram_timestamp()
    elif STORE_MODE == "external-readonly":
        in_mem_ts = ha_live_bridge.get_last_telegram_timestamp()

    if STORE_MODE == "postgres-readonly" and in_mem_ts is None:
        in_mem_ts = pg_listen_bridge.get_last_telegram_timestamp()

    last_received_at = None
    if in_mem_ts and latest_db_telegram_ts:
        last_received_at = max(in_mem_ts, latest_db_telegram_ts)
    else:
        last_received_at = in_mem_ts or latest_db_telegram_ts

    now = datetime.now(UTC)
    seconds_since_last = None
    if last_received_at:
        if last_received_at.tzinfo is None:
            last_received_at = last_received_at.replace(tzinfo=UTC)
        seconds_since_last = round((now - last_received_at).total_seconds(), 2)

    is_live = db_status == "ok"
    is_ready = is_live and (knx_status in ("ok", "n/a"))

    overall_ok = is_live if check_type == "liveness" else is_ready

    if not overall_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {
        "status": "ok" if overall_ok else "unhealthy",
        "timestamp": now.isoformat(),
        "version": get_backend_version(),
        "store_mode": STORE_MODE,
        "checks": {
            "database": {
                "status": db_status,
                "error": db_error,
            },
            "knx_connection": {
                "status": knx_status,
                "connected": knx_connected,
            },
            "telegrams": {
                "status": "ok" if last_received_at is not None else "no_telegrams",
                "last_received_at": last_received_at.isoformat() if last_received_at else None,
                "seconds_since_last_telegram": seconds_since_last,
            },
        },
    }


@router.get("/api/update")
async def get_update():
    """Reports whether a newer release exists, with notes, for the update popup.

    Best-effort: returns update_available=False when disabled (UPDATE_CHECK) or
    when the GitHub check fails, so the UI degrades quietly.
    """
    return await update_check.get_update_info(get_backend_version())


def _build_telegram_response(telegrams: list) -> list:
    """Shared serializer used by both the history and delta-expanded queries."""
    response_data = []
    for t in telegrams:
        # Convert StoredTelegram to the dict format expected by the frontend
        r = {
            "timestamp": t.timestamp,
            "source_address": t.source,
            "target_address": t.destination,
            "direction": t.direction,
            "telegram_type": t.telegramtype,
            "dpt_main": t.dpt_main,
            "dpt_sub": t.dpt_sub,
            "value_numeric": t.value,
            "value_json": t.payload,
            "raw_data": t.raw_data if t.raw_data else None,
            "source_name": t.source_name or knx_daemon.project_name_map["ia"].get(t.source),
            "target_name": t.destination_name or knx_daemon.project_name_map["ga"].get(t.destination),
        }

        r["simplified_type"] = get_simplified_type(r["telegram_type"])

        d_name, unit = format_dpt_name(r.get("dpt_main"), r.get("dpt_sub"))
        r["dpt_name"] = d_name
        r["unit"] = unit

        display_value = r.get("value_numeric")
        if display_value is None:
            vj = r.get("value_json")
            # Unwrap legacy {"value": x} storage format
            if isinstance(vj, dict) and list(vj.keys()) == ["value"]:
                vj = vj["value"]
            display_value = vj
        r["value_formatted"] = format_value_nicely(display_value, r.get("dpt_main"), r.get("dpt_sub"))

        r["raw_hex"] = f"0x{r['raw_data']}" if r.get("raw_data") and len(r["raw_data"]) > 1 else r.get("raw_data")

        response_data.append(r)
    return response_data


@router.get("/api/telegrams")
async def get_telegrams(
    limit: int = 100000,
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

    # Map simplified types to technical names
    type_map_reverse = {"Write": "GroupValueWrite", "Read": "GroupValueRead", "Response": "GroupValueResponse"}
    type_list_db = [type_map_reverse.get(t, t) for t in type_list]

    # DPT entries are "main.sub" for one subtype or a bare "main" for all
    # subtypes of a major DPT (#180)
    dpt_pairs: list[tuple[int, int | None]] = []
    if dpt_main:
        for entry in dpt_main.split(","):
            main_str, sep, sub_str = entry.strip().partition(".")
            if main_str.isdigit() and (not sep or sub_str.isdigit()):
                dpt_pairs.append((int(main_str), int(sub_str) if sep else None))

    # Build the library query
    query = TelegramQuery(
        sources=source_list,
        destinations=target_list,
        telegram_types=type_list_db,
        dpts=dpt_pairs,
        start_time=start_time,
        end_time=end_time,
        delta_before_ms=delta_before_ms,
        delta_after_ms=delta_after_ms,
        limit=limit,
        offset=offset,
        order_descending=True,
    )

    result = await store.query(query, flush_first=True)

    return {
        "telegrams": _build_telegram_response(result.telegrams),
        "metadata": {
            "total_count": result.total_count,
            "limit": limit,
            "offset": offset,
            "limit_reached": result.limit_reached,
        },
    }


@router.get("/api/telegrams/last")
async def get_last_telegrams(target_address: str | None = None):
    """Returns the most recent telegram per group address (#153).

    Unlike /api/telegrams this is an aggregation: one entry per destination GA,
    so quiet addresses are included instead of falling off a recency-limited
    list. Optionally filtered to a comma-separated set of group addresses.
    """
    telegrams = await store.get_last_unique_telegrams()
    if target_address:
        wanted = {t.strip() for t in target_address.split(",") if t.strip()}
        telegrams = [t for t in telegrams if t.destination in wanted]
    return {"telegrams": _build_telegram_response(telegrams)}


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
            dpt_info = data.get("dpt")
            main = dpt_info.get("main") if dpt_info else None
            sub = dpt_info.get("sub") if dpt_info else None
            targets.append({"address": ga_addr, "name": data.get("name", ""), "main": main, "sub": sub})

            if main is not None:
                key = f"{main}.{sub:03d}" if sub is not None else str(main)
                if key not in dpts:
                    d_name, _ = format_dpt_name(main, sub)
                    dpts[key] = {"main": main, "sub": sub, "label": d_name or key}

    # Sort sources and targets by address for consistent display
    sources.sort(key=lambda x: x["address"])
    targets.sort(key=lambda x: x["address"])
    dpt_list = sorted(dpts.values(), key=lambda x: (x["main"], x.get("sub") or 0))

    # Build group name maps from project topology
    # ga_group_names: {"0": "Zentral", "0/1": "Wetter", ...}
    # pa_line_names:  {"1": "Area 1", "1.0": "Line EG", ...}
    ga_group_names: dict[str, str] = {}
    pa_line_names: dict[str, str] = {}

    if knx_daemon.global_knx_project:

        def _collect_group_ranges(ranges: dict, depth: int = 0) -> None:
            for key, data in ranges.items():
                name = data.get("name", "")
                if name:
                    ga_group_names[str(key)] = name
                nested = data.get("group_ranges", {})
                if nested:
                    _collect_group_ranges(nested, depth + 1)

        _collect_group_ranges(knx_daemon.global_knx_project.get("group_ranges", {}))

        for area_key, area_data in knx_daemon.global_knx_project.get("topology", {}).items():
            area_name = area_data.get("name", "")
            if area_name:
                pa_line_names[str(area_key)] = area_name
            for line_key, line_data in area_data.get("lines", {}).items():
                line_name = line_data.get("name", "")
                line_addr = f"{area_key}.{line_key}"
                if line_name:
                    pa_line_names[line_addr] = line_name

    return {
        "sources": sources,
        "targets": targets,
        "types": ["Write", "Read", "Response"],
        "dpts": dpt_list,
        "ga_group_names": ga_group_names,
        "pa_line_names": pa_line_names,
    }


def _aggregate_statistics(
    rows: list,
    ga_name_map: dict[str, str | None],
    pa_name_map: dict[str, str | None],
) -> dict:
    """Aggregate (source, destination, count) rows into GA/PA totals.

    Each GA entry carries a ``children`` list of the source PAs that addressed
    it (with counts), and each PA entry carries the destination GAs it sent to,
    so the frontend can drill down from either side. Input rows are expected to
    already be grouped by (source, destination) — i.e. each pair appears once.
    """
    ga_counts: dict[str, int] = {}
    pa_counts: dict[str, int] = {}
    ga_sources: dict[str, dict[str, int]] = {}
    pa_dests: dict[str, dict[str, int]] = {}
    for source, destination, cnt in rows:
        ga_counts[destination] = ga_counts.get(destination, 0) + cnt
        pa_counts[source] = pa_counts.get(source, 0) + cnt
        ga_sources.setdefault(destination, {})[source] = ga_sources.setdefault(destination, {}).get(source, 0) + cnt
        pa_dests.setdefault(source, {})[destination] = pa_dests.setdefault(source, {}).get(destination, 0) + cnt

    def _children(counts: dict[str, int], name_map: dict[str, str | None]) -> list:
        return sorted(
            [{"address": addr, "name": name_map.get(addr) or "", "count": cnt} for addr, cnt in counts.items()],
            key=lambda x: x["count"],
            reverse=True,
        )

    by_ga = sorted(
        [
            {
                "address": addr,
                "name": ga_name_map.get(addr) or "",
                "count": cnt,
                "children": _children(ga_sources.get(addr, {}), pa_name_map),
            }
            for addr, cnt in ga_counts.items()
        ],
        key=lambda x: x["count"],
        reverse=True,
    )
    by_pa = sorted(
        [
            {
                "address": addr,
                "name": pa_name_map.get(addr) or "",
                "count": cnt,
                "children": _children(pa_dests.get(addr, {}), ga_name_map),
            }
            for addr, cnt in pa_counts.items()
        ],
        key=lambda x: x["count"],
        reverse=True,
    )

    return {"total": sum(ga_counts.values()), "by_ga": by_ga, "by_pa": by_pa}


@router.get("/api/statistics")
async def get_statistics():
    """Returns telegram counts grouped by group address and physical address."""
    sql = text("""
        SELECT s_lk.value AS source_address, d_lk.value AS destination, COUNT(*) AS cnt
        FROM telegrams t
        JOIN string_lookup s_lk ON t.source_id = s_lk.id
        JOIN string_lookup d_lk ON t.destination_id = d_lk.id
        GROUP BY s_lk.value, d_lk.value
    """)

    async with engine.connect() as conn:
        result = await conn.execute(sql)
        rows = result.fetchall()

    ga_name_map: dict[str, str | None] = {}
    pa_name_map: dict[str, str | None] = {}
    if knx_daemon.global_knx_project:
        ga_name_map = knx_daemon.project_name_map.get("ga", {})
        pa_name_map = knx_daemon.project_name_map.get("ia", {})

    return _aggregate_statistics(rows, ga_name_map, pa_name_map)


@router.get("/api/database/info")
async def get_database_info():
    """Returns database stats (size, count, covered time range) and maintenance capabilities."""
    stats = await store.get_stats()
    caps = store.capabilities
    return {
        "backend": stats.backend,
        "telegram_count": stats.telegram_count,
        "oldest_timestamp": stats.oldest_timestamp,
        "newest_timestamp": stats.newest_timestamp,
        "size_bytes": stats.size_bytes,
        "retention_days": stats.retention_days,
        "supports_size_stats": caps.supports_size_stats,
        "supports_optimize": caps.supports_optimize,
        "read_only": caps.read_only,
    }


class PurgeRequest(BaseModel):
    older_than: datetime | None = None
    purge_all: bool = False
    dry_run: bool = False


class KnxSendRequest(BaseModel):
    address: str
    # Decoded value for the given DPT (e.g. True, 50, 21.5), or raw bytes when no DPT is given.
    payload: Any
    dpt: str | None = None
    response: bool = False


class KnxReadRequest(BaseModel):
    address: str


def _require_bus_write() -> None:
    """Guard for the send/read endpoints: a live bus connection and writing not forbidden.

    external-readonly never starts a daemon, so is_connected() is always
    False there without needing a separate check; postgres-readonly's daemon
    can be connected and write, even though its telegram store is read-only.
    """
    if not knx_daemon.ALLOW_WRITE:
        raise HTTPException(status_code=403, detail="Sending to the KNX bus is disabled")
    if not knx_daemon.is_connected():
        raise HTTPException(status_code=409, detail="Not connected to the KNX bus")


@router.post("/api/knx/send")
async def knx_send(request: KnxSendRequest):
    """Send a GroupValueWrite/Response telegram to the KNX bus (standalone mode only)."""
    _require_bus_write()
    try:
        await knx_daemon.send_group_value(request.address, request.payload, request.dpt, request.response)
    except (ConversionError, CouldNotParseAddress, ValueError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    return {"status": "sent"}


@router.post("/api/knx/read")
async def knx_read(request: KnxReadRequest):
    """Send a GroupValueRead telegram; the response updates the GA's last value."""
    _require_bus_write()
    try:
        await knx_daemon.read_group_value(request.address)
    except (CouldNotParseAddress, ValueError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    return {"status": "sent"}


class KnxScheduledSendRequest(BaseModel):
    address: str
    payload: Any
    dpt: str | None = None
    response: bool = False
    # One-shot delay before the (first) send.
    delay_seconds: float = Field(0, ge=0, le=86400)
    # Repeat interval; 1s floor keeps a runaway job from flooding the bus.
    interval_seconds: float | None = Field(None, ge=1.0, le=86400)


@router.post("/api/knx/send/scheduled")
async def knx_send_scheduled(request: KnxScheduledSendRequest):
    """Start a delayed and/or cyclic send job (#167). One job at a time."""
    _require_bus_write()
    if request.delay_seconds == 0 and request.interval_seconds is None:
        raise HTTPException(status_code=400, detail="Set a delay or interval; use /api/knx/send for immediate sends")
    # Validate address and payload up front so the background job can't fail on bad input
    try:
        GroupAddress(request.address)
        knx_daemon._encode_payload(request.payload, request.dpt)
    except (ConversionError, CouldNotParseAddress, ValueError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    try:
        job = cyclic_send.start_send(
            request.address,
            request.payload,
            request.dpt,
            request.response,
            request.delay_seconds,
            request.interval_seconds,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return job.to_dict()


@router.get("/api/knx/send/scheduled/status")
async def get_scheduled_send_status():
    """Returns the state of the current/last scheduled send job."""
    job = cyclic_send.current_job
    return job.to_dict() if job else {"state": "idle"}


@router.post("/api/knx/send/scheduled/cancel")
async def cancel_scheduled_send():
    """Cancels the active scheduled send job."""
    if not cyclic_send.cancel_send():
        raise HTTPException(status_code=404, detail="No scheduled send is active")
    return {"status": "ok"}


@router.post("/api/database/purge")
async def purge_database(request: PurgeRequest):
    """Deletes telegrams older than a cutoff (or all of them).

    With dry_run=true, only returns how many telegrams would be deleted so the
    frontend can ask for confirmation first.
    """
    if store.capabilities.read_only:
        raise HTTPException(status_code=403, detail="Store is read-only; its owner manages retention and cleanup")

    if request.purge_all:
        count = (await store.get_stats()).telegram_count
        if not request.dry_run:
            await store.clear()
        return {"deleted": count, "dry_run": request.dry_run}

    if request.older_than is None:
        raise HTTPException(status_code=400, detail="Either older_than or purge_all must be given")

    cutoff = request.older_than
    if cutoff.tzinfo is None:
        cutoff = cutoff.replace(tzinfo=UTC)

    deleted = await store.evict_older_than(cutoff, dry_run=request.dry_run)
    return {"deleted": deleted, "dry_run": request.dry_run}


@router.post("/api/database/optimize")
async def optimize_database():
    """Reclaims disk space freed by deletions (VACUUM). May take a while on large databases."""
    if store.capabilities.read_only:
        raise HTTPException(status_code=403, detail="Store is read-only; its owner manages retention and cleanup")
    if not store.capabilities.supports_optimize:
        raise HTTPException(status_code=400, detail="Backend does not support optimization")

    size_before = (await store.get_stats()).size_bytes
    await store.optimize()
    size_after = (await store.get_stats()).size_bytes
    return {"size_bytes_before": size_before, "size_bytes_after": size_after}


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


def _build_ko(co: dict, gas: dict) -> dict:
    """Serialize a communication object (KO) with its connected group addresses."""
    group_addresses = []
    for ga_addr in co.get("group_address_links") or []:
        ga_master = gas.get(ga_addr) or {}
        # Each GA's own DPT, resolved from the project — may differ from the KO's
        # own DPT declaration even within the same main category (#307).
        ga_dpt = ga_master.get("dpt")
        group_addresses.append(
            {
                "address": ga_addr,
                "name": ga_master.get("name", ""),
                "dpt": (
                    {
                        "main": ga_dpt.get("main"),
                        "sub": ga_dpt.get("sub"),
                        "name": format_dpt_name(ga_dpt.get("main"), ga_dpt.get("sub"))[0],
                    }
                    if ga_dpt
                    else None
                ),
            }
        )
    # Resolve each DPT's descriptive name (e.g. "5.001 - Percent") so the building
    # view can show it like the group monitor does, not just the raw numbers.
    dpts = [
        {"main": d.get("main"), "sub": d.get("sub"), "name": format_dpt_name(d.get("main"), d.get("sub"))[0]}
        for d in co.get("dpts") or []
    ]
    return {
        "number": co.get("number"),
        "name": co.get("name", ""),
        "text": co.get("text", ""),
        "function_text": co.get("function_text", ""),
        "dpts": dpts,
        "flags": co.get("flags") or {},
        "group_addresses": group_addresses,
    }


def _build_device(addr: str, device: dict, cos: dict, gas: dict) -> dict:
    """Serialize a device with its KOs grouped by channel (connected KOs only)."""
    channels = device.get("channels") or {}
    # Map each communication object id to the channel that owns it.
    channel_of: dict[str, str] = {}
    for ch_id, ch in channels.items():
        for cid in ch.get("communication_object_ids") or []:
            channel_of[cid] = ch_id

    chan_groups: list[dict] = []
    chan_index: dict[str, dict] = {}
    unassigned: list[dict] = []

    for cid in device.get("communication_object_ids") or []:
        co = cos.get(cid)
        # Only surface KOs that are linked to at least one group address — these
        # are the ones that can be filtered on and have last-seen values.
        if not co or not co.get("group_address_links"):
            continue
        ko = _build_ko(co, gas)
        ch_id = channel_of.get(cid)
        if ch_id is not None:
            grp = chan_index.get(ch_id)
            if grp is None:
                grp = {"id": ch_id, "name": channels[ch_id].get("name", ""), "kos": []}
                chan_index[ch_id] = grp
                chan_groups.append(grp)
            grp["kos"].append(ko)
        else:
            unassigned.append(ko)

    try:
        ia = str(IndividualAddress(addr))
    except Exception:
        ia = str(addr)

    return {
        "address": ia,
        "name": device.get("name", ""),
        "manufacturer": device.get("manufacturer_name", ""),
        "hardware": device.get("hardware_name", ""),
        "channels": chan_groups,
        "kos": unassigned,
    }


def _build_space(space: dict, devices: dict, cos: dict, gas: dict, functions_dict: dict) -> dict:
    """Recursively serialize a building space with nested spaces, devices, and functions."""
    child_spaces = [
        _build_space(sub, devices, cos, gas, functions_dict) for sub in (space.get("spaces") or {}).values()
    ]
    device_nodes = [
        _build_device(dev_addr, devices[dev_addr], cos, gas)
        for dev_addr in space.get("devices") or []
        if dev_addr in devices
    ]

    space_functions = []
    for func_id in space.get("functions") or []:
        func = functions_dict.get(func_id)
        if func:
            group_addresses = []
            for ga_addr, ga_ref in func.get("group_addresses", {}).items():
                ga_master = gas.get(ga_addr) or {}
                dpt = ga_master.get("dpt")
                # The function ref's own name is empty and its "role" is an opaque
                # UUID; resolve the real GA name + DPT from the project (#295).
                group_addresses.append(
                    {
                        "address": ga_addr,
                        "name": ga_master.get("name") or ga_ref.get("name", ""),
                        "dpts": (
                            [
                                {
                                    "main": dpt.get("main"),
                                    "sub": dpt.get("sub"),
                                    "name": format_dpt_name(dpt.get("main"), dpt.get("sub"))[0],
                                }
                            ]
                            if dpt
                            else []
                        ),
                    }
                )
            space_functions.append(
                {
                    "id": func_id,
                    "name": func.get("name", ""),
                    "type": func.get("function_type", ""),
                    # ETS function-type name (e.g. FT-1 -> "Licht schalten"), resolved by
                    # xknxproject from ETS master data (#307).
                    "type_name": func.get("usage_text", ""),
                    "group_addresses": group_addresses,
                }
            )

    return {
        "kind": "space",
        "type": space.get("type", ""),
        "name": space.get("name", ""),
        "spaces": child_spaces,
        "devices": device_nodes,
        "functions": space_functions,
    }


@router.get("/api/building")
async def get_building():
    """Returns the building structure tree (locations → devices → channels → KOs).

    Mirrors the building view of the ETS project: spaces are nested, each device
    carries its connected communication objects grouped by channel, and each KO
    lists the group addresses it is linked to.
    """
    if not knx_daemon.global_knx_project:
        return {"status": "no_project_loaded", "tree": [], "unassigned_devices": []}

    proj = knx_daemon.global_knx_project
    devices = proj.get("devices", {})
    cos = proj.get("communication_objects", {})
    gas = proj.get("group_addresses", {})
    locations = proj.get("locations", {})
    functions_dict = proj.get("functions", {})

    tree = [_build_space(space, devices, cos, gas, functions_dict) for space in locations.values()]

    placed: set[str] = set()

    def _collect_placed(space: dict) -> None:
        for dev_addr in space.get("devices") or []:
            placed.add(dev_addr)
        for sub in (space.get("spaces") or {}).values():
            _collect_placed(sub)

    for space in locations.values():
        _collect_placed(space)

    unassigned_devices = [_build_device(addr, dev, cos, gas) for addr, dev in devices.items() if addr not in placed]

    return {"status": "ok", "tree": tree, "unassigned_devices": unassigned_devices}


def _project_upload_path() -> tuple[str, str | None]:
    """Returns (project_file_path, password_file_path_or_None) for uploads.

    When KNX_PROJECT_PATH is set we write directly to that path and store the
    password next to it. Otherwise we fall back to the default /project volume.
    The password file is None when KNX_PASSWORD is set via env (caller should
    not overwrite it).
    """
    env_proj = os.getenv("KNX_PROJECT_PATH")
    env_pwd = os.getenv("KNX_PASSWORD")

    if env_proj:
        proj_file = env_proj
        # Only write a password sidecar when no env password is configured
        pwd_file = os.path.splitext(env_proj)[0] + "_password" if not env_pwd else None
    else:
        proj_file = os.path.join("/project", "knx_project.knxproj")
        pwd_file = os.path.join("/project", "knx_project_password")

    return proj_file, pwd_file


def _project_meta_path() -> str:
    """Sidecar holding the original upload filename and import time (#425).

    Uploads are all written to the same fixed path, so the name the user
    actually chose — which many people use for versioning — is otherwise lost.
    Sits next to the project file like the password sidecar.
    """
    proj_file, _ = _project_upload_path()
    return os.path.splitext(proj_file)[0] + "_meta.json"


def _project_upload_writable() -> bool:
    """Returns True if the upload destination is writable."""
    proj_file, _ = _project_upload_path()
    target = proj_file if os.path.exists(proj_file) else os.path.dirname(proj_file)
    return os.access(target, os.W_OK)


@router.get("/api/project/status")
async def get_project_status():
    """Returns the status of the project upload feature"""
    project_loaded = knx_daemon.global_knx_project is not None
    upload_writable = _project_upload_writable()
    # In companion mode the project is optional — live telegram names come from
    # Home Assistant — so never block the UI behind the upload wizard.
    upload_required = not project_loaded and not READ_ONLY

    return {
        "upload_feature_active": True,
        "upload_writable": upload_writable,
        "project_loaded": project_loaded,
        "upload_required": upload_required,
    }


@router.post("/api/project/upload")
async def upload_project(file: UploadFile = File(...), password: str = Form("")):
    """Uploads a KNX project file and password, saving them to the configured path"""
    if not file.filename or not file.filename.endswith(".knxproj"):
        raise HTTPException(status_code=400, detail="File must be a .knxproj file")

    proj_file, pwd_file = _project_upload_path()

    content = await file.read()

    def save_project_files():
        os.makedirs(os.path.dirname(proj_file), exist_ok=True)
        with open(proj_file, "wb") as f:
            f.write(content)
        if pwd_file:
            with open(pwd_file, "w", encoding="utf-8") as f:
                f.write(password)

    try:
        await asyncio.to_thread(save_project_files)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=f"Cannot write project file: {e}") from e

    # Trigger reload
    success = await knx_daemon._load_project_data()

    meta_file = _project_meta_path()
    if not success:
        if os.path.exists(proj_file) and not os.getenv("KNX_PROJECT_PATH"):
            os.remove(proj_file)
        if pwd_file and os.path.exists(pwd_file):
            os.remove(pwd_file)
        # A stale sidecar would otherwise describe a project that is no longer there.
        if os.path.exists(meta_file):
            os.remove(meta_file)
        raise HTTPException(status_code=400, detail="Failed to load project. Incorrect password or invalid file.")

    # Record what the user uploaded, now that we know it parses (#425). Never
    # fatal: the project is loaded either way, this only feeds the settings UI.
    def save_meta():
        with open(meta_file, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "original_filename": file.filename,
                    "imported_at": datetime.now(UTC).isoformat(),
                },
                f,
            )

    try:
        await asyncio.to_thread(save_meta)
    except OSError as e:
        logger.warning("Could not write project metadata sidecar: %s", e)

    return {"status": "ok", "message": "Project loaded successfully"}


@router.get("/api/server/config")
async def get_server_config():
    """Returns the effective server configuration with passwords masked"""
    return knx_daemon.get_server_config()


@router.get("/api/knxkeys/status")
async def get_knxkeys_status():
    """Returns the status of the knxkeys upload feature"""
    env_knxkeys = os.getenv("KNX_KNXKEYS_FILE")

    upload_feature_active = not env_knxkeys
    knxkeys_found = False

    if env_knxkeys:
        knxkeys_found = os.path.exists(env_knxkeys)
    else:
        knxkeys_found = os.path.exists(knx_daemon.DEFAULT_KNXKEYS_FILE)

    return {
        "upload_feature_active": upload_feature_active,
        "knxkeys_found": knxkeys_found,
    }


@router.post("/api/knxkeys/upload")
async def upload_knxkeys(file: UploadFile = File(...), password: str = Form("")):
    """Uploads a .knxkeys file and password, saving them to the default volume and reconnecting"""
    env_knxkeys = os.getenv("KNX_KNXKEYS_FILE")

    if env_knxkeys:
        raise HTTPException(
            status_code=400, detail="Upload feature is disabled because KNX_KNXKEYS_FILE environment variable is set."
        )

    if not file.filename or not file.filename.endswith(".knxkeys"):
        raise HTTPException(status_code=400, detail="File must be a .knxkeys file")

    default_dir = "/project"
    content = await file.read()

    def save_knxkeys_files():
        os.makedirs(default_dir, exist_ok=True)
        with open(knx_daemon.DEFAULT_KNXKEYS_FILE, "wb") as f:
            f.write(content)

        if password:
            with open(knx_daemon.DEFAULT_KNXKEYS_PASSWORD_FILE, "w", encoding="utf-8") as f:
                f.write(password)

    try:
        await asyncio.to_thread(save_knxkeys_files)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=f"Cannot write KNX keys file: {e}") from e

    # Trigger reconnection with new credentials
    await knx_daemon._reconnect_knx()

    return {"status": "ok", "message": "KNX keys file uploaded. Reconnecting to bus..."}


# ── Telegram log import / export (see DESIGN_IMPORT_EXPORT.md) ──────────────


@router.get("/api/import/status")
async def get_import_status():
    """Returns the state of the current/last telegram log import job."""
    job = telegram_import.current_job
    state = job.to_dict() if job else {"state": "idle"}
    return state | {"read_only": READ_ONLY}


@router.post("/api/import")
async def start_telegram_import(file: UploadFile = File(...)):
    """Uploads a telegram log (.xml or .zip of .xml) and starts a background import."""
    if READ_ONLY:
        raise HTTPException(status_code=403, detail="Import is unavailable in read-only companion mode")
    if not file.filename or not file.filename.lower().endswith((".xml", ".zip")):
        raise HTTPException(status_code=400, detail="File must be a .xml or .zip telegram log")

    suffix = os.path.splitext(file.filename)[1].lower()
    upload = tempfile.NamedTemporaryFile(delete=False, prefix="knx-import-", suffix=suffix)
    try:
        while chunk := await file.read(1024 * 1024):
            upload.write(chunk)
    finally:
        upload.close()

    try:
        job = telegram_import.start_import(store, upload.name, file.filename)
    except RuntimeError as e:
        os.unlink(upload.name)
        raise HTTPException(status_code=409, detail=str(e)) from e
    return job.to_dict()


@router.post("/api/import/cancel")
async def cancel_telegram_import():
    """Requests cancellation of the running import job."""
    if not telegram_import.cancel_import():
        raise HTTPException(status_code=404, detail="No import is running")
    return {"status": "ok"}


@router.get("/api/export")
async def export_telegrams(
    source_address: str | None = None,
    target_address: str | None = None,
    telegram_type: str | None = None,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    limit: int = 500_000,
):
    """Streams matching telegrams as an ETS6-compatible CommunicationLog XML file."""
    type_map_reverse = {"Write": "GroupValueWrite", "Read": "GroupValueRead", "Response": "GroupValueResponse"}
    query = TelegramQuery(
        sources=[s.strip() for s in source_address.split(",")] if source_address else [],
        destinations=[s.strip() for s in target_address.split(",")] if target_address else [],
        telegram_types=[type_map_reverse.get(t.strip(), t.strip()) for t in telegram_type.split(",")]
        if telegram_type
        else [],
        start_time=start_time,
        end_time=end_time,
        limit=min(EXPORT_PAGE_SIZE, limit),
        order_descending=False,
    )

    async def generate():
        yield COMMUNICATION_LOG_HEADER
        offset = 0
        while offset < limit:
            page = dataclasses.replace(query, limit=min(EXPORT_PAGE_SIZE, limit - offset), offset=offset)
            result = await store.query(page, flush_first=True)
            chunk = "".join(
                format_telegram_element(record, connection_name="Spectrum KNX Export")
                for telegram in result.telegrams
                if (record := telegram_export.stored_to_record(telegram)) is not None
            )
            if chunk:
                yield chunk
            if not result.limit_reached or len(result.telegrams) == 0:
                break
            offset += len(result.telegrams)
        yield COMMUNICATION_LOG_FOOTER

    filename = f"spectrum-knx-export-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}.xml"
    return StreamingResponse(
        generate(),
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.websocket("/ws/telegrams")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    if STORE_MODE != "external-readonly":
        # A daemon (and thus a bus connection state) exists in both standalone
        # and postgres-readonly mode. Initial state so (re)connecting clients
        # don't have to wait for a change.
        connected = knx_daemon.is_connected()
        await websocket.send_json(
            {
                "type": "connection_state",
                "connected": connected,
                "state": "connected" if connected else "disconnected",
                "timestamp": datetime.now(UTC).isoformat(),
            }
        )
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
