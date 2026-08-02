import json
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from knx_telegram_store.backends.memory import MemoryStore
from xknx import XKNX
from xknx.dpt import DPTArray
from xknx.telegram import GroupAddress, Telegram, apci

import knx_daemon
import mcp_server
from knx_telegram_store import StoredTelegram

NOW = datetime(2026, 7, 23, 12, 0, 0, tzinfo=UTC)


def _sample_project() -> dict:
    """A minimal parsed-KNXProject shape covering the project introspection tools."""
    flags = {
        "read": False,
        "write": True,
        "communication": True,
        "transmit": True,
        "update": False,
        "read_on_init": False,
    }
    return {
        "info": {
            "project_id": "P-1",
            "name": "Demo",
            "last_modified": None,
            "group_address_style": "ThreeLevel",
            "guid": "g",
            "created_by": "ETS",
            "schema_version": "21",
            "tool_version": "6.0",
            "xknxproject_version": "3.9.0",
            "language_code": None,
        },
        "communication_objects": {
            "1.1.5/O-1": {
                "name": "CO",
                "number": 1,
                "text": "Switch",
                "function_text": "On/Off",
                "description": "",
                "device_address": "1.1.5",
                "device_application": None,
                "module": None,
                "channel": None,
                "dpts": [{"main": 1, "sub": 1}],
                "object_size": "1 Bit",
                "group_address_links": ["1/0/0"],
                "flags": flags,
                "dpas": None,
            }
        },
        "devices": {
            "1.1.5": {
                "name": "Switch Actuator",
                "hardware_name": "HW",
                "order_number": "ORD-1",
                "description": "",
                "manufacturer_name": "ACME",
                "individual_address": "1.1.5",
                "application": None,
                "project_uid": None,
                "communication_object_ids": ["1.1.5/O-1"],
                "channels": {},
            }
        },
        "topology": {
            "1": {
                "name": "Area 1",
                "description": None,
                "lines": {
                    "1.1": {
                        "name": "Line 1",
                        "medium_type": "TP",
                        "description": None,
                        "devices": ["1.1.5"],
                    }
                },
            }
        },
        "locations": {
            "B1": {
                "type": "Building",
                "identifier": "B1",
                "name": "House",
                "usage_id": None,
                "usage_text": "",
                "number": "",
                "description": "",
                "project_uid": None,
                "devices": ["1.1.5"],
                "spaces": {},
                "functions": [],
            }
        },
        "group_addresses": {
            "1/0/0": {
                "name": "Kitchen Light",
                "identifier": "GA-1",
                "raw_address": 2048,
                "address": "1/0/0",
                "project_uid": None,
                "dpt": {"main": 1, "sub": 1},
                "data_secure": False,
                "communication_object_ids": ["1.1.5/O-1"],
                "description": "",
                "comment": "",
            }
        },
        "group_ranges": {},
        "functions": {
            "F-1": {
                "function_type": "FT-1",
                "group_addresses": {
                    "1/0/0": {
                        "address": "1/0/0",
                        "name": "Kitchen Light",
                        "project_uid": 12,
                        "role": "SwitchOnOff",
                    }
                },
                "identifier": "F-1",
                "name": "Kitchen Light Function",
                "project_uid": 10,
                "space_id": "B1",
                "usage_text": "Control kitchen light",
            }
        },
    }


async def _seeded_store() -> MemoryStore:
    store = MemoryStore(max_telegrams=100)
    await store.initialize()
    await store.store_many(
        [
            StoredTelegram(
                timestamp=NOW - timedelta(minutes=2),
                source="1.1.1",
                destination="1/1/1",
                telegramtype="GroupValueWrite",
                direction="Incoming",
                value=21.0,
                value_numeric=21.0,
                dpt_main=9,
                dpt_sub=1,
            ),
            StoredTelegram(
                timestamp=NOW - timedelta(minutes=1),
                source="1.1.2",
                destination="1/2/2",
                telegramtype="GroupValueWrite",
                direction="Outgoing",
                value=True,
                dpt_main=1,
                dpt_sub=1,
            ),
        ]
    )
    return store


@pytest_asyncio.fixture
async def server(monkeypatch):
    """A freshly built MCP server wired to a seeded in-memory store."""
    store = await _seeded_store()
    monkeypatch.setattr(mcp_server, "store", store)
    return mcp_server._build_server()


async def _structured(server, name, args=None):
    """The structured (dict/list) result of a tool call."""
    _, structured = await server.call_tool(name, args or {})
    return structured


@pytest.mark.asyncio
async def test_lists_read_only_tools(server):
    names = {t.name for t in await server.list_tools()}
    assert {
        "query_telegrams",
        "get_last_values",
        "get_store_stats",
        "get_store_capabilities",
        "count_telegrams",
        "get_server_config",
        # ETS project introspection (xknxproject.mcp)
        "get_project_info",
        "list_group_addresses",
        "describe_group_address",
        "list_devices",
        "list_communication_objects",
        "get_topology",
        "list_locations",
        "list_functions",
        "describe_function",
        # DPT catalogue + bus status (xknx.mcp)
        "list_dpts",
        "describe_dpt",
        "get_connection_status",
        "encode_value",
        "decode_payload",
    } <= names


# ── Project resources + canned prompts (#335) ────────────────────────────────


@pytest.mark.asyncio
async def test_lists_project_resources_and_prompts(server):
    uris = {str(r.uri) for r in await server.list_resources()}
    assert uris == {"knx://project"}

    prompts = {p.name for p in await server.list_prompts()}
    assert {"analyze_bus_traffic", "find_group_addresses_without_dpts"} <= prompts


@pytest.mark.asyncio
async def test_project_overview(server, monkeypatch):
    monkeypatch.setattr(knx_daemon, "global_knx_project", _sample_project())

    overview = json.loads((await server.read_resource("knx://project"))[0].content)
    assert overview["status"] == "ok"
    assert overview["info"]["name"] == "Demo"
    # Overview is a light index: metadata and section counts.
    assert overview["counts"]["group_addresses"] == 1
    assert overview["counts"]["devices"] == 1
    assert "group_addresses" not in overview


@pytest.mark.asyncio
async def test_project_resources_report_when_no_project_is_loaded(server, monkeypatch):
    monkeypatch.setattr(knx_daemon, "global_knx_project", None)

    overview = json.loads((await server.read_resource("knx://project"))[0].content)
    assert overview == {"status": "no_project_loaded"}


@pytest.mark.asyncio
async def test_canned_prompts_include_knx_context(server):
    traffic = await server.get_prompt("analyze_bus_traffic", {"hours": "2"})
    text = traffic.messages[0].content.text
    assert "last 2 hour(s)" in text
    assert "Do not send or modify bus values" in text
    assert "Group addresses (GAs" in text  # shared KNX context primer is prepended

    missing = await server.get_prompt("find_group_addresses_without_dpts")
    missing_text = missing.messages[0].content.text
    assert "list_group_addresses" in missing_text
    assert "Do not infer a DPT" in missing_text


def test_endpoint_serves_at_mount_root_not_doubled():
    # FastMCP must serve at "/" internally so mounting the app at "/mcp" yields
    # "/mcp" and not the doubled-up "/mcp/mcp" (#332).
    paths = [getattr(r, "path", None) for r in mcp_server.get_asgi_app().routes]
    assert "/" in paths
    assert "/mcp" not in paths


@pytest.mark.asyncio
async def test_query_telegrams(server):
    result = await _structured(server, "query_telegrams", {"destinations": ["1/1/1"]})
    assert result["total_count"] == 1
    assert result["telegrams"][0]["destination"] == "1/1/1"
    assert result["telegrams"][0]["dpt"] == "9.001"


@pytest.mark.asyncio
async def test_query_dpt_subtype_and_type_alias(server):
    # DPT subtype filter reaches the store (only the 9.001 temperature telegram).
    by_dpt = await _structured(server, "query_telegrams", {"dpts": ["9.001"]})
    assert [t["destination"] for t in by_dpt["telegrams"]] == ["1/1/1"]
    # "Write" alias resolves to GroupValueWrite (both seeded rows are writes).
    by_type = await _structured(server, "query_telegrams", {"telegram_types": ["Write"]})
    assert by_type["total_count"] == 2


@pytest.mark.asyncio
async def test_count_and_stats(server):
    assert (await _structured(server, "count_telegrams"))["count"] == 2
    stats = await _structured(server, "get_store_stats")
    assert stats["telegram_count"] == 2
    assert stats["backend"]


@pytest.mark.asyncio
async def test_get_last_values_filter(server):
    last = await _structured(server, "get_last_values", {"destinations": ["1/2/2"]})
    assert [t["destination"] for t in last["telegrams"]] == ["1/2/2"]


@pytest.mark.parametrize(
    ("mode", "enabled", "write"),
    [
        ("off", False, False),
        ("read-only", True, False),
        ("read-write", True, True),
    ],
)
def test_mode_gating(monkeypatch, mode, enabled, write):
    monkeypatch.setattr(mcp_server, "MCP_MODE", mode)
    assert mcp_server.mcp_enabled() is enabled
    assert mcp_server.write_tools_enabled() is write
    status = mcp_server.mcp_status()
    assert status == {"mode": mode, "enabled": enabled, "write_tools": write}


def test_invalid_mode_reported_as_off(monkeypatch):
    monkeypatch.setattr(mcp_server, "MCP_MODE", "bogus")
    assert mcp_server.mcp_enabled() is False
    assert mcp_server.mcp_status()["mode"] == "off"


@pytest.mark.asyncio
async def test_project_tools(server, monkeypatch):
    monkeypatch.setattr(knx_daemon, "global_knx_project", _sample_project())

    info = await _structured(server, "get_project_info")
    assert info["name"] == "Demo"
    assert info["group_address_count"] == 1
    assert info["device_count"] == 1

    gas = await _structured(server, "list_group_addresses", {"text": "kitchen"})
    assert [g["address"] for g in gas["group_addresses"]] == ["1/0/0"]
    assert gas["group_addresses"][0]["dpt"] == "1.001"

    detail = await _structured(server, "describe_group_address", {"address": "1/0/0"})
    assert detail["found"] is True
    assert detail["devices"] == ["1.1.5"]

    devices = await _structured(server, "list_devices", {"text": "acme"})
    assert devices["devices"][0]["individual_address"] == "1.1.5"

    cos = await _structured(server, "list_communication_objects", {"group_address": "1/0/0"})
    assert cos["total_count"] == 1

    topo = await _structured(server, "get_topology")
    assert topo["areas"][0]["lines"][0]["devices"] == ["1.1.5"]

    locations = await _structured(server, "list_locations")
    assert locations["spaces"][0]["type"] == "Building"

    functions = await _structured(server, "list_functions", {"text": "kitchen"})
    assert len(functions["functions"]) == 1
    assert functions["functions"][0]["identifier"] == "F-1"
    assert functions["functions"][0]["group_address_count"] == 1

    detail = await _structured(server, "describe_function", {"identifier": "F-1"})
    assert detail["found"] is True
    assert detail["function"]["identifier"] == "F-1"
    assert len(detail["group_addresses"]) == 1
    assert detail["group_addresses"][0]["role"] == "SwitchOnOff"
    assert detail["group_addresses"][0]["address"] == "1/0/0"


@pytest.mark.asyncio
async def test_project_tool_without_project_errors(server, monkeypatch):
    monkeypatch.setattr(knx_daemon, "global_knx_project", None)
    with pytest.raises(Exception):  # noqa: B017, PT011
        await _structured(server, "get_project_info")


@pytest.mark.asyncio
async def test_dpt_tools(server):
    listed = await _structured(server, "list_dpts", {"main": 9})
    assert all(d["dpt"].split(".")[0] == "9" for d in listed["dpts"])
    assert "9.001" in {d["dpt"] for d in listed["dpts"]}

    described = await _structured(server, "describe_dpt", {"dpt": "9.001"})
    assert described["found"] is True
    assert described["dpt"]["value_type"] == "temperature"
    assert described["dpt"]["unit"] == "°C"

    missing = await _structured(server, "describe_dpt", {"dpt": "999.999"})
    assert missing["found"] is False


@pytest_asyncio.fixture
async def rw_server(monkeypatch):
    """An MCP server built in read-write mode, wired to a seeded store."""
    store = await _seeded_store()
    monkeypatch.setattr(mcp_server, "store", store)
    monkeypatch.setattr(mcp_server, "MCP_MODE", "read-write")
    return mcp_server._build_server()


@pytest.mark.asyncio
async def test_write_tools_hidden_in_read_only_mode(server):
    names = {t.name for t in await server.list_tools()}
    assert {"read_group_value", "send_group_value_read", "send_group_value_write"} & names == set()


@pytest.mark.asyncio
async def test_write_tools_exposed_in_read_write_mode(rw_server):
    names = {t.name for t in await rw_server.list_tools()}
    assert {"read_group_value", "send_group_value_read", "send_group_value_write"} <= names


@pytest.mark.asyncio
async def test_send_group_value_write_queues_telegram(rw_server, monkeypatch):
    xknx = XKNX()
    monkeypatch.setattr(knx_daemon, "xknx_instance", xknx)
    result = await _structured(
        rw_server,
        "send_group_value_write",
        {"group_address": "1/2/3", "value": 50, "value_type": "percent"},
    )
    assert result["apci"] == "GroupValueWrite"
    assert xknx.telegrams.get_nowait() == Telegram(
        destination_address=GroupAddress("1/2/3"),
        payload=apci.GroupValueWrite(DPTArray((0x80,))),
    )


@pytest.mark.asyncio
async def test_bus_tools_require_running_stack(rw_server, monkeypatch):
    monkeypatch.setattr(knx_daemon, "xknx_instance", None)
    with pytest.raises(Exception):  # noqa: B017, PT011
        await _structured(rw_server, "send_group_value_read", {"group_address": "1/2/3"})


@pytest.mark.asyncio
async def test_connection_status_tool(server, monkeypatch):
    monkeypatch.setattr(knx_daemon, "xknx_instance", XKNX())
    status = await _structured(server, "get_connection_status")
    assert status["state"] == "DISCONNECTED"
    assert status["connected"] is False

    monkeypatch.setattr(knx_daemon, "xknx_instance", None)
    with pytest.raises(Exception):  # noqa: B017, PT011
        await _structured(server, "get_connection_status")


@pytest.mark.asyncio
async def test_encode_decode_value_tools(server):
    encoded = await _structured(server, "encode_value", {"value": 21.0, "value_type": "9.001"})
    assert encoded["payload"] == [0x0C, 0x1A]
    assert encoded["value_type"] == "9.001"

    decoded = await _structured(server, "decode_payload", {"payload": [0x0C, 0x1A], "value_type": "9.001"})
    assert decoded["value"] == 21.0
    assert decoded["value_type"] == "9.001"

    decoded_binary = await _structured(server, "decode_payload", {"payload": 1, "value_type": "1.001"})
    assert decoded_binary["value"] == "on"
