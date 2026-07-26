"""Model Context Protocol (MCP) server for SpectrumKNX.

Exposes the KNX telegram store to MCP clients (Claude Desktop, Cursor, …) over
the Streamable HTTP transport, mounted into the FastAPI app at ``/mcp``.

The tool logic lives in the shared ``knx_telegram_store.mcp`` package so it is
identical to the Home Assistant consumer; this module only wraps those
functions into MCP tools and wires them to SpectrumKNX's store.

Access is gated by ``MCP_MODE``:

- ``off`` — the endpoint is not mounted.
- ``read-only`` (default) — query/introspection tools only.
- ``read-write`` — additionally exposes bus/write tools (added in a later step).
"""

import os
from dataclasses import asdict
from typing import Any

from knx_telegram_store.mcp import (
    LastValuesInput,
    QueryTelegramsInput,
)
from knx_telegram_store.mcp import (
    count_telegrams as lib_count_telegrams,
)
from knx_telegram_store.mcp import (
    get_last_values as lib_get_last_values,
)
from knx_telegram_store.mcp import (
    get_store_capabilities as lib_get_store_capabilities,
)
from knx_telegram_store.mcp import (
    get_store_stats as lib_get_store_stats,
)
from knx_telegram_store.mcp import (
    query_telegrams as lib_query_telegrams,
)
from mcp.server.fastmcp import FastMCP
from xknx import mcp as xknx_mcp
from xknxproject import mcp as xknxproject_mcp

import knx_daemon
from database import store

MCP_MODE = os.getenv("MCP_MODE", "read-only").strip().lower()
_VALID_MODES = ("off", "read-only", "read-write")


def mcp_enabled() -> bool:
    """Whether the MCP endpoint should be mounted."""
    return MCP_MODE in ("read-only", "read-write")


def write_tools_enabled() -> bool:
    """Whether bus/write tools may be exposed (read-write mode only)."""
    return MCP_MODE == "read-write"


def mcp_status() -> dict[str, Any]:
    """MCP state for the server-config/status API."""
    mode = MCP_MODE if MCP_MODE in _VALID_MODES else "off"
    return {"mode": mode, "enabled": mcp_enabled(), "write_tools": write_tools_enabled()}


def _require_project() -> Any:
    """The parsed ETS project, or raise if none is loaded.

    Resolved per call so tools pick up a reloaded project without a rebuild.
    """
    project = knx_daemon.global_knx_project
    if project is None:
        raise ValueError(
            "No ETS project is loaded. Configure an ETS .knxproj to use project tools."
        )
    return project


def _require_xknx() -> Any:
    """The live XKNX instance, or raise if the bus stack is not running."""
    instance = knx_daemon.xknx_instance
    if instance is None:
        raise ValueError("The KNX bus stack is not running.")
    return instance


def _build_server() -> FastMCP:
    # stateless_http keeps each request self-contained — no server-side session
    # state to manage, which is all these read tools need and simplifies mounting.
    # streamable_http_path="/" so that mounting the app at "/mcp" serves the
    # endpoint at "/mcp" rather than the doubled-up "/mcp/mcp".
    mcp = FastMCP("spectrum-knx", stateless_http=True, streamable_http_path="/")

    @mcp.tool()
    async def query_telegrams(
        start_time: str | None = None,
        end_time: str | None = None,
        sources: list[str] | None = None,
        destinations: list[str] | None = None,
        telegram_types: list[str] | None = None,
        directions: list[str] | None = None,
        dpt_mains: list[int] | None = None,
        dpts: list[str] | None = None,
        delta_before_ms: int = 0,
        delta_after_ms: int = 0,
        limit: int = 100,
        offset: int = 0,
        order_descending: bool = True,
    ) -> dict[str, Any]:
        """Search stored KNX telegrams. Times are ISO-8601; address/type/direction
        filters are lists (OR within a filter, AND across filters). `telegram_types`
        accepts "Write"/"Read"/"Response" or the full GroupValue* names. `dpts` are
        "main" or "main.sub" strings (e.g. "9.001"). `delta_before_ms`/`delta_after_ms`
        add a context window of telegrams around each match."""
        result = await lib_query_telegrams(
            store,
            QueryTelegramsInput(
                start_time=start_time,
                end_time=end_time,
                sources=sources or [],
                destinations=destinations or [],
                telegram_types=telegram_types or [],
                directions=directions or [],
                dpt_mains=dpt_mains or [],
                dpts=dpts or [],
                delta_before_ms=delta_before_ms,
                delta_after_ms=delta_after_ms,
                limit=limit,
                offset=offset,
                order_descending=order_descending,
            ),
        )
        return asdict(result)

    @mcp.tool()
    async def get_last_values(destinations: list[str] | None = None) -> dict[str, Any]:
        """Most recent telegram for each group address (optionally filtered to
        the given destinations)."""
        result = await lib_get_last_values(store, LastValuesInput(destinations=destinations or []))
        return {"telegrams": [asdict(t) for t in result]}

    @mcp.tool()
    async def get_store_stats() -> dict[str, Any]:
        """Telegram count, covered time range, on-disk size, backend and retention."""
        return asdict(await lib_get_store_stats(store))

    @mcp.tool()
    async def get_store_capabilities() -> dict[str, Any]:
        """What the telegram-store backend supports (time range, pagination, size, …)."""
        return asdict(await lib_get_store_capabilities(store))

    @mcp.tool()
    async def count_telegrams() -> dict[str, Any]:
        """Total number of stored telegrams."""
        return asdict(await lib_count_telegrams(store))

    @mcp.tool()
    async def get_server_config() -> dict[str, Any]:
        """SpectrumKNX connection/security configuration (passwords masked)."""
        return knx_daemon.get_server_config()

    # --- ETS project introspection (xknxproject.mcp) --------------------------

    @mcp.tool()
    async def get_project_info() -> dict[str, Any]:
        """Loaded ETS project metadata and top-level entity counts."""
        return asdict(await xknxproject_mcp.get_project_info(_require_project()))

    @mcp.tool()
    async def list_group_addresses(
        text: str | None = None,
        dpts: list[str] | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> dict[str, Any]:
        """List project group addresses. `text` matches address/name/description;
        `dpts` are "main" or "main.sub" strings (e.g. "9.001")."""
        result = await xknxproject_mcp.list_group_addresses(
            _require_project(),
            xknxproject_mcp.GroupAddressFilter(
                text=text, dpts=dpts or [], limit=limit, offset=offset
            ),
        )
        return asdict(result)

    @mcp.tool()
    async def describe_group_address(address: str) -> dict[str, Any]:
        """Resolve one group address to its communication objects and devices."""
        return asdict(await xknxproject_mcp.describe_group_address(_require_project(), address))

    @mcp.tool()
    async def list_devices(
        text: str | None = None, limit: int = 100, offset: int = 0
    ) -> dict[str, Any]:
        """List project devices. `text` matches individual address/name/manufacturer."""
        result = await xknxproject_mcp.list_devices(
            _require_project(),
            xknxproject_mcp.DeviceFilter(text=text, limit=limit, offset=offset),
        )
        return asdict(result)

    @mcp.tool()
    async def list_communication_objects(
        device_address: str | None = None,
        group_address: str | None = None,
        text: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> dict[str, Any]:
        """List communication objects, optionally scoped to a device and/or a
        linked group address."""
        result = await xknxproject_mcp.list_communication_objects(
            _require_project(),
            xknxproject_mcp.CommunicationObjectFilter(
                device_address=device_address,
                group_address=group_address,
                text=text,
                limit=limit,
                offset=offset,
            ),
        )
        return asdict(result)

    @mcp.tool()
    async def get_topology() -> dict[str, Any]:
        """Bus topology: areas, their lines and device addresses."""
        return asdict(await xknxproject_mcp.get_topology(_require_project()))

    @mcp.tool()
    async def list_locations() -> dict[str, Any]:
        """Building/location tree (spaces, nested, with devices and functions)."""
        return asdict(await xknxproject_mcp.list_locations(_require_project()))

    # --- KNX data point types + bus status (xknx.mcp) -------------------------

    @mcp.tool()
    async def list_dpts(
        main: int | None = None,
        text: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> dict[str, Any]:
        """List known KNX data point types. `main` restricts to a DPT main
        number; `text` matches the DPT number/value type/unit."""
        result = await xknx_mcp.list_dpts(
            xknx_mcp.DptFilter(main=main, text=text, limit=limit, offset=offset)
        )
        return asdict(result)

    @mcp.tool()
    async def describe_dpt(dpt: str) -> dict[str, Any]:
        """Resolve a DPT number ("9.001") or value type name ("temperature") to
        its definition (value type, unit, numeric bounds)."""
        return asdict(await xknx_mcp.describe_dpt(dpt))

    @mcp.tool()
    async def get_connection_status() -> dict[str, Any]:
        """KNX bus connection state, connection type and local individual address."""
        return asdict(await xknx_mcp.get_connection_status(_require_xknx()))

    return mcp


_fastmcp: FastMCP | None = None
_asgi_app: Any = None


def get_asgi_app() -> Any:
    """The Streamable HTTP ASGI app to mount, built once on first use."""
    global _fastmcp, _asgi_app
    if _asgi_app is None:
        _fastmcp = _build_server()
        _asgi_app = _fastmcp.streamable_http_app()
    return _asgi_app


def session_manager_run() -> Any:
    """Async context manager that runs the MCP session manager for the app's
    lifetime. Must be entered while the endpoint is mounted."""
    get_asgi_app()  # ensure the server (and its session manager) exists
    assert _fastmcp is not None
    return _fastmcp.session_manager.run()
