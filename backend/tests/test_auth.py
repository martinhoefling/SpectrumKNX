"""Tests for optional UI/MCP authentication (#451)."""

import json
import os
import stat

import pytest
from fastapi.testclient import TestClient

import auth
from main import app

client = TestClient(app)
PASSWORD = "correct horse battery"


@pytest.fixture(autouse=True)
def _isolated_state(tmp_path, monkeypatch):
    """Point auth state at a temp dir and clear in-memory state between tests."""
    monkeypatch.setenv("AUTH_STATE_DIR", str(tmp_path))
    monkeypatch.delenv("AUTH_UI_ENABLED", raising=False)
    monkeypatch.delenv("AUTH_MCP_TOKEN", raising=False)
    monkeypatch.delenv("SUPERVISOR_TOKEN", raising=False)
    monkeypatch.delenv("AUTH_INGRESS_PEER", raising=False)
    auth._reset_for_tests()
    yield
    auth._reset_for_tests()


def _enable(username="admin", password=PASSWORD):
    return client.post("/api/auth/enable", json={"username": username, "password": password})


# ── Off by default ───────────────────────────────────────────────────────────


def test_disabled_by_default_leaves_the_api_open():
    assert auth.ui_auth_enabled() is False
    assert client.get("/api/version").status_code == 200
    assert client.get("/api/server/config").status_code == 200


def test_status_reports_unconfigured():
    body = client.get("/api/auth/status").json()
    assert body["ui_auth_enabled"] is False
    assert body["configured"] is False
    assert body["mcp_token_required"] is False


# ── Enabling ─────────────────────────────────────────────────────────────────


def test_enabling_creates_the_admin_in_the_same_step():
    """There must be no window in which auth is on with no owner (#451)."""
    response = _enable()
    assert response.status_code == 200
    assert auth.ui_auth_enabled() is True
    assert auth.usernames() == ["admin"]
    # The caller is logged in immediately, so they cannot lock themselves out.
    assert response.cookies.get(auth.SESSION_COOKIE)


def test_enabling_twice_is_refused():
    _enable()
    assert _enable().status_code == 409


def test_enable_rejects_a_short_password():
    assert _enable(password="short").status_code == 422


def test_username_is_normalised():
    _enable(username="  AdMiN  ")
    assert auth.usernames() == ["admin"]


# ── Forced-on with no account (the vuln.md finding) ──────────────────────────


def test_anonymous_cannot_claim_the_admin_account_when_login_is_forced_on(monkeypatch):
    """The reported authentication bypass.

    With AUTH_UI_ENABLED=true and no account yet, /api/auth/enable used to be
    unconditionally open, so any anonymous caller who could reach the port
    created the admin account and was handed a session — while every other route
    correctly returned 401 and the UI reported "Login: Required".
    """
    monkeypatch.setenv("AUTH_UI_ENABLED", "true")
    client.cookies.clear()
    assert auth.ui_auth_enabled() is True
    assert auth.usernames() == []

    # Everything else is locked...
    assert client.get("/api/server/config").status_code == 401
    # ...and so is this, now.
    response = client.post("/api/auth/enable", json={"username": "attacker", "password": "hunter2hunter2"})
    assert response.status_code == 401, response.text
    assert auth.usernames() == [], "an anonymous caller created an account"
    assert client.get("/api/server/config").status_code == 401


def test_ingress_can_still_create_the_first_account_when_forced_on(monkeypatch):
    """The operator must not be locked out by the fix above.

    In the add-on, Home Assistant has already authenticated an admin, so setup
    over ingress has to keep working even with the flag forced on — otherwise
    turning the option on before creating an account would be unrecoverable
    from the UI.
    """
    monkeypatch.setenv("AUTH_UI_ENABLED", "true")
    monkeypatch.setenv("SUPERVISOR_TOKEN", "token")
    monkeypatch.setenv("AUTH_INGRESS_PEER", "testclient")
    client.cookies.clear()

    response = client.post("/api/auth/enable", json={"username": "admin", "password": PASSWORD})
    assert response.status_code == 200, response.text
    assert auth.usernames() == ["admin"]


def test_setup_still_open_when_login_is_off():
    """First-run setup on a normal install is unaffected."""
    client.cookies.clear()
    assert auth.ui_auth_enabled() is False
    assert _enable().status_code == 200


def test_enable_never_discards_existing_accounts():
    """It used to assign users wholesale, so this would have wiped them."""
    _enable()
    client.post("/api/auth/users", json={"username": "bob", "password": PASSWORD})
    auth.disable()  # login off, accounts kept
    client.cookies.clear()

    # Re-enabling touches the flag only.
    response = client.post("/api/auth/enable", json={"username": "attacker", "password": "hunter2hunter2"})
    assert response.status_code == 200, response.text
    assert set(auth.usernames()) == {"admin", "bob"}
    assert "attacker" not in auth.usernames()
    assert auth.ui_auth_enabled() is True


def test_enable_is_refused_once_login_is_on_and_an_account_exists():
    """Unchanged behaviour — this case was already correct."""
    _enable()
    assert client.post("/api/auth/enable", json={"username": "x", "password": PASSWORD}).status_code == 409


# ── Protection ───────────────────────────────────────────────────────────────


def test_api_requires_a_session_once_enabled():
    _enable()
    client.cookies.clear()
    assert client.get("/api/server/config").status_code == 401


def test_health_and_version_stay_open():
    """Kubernetes probes send no credentials (DEPLOYMENT.md §8).

    Asserted as "not 401" rather than "200": a probe may legitimately report
    503 when the database is down (as it is here), and that is a health answer
    rather than an authentication one. Locking these would make a healthy
    instance look dead to Kubernetes.
    """
    _enable()
    client.cookies.clear()
    for path in (
        "/health",
        "/api/health",
        "/health/liveness",
        "/api/health/liveness",
        "/health/readiness",
        "/api/health/readiness",
        "/api/version",
    ):
        assert client.get(path).status_code != 401, path
    assert client.get("/api/version").status_code == 200


def test_open_prefixes_do_not_leak_to_similar_paths():
    """ "/api/version" being open must not open "/api/versionsomething"."""
    from auth_middleware import _is_open

    assert _is_open("/api/version")
    assert _is_open("/api/health/liveness")
    assert not _is_open("/api/versions-of-everything")
    assert not _is_open("/api/authx")


def test_login_then_access():
    _enable()
    client.cookies.clear()
    assert client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD}).status_code == 200
    assert client.get("/api/server/config").status_code == 200


def test_logout_revokes_the_session():
    _enable()
    assert client.get("/api/server/config").status_code == 200
    client.post("/api/auth/logout")
    assert client.get("/api/server/config").status_code == 401


def test_wrong_password_is_rejected():
    _enable()
    client.cookies.clear()
    assert client.post("/api/auth/login", json={"username": "admin", "password": "wrongwrong"}).status_code == 401


def test_websocket_handshake_is_refused_without_a_session():
    _enable()
    client.cookies.clear()
    with pytest.raises(Exception):  # noqa: B017 - starlette raises on a rejected handshake
        with client.websocket_connect("/ws/telegrams"):
            pass


# ── The ingress bypass ───────────────────────────────────────────────────────


def test_ingress_peer_grants_access(monkeypatch):
    """HA has already authenticated the user; the add-on is admin-only."""
    _enable()
    client.cookies.clear()
    monkeypatch.setenv("SUPERVISOR_TOKEN", "token")
    monkeypatch.setenv("AUTH_INGRESS_PEER", "testclient")  # TestClient's peer
    assert client.get("/api/server/config").status_code == 200


def test_forged_forwarded_headers_do_not_grant_the_bypass(monkeypatch):
    """Regression guard for the bypass this design turns on (#451).

    Any client can send these headers. They must never stand in for the TCP
    peer address. This test fails if uvicorn is ever started with
    --proxy-headers, which would let X-Forwarded-For overwrite the peer.
    """
    _enable()
    client.cookies.clear()
    monkeypatch.setenv("SUPERVISOR_TOKEN", "token")
    forged = {
        "X-Forwarded-For": auth.ingress_peer(),
        "X-Real-IP": auth.ingress_peer(),
        "X-Ingress-Path": "/api/hassio_ingress/abc123",
    }
    assert client.get("/api/server/config", headers=forged).status_code == 401


def test_ingress_bypass_needs_the_supervisor_environment(monkeypatch):
    """Outside the add-on the address alone means nothing."""
    _enable()
    client.cookies.clear()
    monkeypatch.delenv("SUPERVISOR_TOKEN", raising=False)
    monkeypatch.setenv("AUTH_INGRESS_PEER", "testclient")
    assert client.get("/api/server/config").status_code == 401


# ── MCP token ────────────────────────────────────────────────────────────────


def test_mcp_is_open_until_a_token_is_set():
    assert auth.mcp_token_required() is False
    assert client.post("/mcp", follow_redirects=False).status_code == 307


def test_mcp_requires_the_token_once_set():
    _enable()
    token = client.post("/api/auth/mcp-token").json()["token"]
    assert auth.mcp_token_required() is True

    assert client.post("/mcp/", follow_redirects=False).status_code == 401
    assert client.post("/mcp/", headers={"Authorization": "Bearer wrong"}, follow_redirects=False).status_code == 401
    # The valid token is checked at the gate rather than over HTTP: a request
    # that gets past the middleware reaches the MCP app, which needs the
    # session manager started by the app lifespan.
    assert auth.verify_mcp_token(token) is True
    assert auth.verify_mcp_token("wrong") is False


def test_mcp_token_is_stored_hashed_only():
    _enable()
    token = client.post("/api/auth/mcp-token").json()["token"]
    stored = json.loads((open(auth.auth_file(), encoding="utf-8")).read())
    assert token not in json.dumps(stored)
    assert stored["mcp_token"]["algo"] == "sha256"


def test_mcp_token_from_the_environment_wins(monkeypatch):
    monkeypatch.setenv("AUTH_MCP_TOKEN", "env-supplied-token")
    assert auth.mcp_token_required() is True
    assert auth.verify_mcp_token("env-supplied-token") is True
    assert auth.verify_mcp_token("something-else") is False


def test_mcp_token_is_independent_of_ui_auth():
    """Either switch works without the other."""
    auth.new_mcp_token()
    assert auth.mcp_token_required() is True
    assert auth.ui_auth_enabled() is False
    assert client.get("/api/server/config").status_code == 200


# ── Recovery ─────────────────────────────────────────────────────────────────


def test_env_override_disables_login_without_touching_the_file(monkeypatch):
    """The documented way back in after losing a password (#451)."""
    _enable()
    client.cookies.clear()
    assert client.get("/api/server/config").status_code == 401

    monkeypatch.setenv("AUTH_UI_ENABLED", "false")
    assert client.get("/api/server/config").status_code == 200
    # Accounts and the stored setting survive, so re-enabling needs no re-setup.
    assert auth.usernames() == ["admin"]
    assert json.loads(open(auth.auth_file(), encoding="utf-8").read())["ui_auth_enabled"] is True
    assert client.get("/api/auth/status").json()["ui_auth_forced_off"] is True


def test_deleting_the_state_file_resets_everything():
    _enable()
    os.unlink(auth.auth_file())
    auth._reset_for_tests()
    assert auth.ui_auth_enabled() is False
    assert auth.usernames() == []


def test_json_that_is_not_an_object_is_treated_as_unconfigured():
    """A valid-JSON non-object used to raise AttributeError on every request,
    including /api/auth/status, taking the app down rather than degrading."""
    _enable()
    for content in ("[]", '"nope"', "3"):
        with open(auth.auth_file(), "w", encoding="utf-8") as handle:
            handle.write(content)
        assert auth.ui_auth_enabled() is False
        assert auth.usernames() == []
        assert client.get("/api/auth/status").status_code == 200


def test_a_corrupt_state_file_does_not_fail_open_into_a_broken_state():
    _enable()
    with open(auth.auth_file(), "w", encoding="utf-8") as handle:
        handle.write("{not json")
    # Unreadable state is treated as unconfigured, so the documented recovery
    # (delete the file) applies rather than the app becoming unusable.
    assert auth.ui_auth_enabled() is False


# ── Storage details ──────────────────────────────────────────────────────────


def test_state_file_is_owner_only():
    _enable()
    mode = stat.S_IMODE(os.stat(auth.auth_file()).st_mode)
    assert mode == 0o600, oct(mode)


def test_no_password_material_is_written_in_the_clear():
    _enable()
    contents = open(auth.auth_file(), encoding="utf-8").read()
    assert PASSWORD not in contents
    assert "scrypt" in contents


def test_state_dir_follows_the_project_path(monkeypatch):
    monkeypatch.delenv("AUTH_STATE_DIR", raising=False)
    monkeypatch.setenv("KNX_PROJECT_PATH", "/var/lib/spectrum-knx/knx_project.knxproj")
    assert auth.state_dir() == "/var/lib/spectrum-knx"
    monkeypatch.delenv("KNX_PROJECT_PATH", raising=False)
    assert auth.state_dir() == "/project"


def test_hash_records_its_own_cost_parameters():
    """So the cost can be raised later without invalidating existing hashes."""
    record = auth.hash_password(PASSWORD)
    assert record["n"] == 2**14 and record["r"] == 8 and record["p"] == 1
    assert auth.verify_password(record, PASSWORD) is True
    assert auth.verify_password(record, "wrong password") is False

    # A record written with different parameters still verifies against them.
    weaker = auth.hash_password(PASSWORD)
    weaker.update({"n": 2**12})
    weaker["hash"] = (
        __import__("base64")
        .b64encode(
            __import__("hashlib").scrypt(
                PASSWORD.encode(), salt=__import__("base64").b64decode(weaker["salt"]), n=2**12, r=8, p=1, dklen=32
            )
        )
        .decode()
    )
    assert auth.verify_password(weaker, PASSWORD) is True


# ── Users ────────────────────────────────────────────────────────────────────


def test_add_and_remove_users():
    _enable()
    assert client.post("/api/auth/users", json={"username": "bob", "password": PASSWORD}).status_code == 200
    assert set(client.get("/api/auth/users").json()["users"]) == {"admin", "bob"}
    assert client.delete("/api/auth/users/bob").status_code == 200
    assert client.get("/api/auth/users").json()["users"] == ["admin"]


def test_cannot_delete_the_last_user_while_enabled():
    """Otherwise auth would be on with nobody able to log in."""
    _enable()
    response = client.delete("/api/auth/users/admin")
    assert response.status_code == 400
    assert "last user" in response.json()["detail"]


def test_changing_password_invalidates_nothing_but_works_for_login():
    _enable()
    assert client.post("/api/auth/password", json={"password": "a new long password"}).status_code == 200
    client.post("/api/auth/logout")
    client.cookies.clear()
    assert client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD}).status_code == 401
    assert (
        client.post("/api/auth/login", json={"username": "admin", "password": "a new long password"}).status_code == 200
    )


def test_user_management_requires_a_session():
    _enable()
    client.cookies.clear()
    assert client.get("/api/auth/users").status_code == 401
    assert client.post("/api/auth/users", json={"username": "x", "password": PASSWORD}).status_code == 401
    assert client.post("/api/auth/mcp-token").status_code == 401


# ── Throttling ───────────────────────────────────────────────────────────────


def test_repeated_failures_are_throttled():
    _enable()
    client.cookies.clear()
    for _ in range(5):
        client.post("/api/auth/login", json={"username": "admin", "password": "wrongwrong"})
    # Even the correct password is refused while locked out, so scrypt's cost
    # cannot be used as a denial-of-service lever.
    response = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD})
    assert response.status_code == 429
