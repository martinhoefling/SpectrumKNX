"""Optional authentication for the web UI and the MCP endpoint (#451).

Off by default: with nothing configured the application behaves exactly as it
always has. Two switches, independent of each other:

- **UI users** — username/password login guarding the web interface and its API.
- **MCP token** — a bearer token guarding ``/mcp``, which is otherwise open.

State lives in ``auth.json`` in the state directory, never in the database: the
telegram store is read-only in companion and postgres-readonly modes, and a file
keeps login working when the database is unreachable — which is exactly when you
might need to log in and look.

Passwords are stretched with :func:`hashlib.scrypt` from the standard library.
The MCP token is only SHA-256'd: it is 32 random bytes, so there is nothing to
brute-force, and scrypt would add ~50 ms to *every* MCP request.
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from typing import Any

logger = logging.getLogger("uvicorn.error")

SESSION_COOKIE = "spectrumknx_session"

# scrypt cost. ~52 ms and 16 MiB per verification. Stored per user record so it
# can be raised later without invalidating existing hashes.
#
# Do not raise N past 2**14 without also passing maxmem: OpenSSL's default limit
# is 32 MB and 2**15 needs more than that, failing with
# "memory limit exceeded" rather than anything self-explanatory.
_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_DKLEN = 32

# Home Assistant's Supervisor proxies ingress from this address. Its add-on
# documentation states "Only connections from 172.30.32.2 must be allowed", so
# this is the sanctioned check — the X-Ingress-Path header is *not* an
# authentication signal and is never treated as one.
_DEFAULT_INGRESS_PEER = "172.30.32.2"


def ingress_peer() -> str:
    """The address ingress is expected to come from.

    Configurable because the address observed under host networking has not been
    confirmed on real hardware; a mismatch should be fixable by configuration
    rather than a code change.
    """
    return os.getenv("AUTH_INGRESS_PEER", _DEFAULT_INGRESS_PEER)


# Login throttling: after this many failures from one address, refuse for a
# while. Enough to make scrypt's cost a defence rather than a DoS lever.
_MAX_FAILURES = 5
_FAILURE_WINDOW = 300.0
_LOCKOUT = 60.0

# Sessions are in memory: no per-request disk writes, and a restart simply means
# logging in again.
_sessions: dict[str, str] = {}
_failures: dict[str, tuple[int, float]] = {}


# ── State file ────────────────────────────────────────────────────────────────


def state_dir() -> str:
    """Directory holding auth state.

    The same place the ETS project and its password/metadata sidecars live, so
    it is writable and included in backups in every deployment: /project for
    Docker and the add-on (symlinked to /data/project there), and
    /var/lib/spectrum-knx for the Debian package via KNX_PROJECT_PATH.
    """
    override = os.getenv("AUTH_STATE_DIR")
    if override:
        return override
    project_path = os.getenv("KNX_PROJECT_PATH")
    if project_path:
        return os.path.dirname(project_path) or "/project"
    return "/project"


def auth_file() -> str:
    return os.path.join(state_dir(), "auth.json")


def _blank() -> dict[str, Any]:
    """Unconfigured state — no accounts, no token, login off."""
    return {"version": 1, "ui_auth_enabled": False, "users": [], "mcp_token": None}


def _load() -> dict[str, Any]:
    try:
        with open(auth_file(), encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        return _blank()
    except (OSError, ValueError) as err:
        # A damaged file must not lock everyone out silently, but it must also
        # not fail open: report it and treat auth as unconfigured so the
        # documented recovery (delete the file) applies.
        logger.error("Could not read %s (%s) — treating authentication as unconfigured", auth_file(), err)
        return _blank()
    if not isinstance(data, dict):
        # Valid JSON that is not an object ("[]", "3", a bare string). Without
        # this the setdefault calls below raise AttributeError on every single
        # request, including /api/auth/status.
        logger.error("%s does not contain a JSON object — treating authentication as unconfigured", auth_file())
        return _blank()
    data.setdefault("users", [])
    data.setdefault("ui_auth_enabled", False)
    data.setdefault("mcp_token", None)
    return data


def _save(data: dict[str, Any]) -> None:
    """Write the state file atomically, owner-readable only.

    Atomic because a torn write during a password change would lock everyone
    out — the one failure this file must not have.
    """
    directory = state_dir()
    os.makedirs(directory, exist_ok=True)
    target = auth_file()
    tmp = target + ".tmp"
    # os.open with an explicit mode so permissions do not depend on the umask.
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        os.unlink(tmp)
        raise
    os.replace(tmp, target)


# ── Password hashing ─────────────────────────────────────────────────────────


def hash_password(password: str) -> dict[str, Any]:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=_SCRYPT_DKLEN)
    return {
        "algo": "scrypt",
        "n": _SCRYPT_N,
        "r": _SCRYPT_R,
        "p": _SCRYPT_P,
        "salt": base64.b64encode(salt).decode(),
        "hash": base64.b64encode(digest).decode(),
    }


def verify_password(record: dict[str, Any], password: str) -> bool:
    """Check a password against a stored record, honouring its own parameters."""
    if not record or record.get("algo") != "scrypt":
        return False
    try:
        salt = base64.b64decode(record["salt"])
        expected = base64.b64decode(record["hash"])
        digest = hashlib.scrypt(
            password.encode(),
            salt=salt,
            n=int(record["n"]),
            r=int(record["r"]),
            p=int(record["p"]),
            dklen=len(expected),
        )
    except (KeyError, ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, expected)


def _normalise(username: str) -> str:
    return username.strip().lower()


# ── UI authentication state ──────────────────────────────────────────────────


def ui_auth_enabled() -> bool:
    """Whether UI login is required.

    AUTH_UI_ENABLED overrides the stored setting, which is the documented way
    back in after losing a password: set it to false, fix the password in the
    UI, then re-enable.
    """
    override = os.getenv("AUTH_UI_ENABLED")
    if override is not None and override.strip() != "":
        return override.strip().lower() in ("1", "true", "yes", "on")
    return bool(_load().get("ui_auth_enabled"))


def ui_auth_forced_off() -> bool:
    """True when the environment is explicitly holding auth off."""
    override = os.getenv("AUTH_UI_ENABLED")
    return override is not None and override.strip().lower() in ("0", "false", "no", "off")


def usernames() -> list[str]:
    return [user["username"] for user in _load().get("users", [])]


def enable_with_admin(username: str, password: str) -> None:
    """Turn UI auth on and create the first account in one step.

    Deliberately atomic: enabling first and creating the account later would
    leave a window in which auth is on with no owner, and whoever arrived first
    would claim it.

    Only valid when no account exists yet. Refusing otherwise matters because
    this used to assign ``data["users"]`` wholesale, so calling it on a
    populated file would have discarded every existing account.
    """
    username = _normalise(username)
    if not username:
        raise ValueError("username must not be empty")
    if len(password) < 8:
        raise ValueError("password must be at least 8 characters")
    data = _load()
    if data.get("users"):
        raise ValueError("an account already exists; enable login from Settings instead")
    data["ui_auth_enabled"] = True
    data["users"] = [{"username": username, "password": hash_password(password), "created_at": _now()}]
    _save(data)
    logger.info("UI authentication enabled; admin user '%s' created", username)


def enable_existing() -> None:
    """Turn UI auth back on for an installation that already has accounts."""
    data = _load()
    if not data.get("users"):
        raise ValueError("no accounts exist yet")
    data["ui_auth_enabled"] = True
    _save(data)
    logger.info("UI authentication enabled")


def disable() -> None:
    """Turn UI auth off, keeping the accounts and the MCP token."""
    data = _load()
    data["ui_auth_enabled"] = False
    _save(data)
    _sessions.clear()
    logger.info("UI authentication disabled")


def add_user(username: str, password: str) -> None:
    username = _normalise(username)
    if not username:
        raise ValueError("username must not be empty")
    if len(password) < 8:
        raise ValueError("password must be at least 8 characters")
    data = _load()
    if any(user["username"] == username for user in data["users"]):
        raise ValueError(f"user '{username}' already exists")
    data["users"].append({"username": username, "password": hash_password(password), "created_at": _now()})
    _save(data)


def delete_user(username: str) -> None:
    username = _normalise(username)
    data = _load()
    remaining = [user for user in data["users"] if user["username"] != username]
    if len(remaining) == len(data["users"]):
        raise ValueError(f"no such user: '{username}'")
    if not remaining and data.get("ui_auth_enabled"):
        # Removing the last account while auth is on would lock everyone out.
        raise ValueError("cannot delete the last user while authentication is enabled")
    data["users"] = remaining
    _save(data)
    for token, holder in list(_sessions.items()):
        if holder == username:
            del _sessions[token]


def change_password(username: str, new_password: str) -> None:
    username = _normalise(username)
    if len(new_password) < 8:
        raise ValueError("password must be at least 8 characters")
    data = _load()
    for user in data["users"]:
        if user["username"] == username:
            user["password"] = hash_password(new_password)
            _save(data)
            return
    raise ValueError(f"no such user: '{username}'")


# ── Login ────────────────────────────────────────────────────────────────────


def throttled(peer: str) -> bool:
    count, first = _failures.get(peer, (0, 0.0))
    if count < _MAX_FAILURES:
        return False
    if time.monotonic() - first > _FAILURE_WINDOW + _LOCKOUT:
        _failures.pop(peer, None)
        return False
    return time.monotonic() - first < _FAILURE_WINDOW + _LOCKOUT


def _record_failure(peer: str) -> None:
    count, first = _failures.get(peer, (0, 0.0))
    now = time.monotonic()
    if count and now - first > _FAILURE_WINDOW:
        count, first = 0, now
    _failures[peer] = (count + 1, first or now)


def login(username: str, password: str, peer: str = "") -> str | None:
    """Verify credentials and return a new session token, or None."""
    username = _normalise(username)
    for user in _load().get("users", []):
        if user["username"] == username and verify_password(user.get("password", {}), password):
            _failures.pop(peer, None)
            token = secrets.token_urlsafe(32)
            _sessions[token] = username
            return token
    _record_failure(peer)
    return None


def session_user(token: str | None) -> str | None:
    return _sessions.get(token) if token else None


def logout(token: str | None) -> None:
    if token:
        _sessions.pop(token, None)


# ── MCP token ────────────────────────────────────────────────────────────────


def mcp_token_required() -> bool:
    if os.getenv("AUTH_MCP_TOKEN"):
        return True
    return bool(_load().get("mcp_token"))


def new_mcp_token() -> str:
    """Generate, store hashed, and return the token — the only time it is visible."""
    token = secrets.token_urlsafe(32)
    data = _load()
    data["mcp_token"] = {
        "algo": "sha256",
        "hash": hashlib.sha256(token.encode()).hexdigest(),
        "created_at": _now(),
    }
    _save(data)
    logger.info("MCP token generated")
    return token


def clear_mcp_token() -> None:
    data = _load()
    data["mcp_token"] = None
    _save(data)
    logger.info("MCP token cleared")


def verify_mcp_token(token: str | None) -> bool:
    if not token:
        return False
    env_token = os.getenv("AUTH_MCP_TOKEN")
    if env_token:
        return hmac.compare_digest(token, env_token)
    record = _load().get("mcp_token") or {}
    stored = record.get("hash")
    if not stored:
        return False
    return hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), stored)


# ── Home Assistant ingress ───────────────────────────────────────────────────


def is_ingress_peer(peer: str | None) -> bool:
    """Whether a request came from Home Assistant's ingress proxy.

    Decided by the TCP peer address, never by a header: any client can send
    X-Ingress-Path or X-Forwarded-For, and neither is consulted here.

    One caveat on the peer address itself. uvicorn enables its
    ProxyHeadersMiddleware **by default** (proxy_headers=True) with
    forwarded_allow_ips defaulting to 127.0.0.1, so a caller connecting *from
    loopback* can set X-Forwarded-For and have the peer address rewritten before
    it reaches here. That needs code execution on the host already — other
    add-ons sit on the Supervisor bridge, not loopback — but it means the trust
    boundary is uvicorn's allow-list, not the absence of a flag. See the backlog
    note on pinning --forwarded-allow-ips in the launchers.
    """
    if not peer:
        return False
    # Only meaningful when we really are an add-on.
    if not os.getenv("SUPERVISOR_TOKEN"):
        return False
    return peer == ingress_peer()


def _now() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).isoformat()


def _reset_for_tests() -> None:
    _sessions.clear()
    _failures.clear()
