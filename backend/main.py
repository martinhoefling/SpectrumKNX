import logging
import os
from contextlib import asynccontextmanager, nullcontext

from dotenv import load_dotenv

# Load environment variables from .env file if it exists
load_dotenv()

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

import cyclic_send  # noqa: E402
import mcp_server  # noqa: E402
from api import get_backend_version  # noqa: E402
from api import router as api_router  # noqa: E402
from database import READ_ONLY, engine  # noqa: E402
from ha_live_bridge import companion_shutdown, companion_startup  # noqa: E402
from knx_daemon import knx_shutdown, knx_startup  # noqa: E402
from security import is_safe_path  # noqa: E402

logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    version = get_backend_version()
    logger.info(f"Starting Spectrum KNX Backend (Version: {version})")
    if READ_ONLY:
        # Companion mode: no KNX daemon — another process (Home Assistant)
        # owns the bus connection and writes the store we read.
        await companion_startup()
    else:
        await knx_startup()

    # The MCP endpoint's session manager must run for the app's lifetime while
    # its ASGI app is mounted (a nullcontext keeps this a no-op when disabled).
    mcp_ctx = mcp_server.session_manager_run() if mcp_server.mcp_enabled() else nullcontext()
    async with mcp_ctx:
        yield

    # Shutdown
    if READ_ONLY:
        await companion_shutdown()
    else:
        await cyclic_send.shutdown()
        await knx_shutdown()
    await engine.dispose()


app = FastAPI(title="Spectrum KNX API", lifespan=lifespan)

# CORS configuration: default to "*" to preserve existing behavior across deployments
cors_origins_raw = os.getenv("CORS_ORIGINS", "*")
cors_origins = [origin.strip() for origin in cors_origins_raw.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

# Mount the MCP Streamable HTTP endpoint before the SPA catch-all so /mcp is not
# swallowed by static routing (#332). Disabled when MCP_MODE=off.
if mcp_server.mcp_enabled():
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
