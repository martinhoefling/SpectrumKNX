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


def test_send_allowed_in_postgres_readonly_when_connected():
    """Bus writes must not be blocked by the telegram store's read-only-ness.

    postgres-readonly keeps a live daemon connection for writes even though
    READ_ONLY (store) is True in that mode.
    """
    import api

    with (
        patch.object(api, "READ_ONLY", True),
        patch.object(knx_daemon, "ALLOW_WRITE", True),
        patch.object(knx_daemon, "is_connected", return_value=True),
        patch.object(knx_daemon, "send_group_value", new=AsyncMock()) as send,
    ):
        response = client.post(
            "/api/knx/send",
            json={"address": "1/2/3", "payload": 50, "dpt": "5.001", "response": False},
        )
    assert response.status_code == 200
    send.assert_awaited_once_with("1/2/3", 50, "5.001", False)


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
    start.assert_called_once_with("1/2/3", 50, "5.001", False, 2.0, 5.0, False)


def test_scheduled_read_starts_job_without_payload():
    with (
        patch.object(knx_daemon, "ALLOW_WRITE", True),
        patch.object(knx_daemon, "is_connected", return_value=True),
        patch.object(cyclic_send, "start_send", return_value=SendJob(address="1/2/3", read=True)) as start,
    ):
        response = client.post(
            "/api/knx/send/scheduled",
            json={"address": "1/2/3", "read": True, "delay_seconds": 2},
        )
    assert response.status_code == 200
    assert response.json()["read"] is True
    start.assert_called_once_with("1/2/3", None, None, False, 2.0, None, True)


def test_scheduled_read_and_write_same_address_both_start():
    with (
        patch.object(knx_daemon, "ALLOW_WRITE", True),
        patch.object(knx_daemon, "is_connected", return_value=True),
        patch.object(cyclic_send, "start_send", side_effect=lambda *args: SendJob(address=args[0], read=args[6])) as start,
    ):
        write = client.post(
            "/api/knx/send/scheduled",
            json={"address": "1/2/3", "payload": True, "dpt": "1.001", "interval_seconds": 5},
        )
        read = client.post(
            "/api/knx/send/scheduled",
            json={"address": "1/2/3", "read": True, "interval_seconds": 5},
        )
    assert write.status_code == 200
    assert read.status_code == 200
    assert start.call_count == 2
    assert start.call_args_list[0].args[6] is False
    assert start.call_args_list[1].args[6] is True


def test_scheduled_send_without_delay_or_interval_returns_400():
    with (
        patch.object(knx_daemon, "ALLOW_WRITE", True),
        patch.object(knx_daemon, "is_connected", return_value=True),
    ):
        response = client.post("/api/knx/send/scheduled", json={"address": "1/2/3", "payload": True, "dpt": "1.001"})
    assert response.status_code == 400


def test_scheduled_read_with_payload_returns_422():
    with (
        patch.object(knx_daemon, "ALLOW_WRITE", True),
        patch.object(knx_daemon, "is_connected", return_value=True),
        patch.object(cyclic_send, "start_send") as start,
    ):
        response = client.post(
            "/api/knx/send/scheduled",
            json={"address": "1/2/3", "read": True, "payload": 50, "dpt": "5.001", "interval_seconds": 5},
        )
    assert response.status_code == 422
    start.assert_not_called()


def test_scheduled_read_with_response_returns_422():
    with (
        patch.object(knx_daemon, "ALLOW_WRITE", True),
        patch.object(knx_daemon, "is_connected", return_value=True),
        patch.object(cyclic_send, "start_send") as start,
    ):
        response = client.post(
            "/api/knx/send/scheduled",
            json={"address": "1/2/3", "read": True, "response": True, "interval_seconds": 5},
        )
    assert response.status_code == 422
    start.assert_not_called()


def test_scheduled_write_without_payload_returns_422():
    with (
        patch.object(knx_daemon, "ALLOW_WRITE", True),
        patch.object(knx_daemon, "is_connected", return_value=True),
        patch.object(cyclic_send, "start_send") as start,
    ):
        response = client.post(
            "/api/knx/send/scheduled",
            json={"address": "1/2/3", "interval_seconds": 5},
        )
    assert response.status_code == 422
    start.assert_not_called()


def test_scheduled_write_with_false_payload_starts_job():
    """False/0 are valid write payloads and must not be treated as missing."""
    with (
        patch.object(knx_daemon, "ALLOW_WRITE", True),
        patch.object(knx_daemon, "is_connected", return_value=True),
        patch.object(cyclic_send, "start_send", return_value=SendJob(address="1/2/3")) as start,
    ):
        response = client.post(
            "/api/knx/send/scheduled",
            json={"address": "1/2/3", "payload": False, "dpt": "1.001", "interval_seconds": 5},
        )
    assert response.status_code == 200
    start.assert_called_once_with("1/2/3", False, "1.001", False, 0.0, 5.0, False)


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
    with patch.object(cyclic_send, "list_active_jobs", return_value=[]):
        response = client.get("/api/knx/send/scheduled/status")
    assert response.status_code == 200
    assert response.json() == {"jobs": []}


def test_scheduled_send_status_reports_jobs():
    job = SendJob(address="1/2/3", interval_seconds=5.0)
    job.state = "running"
    job.sends_done = 3
    with patch.object(cyclic_send, "list_active_jobs", return_value=[job]):
        response = client.get("/api/knx/send/scheduled/status")
    assert response.status_code == 200
    data = response.json()
    assert len(data["jobs"]) == 1
    assert data["jobs"][0]["state"] == "running"
    assert data["jobs"][0]["address"] == "1/2/3"
    assert data["jobs"][0]["sends_done"] == 3


def test_scheduled_send_cancel():
    with patch.object(cyclic_send, "cancel_send", return_value=True) as cancel:
        response = client.post("/api/knx/send/scheduled/cancel", json={"id": "abc123"})
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    cancel.assert_called_once_with("abc123")


def test_scheduled_send_cancel_when_idle_returns_404():
    with patch.object(cyclic_send, "cancel_send", return_value=False):
        response = client.post("/api/knx/send/scheduled/cancel", json={"id": "missing"})
    assert response.status_code == 404


def test_scheduled_send_cancel_all_with_empty_body():
    with patch.object(cyclic_send, "cancel_all_sends", return_value=2) as cancel_all:
        response = client.post("/api/knx/send/scheduled/cancel", json={})
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    cancel_all.assert_called_once_with()


def test_scheduled_send_cancel_all_with_no_body():
    with patch.object(cyclic_send, "cancel_all_sends", return_value=0) as cancel_all:
        response = client.post("/api/knx/send/scheduled/cancel")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    cancel_all.assert_called_once_with()
