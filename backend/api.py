import os
import subprocess
from datetime import UTC, datetime

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy import text
from xknx.telegram.address import IndividualAddress

import knx_daemon  # import global config
from database import engine, store
from knx_telegram_store import TelegramQuery
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
                ["git", "describe", "--tags", "--always"], stderr=subprocess.DEVNULL, text=True
            ).strip()
        except Exception:
            version = "dev"
    return version


@router.get("/api/version")
async def get_version():
    """Returns the backend version from ENV or git"""
    return {"version": get_backend_version()}


def _build_telegram_response(telegrams: list) -> list:
    """Shared serializer used by both the history and delta-expanded queries."""
    response_data = []
    for t in telegrams:
        # Convert StoredTelegram to the dict format expected by the frontend
        r = {
            "timestamp": t.timestamp,
            "source_address": t.source,
            "target_address": t.destination,
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

    # Map simplified types to technical names
    type_map_reverse = {"Write": "GroupValueWrite", "Read": "GroupValueRead", "Response": "GroupValueResponse"}
    type_list_db = [type_map_reverse.get(t, t) for t in type_list]
    dpt_main_list = [int(d.strip()) for d in dpt_main.split(",") if d.strip().isdigit()] if dpt_main else []

    # Build the library query
    query = TelegramQuery(
        sources=source_list,
        destinations=target_list,
        telegram_types=type_list_db,
        dpt_mains=dpt_main_list,
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
    ga_name_map: dict[str, str],
    pa_name_map: dict[str, str],
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

    def _children(counts: dict[str, int], name_map: dict[str, str]) -> list:
        return sorted(
            [{"address": addr, "name": name_map.get(addr, ""), "count": cnt} for addr, cnt in counts.items()],
            key=lambda x: x["count"],
            reverse=True,
        )

    by_ga = sorted(
        [
            {
                "address": addr,
                "name": ga_name_map.get(addr, ""),
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
                "name": pa_name_map.get(addr, ""),
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

    ga_name_map: dict[str, str] = {}
    pa_name_map: dict[str, str] = {}
    if knx_daemon.global_knx_project:
        for addr, data in knx_daemon.global_knx_project.get("group_addresses", {}).items():
            ga_name_map[addr] = data.get("name", "")
        for addr, data in knx_daemon.global_knx_project.get("devices", {}).items():
            try:
                ia_str = str(IndividualAddress(addr))
            except Exception:
                ia_str = str(addr)
            pa_name_map[ia_str] = data.get("name", "")

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
    }


class PurgeRequest(BaseModel):
    older_than: datetime | None = None
    purge_all: bool = False
    dry_run: bool = False


@router.post("/api/database/purge")
async def purge_database(request: PurgeRequest):
    """Deletes telegrams older than a cutoff (or all of them).

    With dry_run=true, only returns how many telegrams would be deleted so the
    frontend can ask for confirmation first.
    """
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
    group_addresses = [
        {"address": ga, "name": gas.get(ga, {}).get("name", "")} for ga in co.get("group_address_links") or []
    ]
    return {
        "number": co.get("number"),
        "name": co.get("name", ""),
        "text": co.get("text", ""),
        "function_text": co.get("function_text", ""),
        "dpts": co.get("dpts") or [],
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


def _build_space(space: dict, devices: dict, cos: dict, gas: dict) -> dict:
    """Recursively serialize a building space with nested spaces and devices."""
    child_spaces = [_build_space(sub, devices, cos, gas) for sub in (space.get("spaces") or {}).values()]
    device_nodes = [
        _build_device(dev_addr, devices[dev_addr], cos, gas)
        for dev_addr in space.get("devices") or []
        if dev_addr in devices
    ]
    return {
        "kind": "space",
        "type": space.get("type", ""),
        "name": space.get("name", ""),
        "spaces": child_spaces,
        "devices": device_nodes,
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

    tree = [_build_space(space, devices, cos, gas) for space in locations.values()]

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
    upload_required = not project_loaded

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

    os.makedirs(os.path.dirname(proj_file), exist_ok=True)

    content = await file.read()

    try:
        with open(proj_file, "wb") as f:
            f.write(content)
        if pwd_file:
            with open(pwd_file, "w", encoding="utf-8") as f:
                f.write(password)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=f"Cannot write project file: {e}") from e

    # Trigger reload
    success = await knx_daemon._load_project_data()

    if not success:
        if os.path.exists(proj_file) and not os.getenv("KNX_PROJECT_PATH"):
            os.remove(proj_file)
        if pwd_file and os.path.exists(pwd_file):
            os.remove(pwd_file)
        raise HTTPException(status_code=400, detail="Failed to load project. Incorrect password or invalid file.")

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
    os.makedirs(default_dir, exist_ok=True)

    content = await file.read()

    with open(knx_daemon.DEFAULT_KNXKEYS_FILE, "wb") as f:
        f.write(content)

    if password:
        with open(knx_daemon.DEFAULT_KNXKEYS_PASSWORD_FILE, "w", encoding="utf-8") as f:
            f.write(password)

    # Trigger reconnection with new credentials
    await knx_daemon._reconnect_knx()

    return {"status": "ok", "message": "KNX keys file uploaded. Reconnecting to bus..."}


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
