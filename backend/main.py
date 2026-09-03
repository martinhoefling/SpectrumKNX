import logging
import os
from contextlib import asynccontextmanager, nullcontext

from dotenv import load_dotenv

# Load environment variables from .env file if it exists
load_dotenv()

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse, RedirectResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

import cyclic_send  # noqa: E402
import mcp_server  # noqa: E402
import pg_listen_bridge  # noqa: E402
from api import get_backend_version  # noqa: E402
from api import router as api_router  # noqa: E402
from auth_middleware import AuthMiddleware, cors_allow_credentials  # noqa: E402
from database import STORE_MODE, engine  # noqa: E402
from ha_live_bridge import companion_shutdown, companion_startup  # noqa: E402
from knx_daemon import knx_shutdown, knx_startup  # noqa: E402
from security import is_safe_path  # noqa: E402

logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    version = get_backend_version()
    logger.info(f"Starting Spectrum KNX Backend (Version: {version})")
    if STORE_MODE == "external-readonly":
        # Sqlite companion mode: no KNX daemon — another process (Home
        # Assistant) owns the bus connection and writes the store we read.
        await companion_startup()
    elif STORE_MODE == "postgres-readonly":
        # Shared-Postgres companion mode: our own daemon still connects to
        # the bus (for writes), but never touches the store — the writer
        # already does. Live updates come from LISTEN/NOTIFY instead.
        await knx_startup()
        await pg_listen_bridge.postgres_listen_startup()
    else:
        await knx_startup()

    # The MCP endpoint's session manager must run for the app's lifetime while
    # its ASGI app is mounted (a nullcontext keeps this a no-op when disabled).
    mcp_ctx = mcp_server.session_manager_run() if mcp_server.mcp_enabled() else nullcontext()
    async with mcp_ctx:
        yield

    # Shutdown
    if STORE_MODE == "external-readonly":
        await companion_shutdown()
    elif STORE_MODE == "postgres-readonly":
        await pg_listen_bridge.postgres_listen_shutdown()
        await cyclic_send.shutdown()
        await knx_shutdown()
    else:
        await cyclic_send.shutdown()
        await knx_shutdown()
    await engine.dispose()


app = FastAPI(title="Spectrum KNX API", lifespan=lifespan)

# CORS configuration: default to "*" to preserve existing behavior across deployments
cors_origins_raw = os.getenv("CORS_ORIGINS", "*")
cors_origins = [origin.strip() for origin in cors_origins_raw.split(",") if origin.strip()]

# Credentials are only offered to an explicit allow-list. Pairing them with "*"
# is the classic dangerous combination: Starlette's CORSMiddleware echoes the
# request Origin and adds Access-Control-Allow-Credentials, so any website could
# read authenticated responses. Today that is neutralised only by the session
# cookie's SameSite=Lax — which means anyone loosening the cookie (to embed the
# UI in an iframe, say) would silently turn this into cross-origin account
# takeover, with nothing to connect the two changes. Decoupling them here (#453).
#
# Nothing in-tree needs credentialed cross-origin requests: the UI is served from
# the same origin, and dev mode goes through Vite's proxy.
allow_credentials = cors_allow_credentials(cors_origins)
if not allow_credentials:
    logger.info(
        "CORS: wildcard origin — credentialed cross-origin requests are refused. Set CORS_ORIGINS to allow them."
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

# Optional authentication (#451). A pure ASGI middleware so WebSocket
# connections and the mounted MCP app are gated by the same rules as the REST
# API — no route can be forgotten. Inert unless auth is switched on.
#
# NOTE: this relies on scope["client"] being the real TCP peer, which is how the
# Home Assistant ingress bypass is identified. uvicorn's ProxyHeadersMiddleware
# is on by default and rewrites that from X-Forwarded-For for callers in
# forwarded_allow_ips (default 127.0.0.1), so the trust boundary is that
# allow-list. Widening it — --forwarded-allow-ips, FORWARDED_ALLOW_IPS, or a
# reverse proxy in front — means revisiting auth.is_ingress_peer, because the
# peer address stops being something a client cannot choose.
app.add_middleware(AuthMiddleware)

# Mount the MCP Streamable HTTP endpoint before the SPA catch-all so /mcp is not
# swallowed by static routing (#332). Disabled when MCP_MODE=off.
if mcp_server.mcp_enabled():

    @app.api_route("/mcp", methods=["GET", "POST", "DELETE", "OPTIONS", "HEAD"], include_in_schema=False)
    async def mcp_root_redirect(request: Request):
        """Redirect the bare /mcp to /mcp/ (#426).

        Starlette compiles a Mount path into ``^/mcp(?P<path>/.*)$``, so the
        mount below never matches the bare "/mcp" — without this the request
        falls through to the SPA catch-all and an MCP client's POST gets a
        confusing 405 (the catch-all is GET-only) while a browser gets
        index.html. Router-level redirect_slashes can't help because the
        catch-all always matches. 307 preserves the method and body, so the
        client's initialize POST survives the redirect.
        """
        target = request.url.path + "/"
        if request.url.query:
            target = f"{target}?{request.url.query}"
        return RedirectResponse(target, status_code=307)

    app.mount("/mcp", mcp_server.get_asgi_app())
    logger.info(f"MCP endpoint mounted at /mcp (mode: {mcp_server.MCP_MODE})")

# Serve static files in production
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # If the path looks like a file (has an extension), but wasn't caught by /assets,
        # it might be a missing file. Otherwise, serve index.html for SPA routing.
        requested_path = os.path.join(STATIC_DIR, full_path)
        if full_path and os.path.isfile(requested_path):
            if is_safe_path(STATIC_DIR, full_path):
                return FileResponse(requested_path)

        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
else:

    @app.get("/")
    def read_root():
        return {"status": "ok", "app": "Spectrum KNX (Dev Mode)"}
