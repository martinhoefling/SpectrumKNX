"""Model Context Protocol (MCP) server for SpectrumKNX.

Exposes the KNX telegram store to MCP clients (Claude Desktop, Cursor, …) over
the Streamable HTTP transport, mounted into the FastAPI app at ``/mcp``.

The tool logic lives in the shared ``knx_telegram_store.mcp`` package so it is
identical to the Home Assistant consumer; this module only wraps those
functions into MCP tools and wires them to SpectrumKNX's store.

Access is gated by ``MCP_MODE``:

- ``off`` — the endpoint is not mounted.
- ``read-only`` (default) — query/introspection tools only.
- ``read-write`` — additionally exposes bus tools that transmit on the KNX
  bus (live read, GroupValueRead, GroupValueWrite).
"""

import json
import os
from collections.abc import Callable
from dataclasses import asdict, fields
from typing import Annotated, Any

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
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import Field
from xknx import mcp as xknx_mcp
from xknxproject import mcp as xknxproject_mcp

import knx_daemon
from database import store

MCP_MODE = os.getenv("MCP_MODE", "read-only").strip().lower()
_VALID_MODES = ("off", "read-only", "read-write")

# Raw parsed-project sections exposed as `knx://project/<section>` resources.
_PROJECT_SECTIONS = ("group_addresses", "devices", "topology", "locations", "functions")

# Shared domain primer prepended to the canned prompts so an agent has KNX context
# even on a fresh conversation.
_KNX_CONTEXT = """\
You are working with a KNX building-automation installation via SpectrumKNX's MCP \
tools and resources. Key concepts:
- Group addresses (GAs, e.g. "1/2/3") are the communication endpoints; each carries a \
Data Point Type (DPT, e.g. 9.001 = temperature in °C) defining its value format.
- Devices have individual addresses (IAs, e.g. "1.1.5"); their communication objects \
link to GAs.
- Telegrams are bus messages (GroupValueWrite / GroupValueRead / GroupValueResponse).
- The loaded ETS project defines the topology, locations and functions that group \
related GAs.

Read the `knx://project*` resources for installation structure, and use the query / \
statistics / last-value tools for stored telegrams. Bus write tools exist only when \
the server is configured in read-write mode."""


def _project_overview() -> str:
    """A compact index of the loaded ETS project: metadata + per-section counts.

    Kept light so it is a cheap entry point; the per-section resources carry detail.
    """
    project = knx_daemon.global_knx_project
    if not project:
        return json.dumps({"status": "no_project_loaded"})
    return json.dumps(
        {
            "status": "ok",
            "info": project.get("info", {}),
            "counts": {name: len(project.get(name) or {}) for name in _PROJECT_SECTIONS},
        },
        default=str,
        sort_keys=True,
    )


def _project_section(section: str) -> str:
    """A stable, read-only JSON view of one parsed-project section."""
    project = knx_daemon.global_knx_project
    if not project:
        return json.dumps({"status": "no_project_loaded", section: {}})
    return json.dumps({"status": "ok", section: project.get(section, {})}, default=str, sort_keys=True)


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
        raise ValueError("No ETS project is loaded. Configure an ETS .knxproj to use project tools.")
    return project


def _require_xknx() -> Any:
    """The live XKNX instance, or raise if the bus stack is not running."""
    instance = knx_daemon.xknx_instance
    if instance is None:
        raise ValueError("The KNX bus stack is not running.")
    return instance


def _describe(*input_types: type, **overrides: str) -> Callable[[Callable], Callable]:
    """Attach parameter descriptions to a tool from library dataclass metadata.

    The shared ``*.mcp`` input dataclasses carry each field's description as
    ``dataclasses.field`` metadata. FastMCP only surfaces per-parameter
    descriptions from ``Annotated[..., pydantic.Field(description=...)]`` in the
    signature, so this decorator rewrites the wrapper's annotations in place —
    matching parameter names to fields — instead of duplicating the text here.
    ``overrides`` supplies descriptions for ad-hoc parameters that are not backed
    by a dataclass field. Applied *below* ``@mcp.tool()`` so it runs first.
    """
    descriptions: dict[str, str] = {}
    for input_type in input_types:
        for field in fields(input_type):
            description = field.metadata.get("description")
            if description:
                descriptions.setdefault(field.name, description)
    descriptions.update(overrides)

    def decorator(func: Callable) -> Callable:
        hints = dict(func.__annotations__)
        for name, description in descriptions.items():
            if name in hints:
                hints[name] = Annotated[hints[name], Field(description=description)]
        func.__annotations__ = hints
        return func

    return decorator


def _build_server() -> FastMCP:
    # stateless_http keeps each request self-contained — no server-side session
    # state to manage, which is all these read tools need and simplifies mounting.
    # streamable_http_path="/" so that mounting the app at "/mcp" serves the
    # endpoint at "/mcp" rather than the doubled-up "/mcp/mcp".
    # enable_dns_rebinding_protection=False allows remote network clients / custom Host headers.
    mcp = FastMCP(
        "spectrum-knx",
        stateless_http=True,
        streamable_http_path="/",
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )

    # ── Project resources (#335) ────────────────────────────────────────────────
    # Read-only snapshots of the loaded ETS project. All degrade to a stable
    # {"status": "no_project_loaded"} payload when no project is configured.

    @mcp.resource(
        "knx://project",
        name="ETS project overview",
        description="Loaded ETS project metadata and per-section object counts.",
        mime_type="application/json",
    )
    def project_overview() -> str:
        return _project_overview()

    @mcp.resource(
        "knx://project/group-addresses",
        name="ETS group addresses",
        description="Group addresses with their names, DPTs and metadata.",
        mime_type="application/json",
    )
    def project_group_addresses() -> str:
        return _project_section("group_addresses")

    @mcp.resource(
        "knx://project/devices",
        name="ETS devices",
        description="Devices keyed by KNX individual address.",
        mime_type="application/json",
    )
    def project_devices() -> str:
        return _project_section("devices")

    @mcp.resource(
        "knx://project/topology",
        name="ETS topology",
        description="Area and line topology.",
        mime_type="application/json",
    )
    def project_topology() -> str:
        return _project_section("topology")

    @mcp.resource(
        "knx://project/locations",
        name="ETS locations",
        description="Building and room structure.",
        mime_type="application/json",
    )
    def project_locations() -> str:
        return _project_section("locations")

    @mcp.resource(
        "knx://project/functions",
        name="ETS functions",
        description="Functions / functional blocks and their group-address roles.",
        mime_type="application/json",
    )
    def project_functions() -> str:
        return _project_section("functions")

    # ── Canned prompts (#335) ───────────────────────────────────────────────────

    @mcp.prompt()
    def analyze_bus_traffic(hours: int = 1) -> str:
        """Analyze recent KNX traffic for volume, noisy addresses and unusual values."""
        return (
            f"{_KNX_CONTEXT}\n\n"
            f"Analyze KNX bus traffic from the last {hours} hour(s). Use `query_telegrams`, "
            "`count_telegrams` and `get_store_stats`. Summarize traffic volume, the busiest "
            "sources and destinations, repeated or unusual values, and actionable anomalies. "
            "Do not send or modify bus values."
        )

    @mcp.prompt()
    def find_group_addresses_without_dpts() -> str:
        """Find ETS group addresses that have no assigned DPT."""
        return (
            f"{_KNX_CONTEXT}\n\n"
            "Read the `knx://project/group-addresses` resource and list every group address "
            "with no assigned DPT. Group the results by project range or function where that "
            "metadata is available. Do not infer a DPT; suggest candidates separately and state "
            "what evidence (e.g. observed telegram payloads) would confirm them."
        )

    @mcp.tool()
    @_describe(QueryTelegramsInput)
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
    @_describe(LastValuesInput)
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
    @_describe(xknxproject_mcp.GroupAddressFilter)
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
            xknxproject_mcp.GroupAddressFilter(text=text, dpts=dpts or [], limit=limit, offset=offset),
        )
        return asdict(result)

    @mcp.tool()
    @_describe(address='Group address to resolve, e.g. "1/2/3".')
    async def describe_group_address(address: str) -> dict[str, Any]:
        """Resolve one group address to its communication objects and devices."""
        return asdict(await xknxproject_mcp.describe_group_address(_require_project(), address))

    @mcp.tool()
    @_describe(xknxproject_mcp.DeviceFilter)
    async def list_devices(text: str | None = None, limit: int = 100, offset: int = 0) -> dict[str, Any]:
        """List project devices. `text` matches individual address/name/manufacturer."""
        result = await xknxproject_mcp.list_devices(
            _require_project(),
            xknxproject_mcp.DeviceFilter(text=text, limit=limit, offset=offset),
        )
        return asdict(result)

    @mcp.tool()
    @_describe(xknxproject_mcp.CommunicationObjectFilter)
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

    @mcp.tool()
    @_describe(xknxproject_mcp.FunctionFilter)
    async def list_functions(
        text: str | None = None,
        space_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> dict[str, Any]:
        """List project functions/functional blocks. `text` matches identifier/name/type/usage;
        `space_id` restricts to a specific space/room."""
        result = await xknxproject_mcp.list_functions(
            _require_project(),
            xknxproject_mcp.FunctionFilter(text=text, space_id=space_id, limit=limit, offset=offset),
        )
        return asdict(result)

    @mcp.tool()
    @_describe(identifier="Function/functional-block identifier to resolve.")
    async def describe_function(identifier: str) -> dict[str, Any]:
        """Resolve one function/functional block by identifier to its group address references and roles."""
        return asdict(await xknxproject_mcp.describe_function(_require_project(), identifier))

    # --- KNX data point types + bus status (xknx.mcp) -------------------------

    @mcp.tool()
    @_describe(xknx_mcp.DptFilter)
    async def list_dpts(
        main: int | None = None,
        text: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> dict[str, Any]:
        """List known KNX data point types. `main` restricts to a DPT main
        number; `text` matches the DPT number/value type/unit."""
        result = await xknx_mcp.list_dpts(xknx_mcp.DptFilter(main=main, text=text, limit=limit, offset=offset))
        return asdict(result)

    @mcp.tool()
    @_describe(dpt='DPT number ("9.001") or value type name ("temperature") to resolve.')
    async def describe_dpt(dpt: str) -> dict[str, Any]:
        """Resolve a DPT number ("9.001") or value type name ("temperature") to
        its definition (value type, unit, numeric bounds)."""
        return asdict(await xknx_mcp.describe_dpt(dpt))

    @mcp.tool()
    async def get_connection_status() -> dict[str, Any]:
        """KNX bus connection state, connection type and local individual address."""
        return asdict(await xknx_mcp.get_connection_status(_require_xknx()))

    @mcp.tool()
    @_describe(xknx_mcp.EncodeDptPayloadInput)
    async def encode_value(value: Any, value_type: str) -> dict[str, Any]:
        """Encode a value using a specific DPT into its raw payload bytes.
        `value` is the Python native value; `value_type` is DPT number (e.g. "9.001") or name."""
        result = await xknx_mcp.encode_dpt_payload(xknx_mcp.EncodeDptPayloadInput(value=value, value_type=value_type))
        return asdict(result)

    @mcp.tool()
    @_describe(xknx_mcp.DecodeDptPayloadInput)
    async def decode_payload(payload: list[int] | int, value_type: str) -> dict[str, Any]:
        """Decode raw payload bytes or integer using a specific DPT.
        `payload` is a list of byte integers, or a single integer for 6-bit DPTs (like 1.001)."""
        result = await xknx_mcp.decode_dpt_payload(
            xknx_mcp.DecodeDptPayloadInput(payload=payload, value_type=value_type)
        )
        return asdict(result)

    if write_tools_enabled():
        _register_bus_tools(mcp)

    return mcp


def _register_bus_tools(mcp: FastMCP) -> None:
    """Register the bus tools that transmit on the KNX bus.

    Only mounted in ``read-write`` mode: these send telegrams (a live read
    triggers a GroupValueRead; a write mutates a group address).
    """

    @mcp.tool()
    @_describe(xknx_mcp.GroupValueReadInput)
    async def read_group_value(group_address: str, value_type: str | None = None) -> dict[str, Any]:
        """Read a group address live from the bus (sends a GroupValueRead and
        waits). `value_type` is a DPT number ("9.001") or value type name
        ("temperature"); without it the raw payload is returned."""
        result = await xknx_mcp.read_group_value(
            _require_xknx(),
            xknx_mcp.GroupValueReadInput(group_address=group_address, value_type=value_type),
        )
        return asdict(result)

    @mcp.tool()
    @_describe(xknx_mcp.GroupAddressInput)
    async def send_group_value_read(group_address: str) -> dict[str, Any]:
        """Queue a GroupValueRead telegram to trigger a response on the bus."""
        result = await xknx_mcp.send_group_value_read(
            _require_xknx(), xknx_mcp.GroupAddressInput(group_address=group_address)
        )
        return asdict(result)

    @mcp.tool()
    @_describe(xknx_mcp.GroupValueWriteInput)
    async def send_group_value_write(
        group_address: str,
        value: bool | int | float | str | list[int],
        value_type: str | None = None,
    ) -> dict[str, Any]:
        """Write a value to a group address (queues a GroupValueWrite). `value_type`
        selects the DPT used to encode `value`; without it an int is sent as a
        6-bit payload and a list of ints as a byte array."""
        result = await xknx_mcp.send_group_value_write(
            _require_xknx(),
            xknx_mcp.GroupValueWriteInput(group_address=group_address, value=value, value_type=value_type),
        )
        return asdict(result)


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
