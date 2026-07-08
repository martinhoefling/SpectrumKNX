from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from xknx.exceptions import ConversionError, CouldNotParseAddress

import knx_daemon
from main import app

client = TestClient(app)


def test_send_rejected_when_write_disabled():
    with patch.object(knx_daemon, "ALLOW_WRITE", False):
        response = client.post("/api/knx/send", json={"address": "1/2/3", "payload": True, "dpt": "1.001"})
    assert response.status_code == 403


def test_send_rejected_when_not_connected():
    with (
        patch.object(knx_daemon, "ALLOW_WRITE", True),
        patch.object(knx_daemon, "is_connected", return_value=False),
    ):
        response = client.post("/api/knx/send", json={"address": "1/2/3", "payload": True, "dpt": "1.001"})
    assert response.status_code == 409


def test_send_writes_to_bus():
    with (
        patch.object(knx_daemon, "ALLOW_WRITE", True),
        patch.object(knx_daemon, "is_connected", return_value=True),
        patch.object(knx_daemon, "send_group_value", new=AsyncMock()) as send,
    ):
        response = client.post(
            "/api/knx/send",
            json={"address": "1/2/3", "payload": 50, "dpt": "5.001", "response": False},
        )
    assert response.status_code == 200
    assert response.json() == {"status": "sent"}
    send.assert_awaited_once_with("1/2/3", 50, "5.001", False)


def test_send_invalid_payload_returns_400():
    with (
        patch.object(knx_daemon, "ALLOW_WRITE", True),
        patch.object(knx_daemon, "is_connected", return_value=True),
        patch.object(knx_daemon, "send_group_value", new=AsyncMock(side_effect=ConversionError("bad value"))),
    ):
        response = client.post("/api/knx/send", json={"address": "1/2/3", "payload": "x", "dpt": "9.001"})
    assert response.status_code == 400


def test_read_sends_group_value_read():
    with (
        patch.object(knx_daemon, "ALLOW_WRITE", True),
        patch.object(knx_daemon, "is_connected", return_value=True),
        patch.object(knx_daemon, "read_group_value", new=AsyncMock()) as read,
    ):
        response = client.post("/api/knx/read", json={"address": "1/2/3"})
    assert response.status_code == 200
    assert response.json() == {"status": "sent"}
    read.assert_awaited_once_with("1/2/3")


def test_read_invalid_address_returns_400():
    with (
        patch.object(knx_daemon, "ALLOW_WRITE", True),
        patch.object(knx_daemon, "is_connected", return_value=True),
        patch.object(knx_daemon, "read_group_value", new=AsyncMock(side_effect=CouldNotParseAddress("nope"))),
    ):
        response = client.post("/api/knx/read", json={"address": "nope"})
    assert response.status_code == 400
