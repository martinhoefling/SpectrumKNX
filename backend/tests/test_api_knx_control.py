from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from xknx.exceptions import ConversionError, CouldNotParseAddress

import cyclic_send
import knx_daemon
from cyclic_send import SendJob
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


def test_scheduled_send_starts_job():
    with (
        patch.object(knx_daemon, "ALLOW_WRITE", True),
        patch.object(knx_daemon, "is_connected", return_value=True),
        patch.object(cyclic_send, "start_send", return_value=SendJob(address="1/2/3")) as start,
    ):
        response = client.post(
            "/api/knx/send/scheduled",
            json={"address": "1/2/3", "payload": 50, "dpt": "5.001", "delay_seconds": 2, "interval_seconds": 5},
        )
    assert response.status_code == 200
    assert response.json()["state"] == "waiting"
    start.assert_called_once_with("1/2/3", 50, "5.001", False, 2.0, 5.0)


def test_scheduled_send_rejected_when_job_active():
    with (
        patch.object(knx_daemon, "ALLOW_WRITE", True),
        patch.object(knx_daemon, "is_connected", return_value=True),
        patch.object(cyclic_send, "start_send", side_effect=RuntimeError("A scheduled send is already active")),
    ):
        response = client.post(
            "/api/knx/send/scheduled",
            json={"address": "1/2/3", "payload": True, "dpt": "1.001", "interval_seconds": 5},
        )
    assert response.status_code == 409


def test_scheduled_send_without_delay_or_interval_returns_400():
    with (
        patch.object(knx_daemon, "ALLOW_WRITE", True),
        patch.object(knx_daemon, "is_connected", return_value=True),
    ):
        response = client.post("/api/knx/send/scheduled", json={"address": "1/2/3", "payload": True, "dpt": "1.001"})
    assert response.status_code == 400


def test_scheduled_send_invalid_payload_returns_400():
    with (
        patch.object(knx_daemon, "ALLOW_WRITE", True),
        patch.object(knx_daemon, "is_connected", return_value=True),
    ):
        response = client.post(
            "/api/knx/send/scheduled",
            json={"address": "1/2/3", "payload": "not-a-number", "dpt": "9.001", "interval_seconds": 5},
        )
    assert response.status_code == 400


def test_scheduled_send_interval_below_floor_returns_422():
    with (
        patch.object(knx_daemon, "ALLOW_WRITE", True),
        patch.object(knx_daemon, "is_connected", return_value=True),
    ):
        response = client.post(
            "/api/knx/send/scheduled",
            json={"address": "1/2/3", "payload": True, "dpt": "1.001", "interval_seconds": 0.5},
        )
    assert response.status_code == 422


def test_scheduled_send_rejected_when_write_disabled():
    with patch.object(knx_daemon, "ALLOW_WRITE", False):
        response = client.post(
            "/api/knx/send/scheduled",
            json={"address": "1/2/3", "payload": True, "dpt": "1.001", "interval_seconds": 5},
        )
    assert response.status_code == 403


def test_scheduled_send_status_idle():
    with patch.object(cyclic_send, "current_job", None):
        response = client.get("/api/knx/send/scheduled/status")
    assert response.status_code == 200
    assert response.json() == {"state": "idle"}


def test_scheduled_send_status_reports_job():
    job = SendJob(address="1/2/3", interval_seconds=5.0)
    job.state = "running"
    job.sends_done = 3
    with patch.object(cyclic_send, "current_job", job):
        response = client.get("/api/knx/send/scheduled/status")
    assert response.status_code == 200
    data = response.json()
    assert data["state"] == "running"
    assert data["address"] == "1/2/3"
    assert data["sends_done"] == 3


def test_scheduled_send_cancel():
    with patch.object(cyclic_send, "cancel_send", return_value=True):
        response = client.post("/api/knx/send/scheduled/cancel")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_scheduled_send_cancel_when_idle_returns_404():
    with patch.object(cyclic_send, "cancel_send", return_value=False):
        response = client.post("/api/knx/send/scheduled/cancel")
    assert response.status_code == 404
