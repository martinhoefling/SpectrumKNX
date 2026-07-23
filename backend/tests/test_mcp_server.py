from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from knx_telegram_store import StoredTelegram
from knx_telegram_store.backends.memory import MemoryStore

import mcp_server

NOW = datetime(2026, 7, 23, 12, 0, 0, tzinfo=UTC)


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
    } <= names


@pytest.mark.asyncio
async def test_query_telegrams(server):
    result = await _structured(server, "query_telegrams", {"destinations": ["1/1/1"]})
    assert result["total_count"] == 1
    assert result["telegrams"][0]["destination"] == "1/1/1"
    assert result["telegrams"][0]["dpt"] == "9.001"


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
