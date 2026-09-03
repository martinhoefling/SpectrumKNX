"""Request gating for optional authentication (#451).

A pure ASGI middleware rather than per-route dependencies, so that WebSocket
connections and the mounted MCP app are covered by the same rules as the REST
API — there is no route to forget to decorate.
"""

import json
import os
from collections.abc import Awaitable, Callable
from http.cookies import SimpleCookie
from typing import Any

import auth

# Reachable without a session even when UI auth is on.
#
# The health endpoints are documented Kubernetes probes and probes send no
# credentials; locking them would report a healthy instance as down. /api/version
# is what the UI uses to render before anyone logs in, and the auth endpoints
# below are how you log in at all.
_OPEN_PREFIXES = (
    "/health",
    "/api/health",
    "/api/version",
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/enable",
)

# Paths the API owns. Anything else is the single-page app and its assets, which
# are served freely — they only render a login screen.
_GUARDED_PREFIXES = ("/api/", "/ws/")


def _is_open(path: str) -> bool:
    """Exact match or a path segment beneath it.

    Not a bare startswith: that would also open anything merely *prefixed* by
    one of these names, e.g. "/api/versions-of-everything".
    """
    return any(path == prefix or path.startswith(prefix + "/") for prefix in _OPEN_PREFIXES)


def _session_token(scope: dict[str, Any]) -> str | None:
    for name, value in scope.get("headers") or []:
        if name == b"cookie":
            cookie = SimpleCookie()
            cookie.load(value.decode("latin-1"))
            morsel = cookie.get(auth.SESSION_COOKIE)
            return morsel.value if morsel else None
    return None


def _bearer(scope: dict[str, Any]) -> str | None:
    for name, value in scope.get("headers") or []:
        if name == b"authorization":
            raw = value.decode("latin-1")
            if raw.lower().startswith("bearer "):
                return raw[7:].strip()
    return None


def peer_of(scope: dict[str, Any]) -> str:
    client = scope.get("client")
    return client[0] if client else ""


class AuthMiddleware:
    def __init__(self, app: Callable[..., Awaitable[None]]) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")

        # The MCP endpoint has its own token, independent of UI login.
        if path == "/mcp" or path.startswith("/mcp/"):
            if auth.mcp_token_required() and not auth.verify_mcp_token(_bearer(scope)):
                await self._reject(scope, send, 401, "MCP token required")
                return
            await self.app(scope, receive, send)
            return

        if not auth.ui_auth_enabled():
            await self.app(scope, receive, send)
            return
        if not any(path.startswith(prefix) for prefix in _GUARDED_PREFIXES):
            await self.app(scope, receive, send)
            return
        if _is_open(path):
            await self.app(scope, receive, send)
            return

        # Home Assistant has already authenticated ingress users, and the add-on
        # is admin-only (panel_admin). Decided by peer address, never a header.
        if auth.is_ingress_peer(peer_of(scope)):
            await self.app(scope, receive, send)
            return

        if auth.session_user(_session_token(scope)):
            await self.app(scope, receive, send)
            return

        await self._reject(scope, send, 401, "Authentication required")

    async def _reject(self, scope: dict[str, Any], send: Any, status: int, detail: str) -> None:
        if scope["type"] == "websocket":
            # Refuse the handshake outright; 1008 is "policy violation".
            await send({"type": "websocket.close", "code": 1008})
            return
        body = json.dumps({"detail": detail}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


def cookie_kwargs() -> dict[str, Any]:
    """Session cookie flags.

    Secure is off by default: these installs are usually plain HTTP on a LAN and
    a Secure cookie would simply never be sent. AUTH_COOKIE_SECURE turns it on
    for deployments behind HTTPS.
    """
    secure = (os.getenv("AUTH_COOKIE_SECURE", "").strip().lower()) in ("1", "true", "yes", "on")
    return {"httponly": True, "samesite": "lax", "secure": secure, "path": "/"}
