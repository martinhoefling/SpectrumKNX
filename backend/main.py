import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from api import router as api_router
from database import engine
from knx_daemon import knx_shutdown, knx_startup


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await knx_startup()
    yield
    # Shutdown
    await knx_shutdown()
    await engine.dispose()

app = FastAPI(title="Spectrum KNX API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

# Serve static files in production
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # If the path looks like a file (has an extension), but wasn't caught by /assets, 
        # it might be a missing file. Otherwise, serve index.html for SPA routing.

        # Security: Resolve absolute paths and verify the requested file is within STATIC_DIR
        abs_static_dir = os.path.abspath(STATIC_DIR)
        requested_path = os.path.abspath(os.path.join(abs_static_dir, full_path))

        if full_path and os.path.isfile(requested_path):
            # Check if the requested path is within the static directory
            if os.path.commonpath([abs_static_dir, requested_path]) == abs_static_dir:
                return FileResponse(requested_path)

        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
else:
    @app.get("/")
    def read_root():
        return {"status": "ok", "app": "Spectrum KNX (Dev Mode)"}
