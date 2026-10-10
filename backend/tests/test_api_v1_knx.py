"""Tests for the external KNX API and its token (#156)."""

import asyncio
import json
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

import auth
import knx_daemon
from main import app

client = TestClient(app)
PASSWORD = "correct horse battery"
WRITE = {"address": "1/2/3", "value": True, "dpt": "1.001"}


@pytest.fixture(autouse=True)
def _isolated_state(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_STATE_DIR", str(tmp_path))
    for name in ("AUTH_UI_ENABLED", "AUTH_MCP_TOKEN", "AUTH_API_TOKEN", "SUPERVISOR_TOKEN", "AUTH_INGRESS_PEER"):
        monkeypatch.delenv(name, raising=False)
    auth._reset_for_tests()
    client.cookies.clear()
    yield
    auth._reset_for_tests()
    client.cookies.clear()


@pytest.fixture
def bus():
    """A connected bus that may be written to, with the daemon calls mocked."""
    with (
        patch.object(knx_daemon, "ALLOW_WRITE", True),
        patch.object(knx_daemon, "is_connected", return_value=True),
        patch.object(knx_daemon, "send_group_value", new_callable=AsyncMock) as send,
        patch.object(knx_daemon, "read_group_value", new_callable=AsyncMock) as read,
        patch.object(knx_daemon, "read_group_value_response", new_callable=AsyncMock) as read_response,
    ):
        read_response.return_value = (True, 21.5)
        yield {"send": send, "read": read, "read_response": read_response}


def _enable_login():
    return client.post("/api/auth/enable", json={"username": "admin", "password": PASSWORD})


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


# ── Write / read ─────────────────────────────────────────────────────────────


def test_write_sends_the_value(bus):
    response = client.post("/api/v1/knx/write", json=WRITE)
    assert response.status_code == 200
    assert response.json() == {"status": "sent", "address": "1/2/3", "dpt": "1.001"}
    bus["send"].assert_awaited_once_with("1/2/3", True, "1.001")


def test_write_takes_the_dpt_from_the_project(bus):
    project = {"group_addresses": {"1/2/3": {"dpt": {"main": 9, "sub": 1}}, "1/2/4": {"dpt": {"main": 1, "sub": None}}}}
    with patch.object(knx_daemon, "global_knx_project", project):
        assert client.post("/api/v1/knx/write", json={"address": "1/2/3", "value": 21.5}).json()["dpt"] == "9.001"
        assert client.post("/api/v1/knx/write", json={"address": "1/2/4", "value": True}).json()["dpt"] == "1"
        # An explicit DPT wins; an address the project does not know is sent raw.
        assert client.post("/api/v1/knx/write", json={**WRITE, "dpt": "5.001"}).json()["dpt"] == "5.001"
        assert client.post("/api/v1/knx/write", json={"address": "9/9/9", "value": 1}).json()["dpt"] is None


def test_write_reports_a_bad_value_as_400(bus):
    bus["send"].side_effect = ValueError("Unknown DPT type: 99.999")
    response = client.post("/api/v1/knx/write", json={**WRITE, "dpt": "99.999"})
    assert response.status_code == 400
    assert "99.999" in response.json()["detail"]


def test_read_returns_the_answer(bus):
    response = client.post("/api/v1/knx/read", json={"address": "1/2/3", "dpt": "9.001"})
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "address": "1/2/3", "dpt": "9.001", "value": 21.5}
    bus["read_response"].assert_awaited_once_with("1/2/3", "9.001")


def test_read_returns_plain_json_for_decoded_types(bus):
    from xknx.dpt.dpt_1 import Switch

    bus["read_response"].return_value = (True, Switch.ON)
    assert client.post("/api/v1/knx/read", json={"address": "1/2/3", "dpt": "1.001"}).json()["value"] is True
    bus["read_response"].return_value = (True, (12, 51))
    assert client.post("/api/v1/knx/read", json={"address": "1/2/3"}).json()["value"] == [12, 51]


def test_read_without_an_answer_is_a_504(bus):
    bus["read_response"].return_value = (False, None)
    assert client.post("/api/v1/knx/read", json={"address": "1/2/3"}).status_code == 504


def test_read_without_waiting_only_triggers_the_read(bus):
    response = client.post("/api/v1/knx/read", json={"address": "1/2/3", "wait": False})
    assert response.json() == {"status": "sent", "address": "1/2/3"}
    bus["read"].assert_awaited_once_with("1/2/3")
    bus["read_response"].assert_not_awaited()


def test_the_bus_guards_apply():
    with patch.object(knx_daemon, "ALLOW_WRITE", False):
        assert client.post("/api/v1/knx/write", json=WRITE).status_code == 403
        assert client.post("/api/v1/knx/read", json={"address": "1/2/3"}).status_code == 403
    with patch.object(knx_daemon, "ALLOW_WRITE", True), patch.object(knx_daemon, "is_connected", return_value=False):
        assert client.post("/api/v1/knx/write", json=WRITE).status_code == 409


# ── Access ───────────────────────────────────────────────────────────────────


def test_open_while_no_auth_is_configured(bus):
    assert client.post("/api/v1/knx/write", json=WRITE).status_code == 200


def test_with_login_on_the_token_gets_in_without_a_session(bus):
    _enable_login()
    token = client.post("/api/auth/api-token").json()["token"]
    client.cookies.clear()

    assert client.post("/api/v1/knx/write", json=WRITE).status_code == 401
    assert client.post("/api/v1/knx/write", json=WRITE, headers=_bearer("wrong")).status_code == 401
    assert client.post("/api/v1/knx/write", json=WRITE, headers=_bearer(token)).status_code == 200
    bus["send"].assert_awaited_once()


def test_the_token_opens_nothing_but_the_external_api(bus):
    _enable_login()
    token = client.post("/api/auth/api-token").json()["token"]
    client.cookies.clear()

    for path in ("/api/server/config", "/api/telegrams", "/api/auth/users"):
        assert client.get(path, headers=_bearer(token)).status_code == 401
    assert client.post("/api/knx/send", json={**WRITE, "payload": True}, headers=_bearer(token)).status_code == 401
    assert client.post("/api/auth/api-token", headers=_bearer(token)).status_code == 401


def test_a_session_still_works_with_login_on(bus):
    _enable_login()
    assert client.post("/api/v1/knx/write", json=WRITE).status_code == 200


def test_with_login_on_and_no_token_a_session_is_needed(bus):
    _enable_login()
    client.cookies.clear()
    assert client.post("/api/v1/knx/write", json=WRITE).status_code == 401


def test_a_token_is_required_once_set_even_with_login_off(bus, monkeypatch):
    monkeypatch.setenv("AUTH_API_TOKEN", "env-supplied-token")
    assert auth.ui_auth_enabled() is False
    assert client.post("/api/v1/knx/write", json=WRITE).status_code == 401
    assert client.post("/api/v1/knx/write", json=WRITE, headers=_bearer("env-supplied-token")).status_code == 200
    # The rest of an install without login stays as open as it was.
    assert client.get("/api/server/config").status_code == 200


def test_the_mcp_token_is_not_an_api_token(bus):
    _enable_login()
    mcp_token = client.post("/api/auth/mcp-token").json()["token"]
    client.post("/api/auth/api-token")
    client.cookies.clear()
    assert client.post("/api/v1/knx/write", json=WRITE, headers=_bearer(mcp_token)).status_code == 401


# ── Token management ─────────────────────────────────────────────────────────


def test_token_is_stored_hashed_and_reported_in_status():
    _enable_login()
    assert client.get("/api/auth/status").json()["api_token_required"] is False
    token = client.post("/api/auth/api-token").json()["token"]

    stored = json.loads(open(auth.auth_file(), encoding="utf-8").read())
    assert token not in json.dumps(stored)
    assert stored["api_token"]["algo"] == "sha256"
    assert client.get("/api/auth/status").json()["api_token_required"] is True

    assert client.delete("/api/auth/api-token").status_code == 200
    assert auth.verify_api_token(token) is False
    assert client.get("/api/auth/status").json()["api_token_required"] is False


def test_regenerating_invalidates_the_old_token():
    _enable_login()
    old = client.post("/api/auth/api-token").json()["token"]
    new = client.post("/api/auth/api-token").json()["token"]
    assert auth.verify_api_token(old) is False
    assert auth.verify_api_token(new) is True


def test_env_token_cannot_be_managed_from_the_ui(monkeypatch):
    _enable_login()
    monkeypatch.setenv("AUTH_API_TOKEN", "env-supplied-token")
    status = client.get("/api/auth/status").json()
    assert status["api_token_required"] is True and status["api_token_env"] is True
    assert client.post("/api/auth/api-token").status_code == 409
    assert client.delete("/api/auth/api-token").status_code == 409


def test_token_management_requires_a_session():
    _enable_login()
    client.cookies.clear()
    assert client.post("/api/auth/api-token").status_code == 401
    assert client.delete("/api/auth/api-token").status_code == 401


# ── Daemon helpers ───────────────────────────────────────────────────────────


def _answer(payload):
    from xknx.telegram import Telegram
    from xknx.telegram.address import GroupAddress
    from xknx.telegram.apci import GroupValueResponse

    return Telegram(destination_address=GroupAddress("1/2/3"), payload=GroupValueResponse(payload))


def test_read_group_value_response_decodes_with_the_dpt():
    from xknx.dpt import DPTArray, DPTBinary

    read = lambda *args: asyncio.run(knx_daemon.read_group_value_response(*args))  # noqa: E731

    with patch.object(knx_daemon, "xknx_instance", object()), patch.object(knx_daemon, "ValueReader") as reader:
        reader.return_value.read = AsyncMock(return_value=_answer(DPTArray((0x0C, 0x33))))
        assert read("1/2/3", "9.001") == (True, 21.5)
        # Without a DPT the raw payload comes back.
        assert read("1/2/3") == (True, (0x0C, 0x33))

        reader.return_value.read = AsyncMock(return_value=_answer(DPTBinary(1)))
        responded, value = read("1/2/3", "1.001")
        assert responded and value.value is True  # an enum, Switch.ON

        reader.return_value.read = AsyncMock(return_value=None)
        assert read("1/2/3") == (False, None)

        with pytest.raises(ValueError, match="Unknown DPT"):
            read("1/2/3", "99.999")


def test_read_group_value_response_needs_a_connection():
    with patch.object(knx_daemon, "xknx_instance", None), pytest.raises(RuntimeError):
        asyncio.run(knx_daemon.read_group_value_response("1/2/3"))
