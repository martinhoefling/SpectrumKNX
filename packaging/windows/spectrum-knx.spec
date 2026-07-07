# PyInstaller spec for the Spectrum KNX Windows build (onedir).
# Build (from the repository root, frontend/dist must exist):
#   pyinstaller --distpath dist/windows packaging/windows/spectrum-knx.spec
# The spec is OS-agnostic so it can be smoke-tested on Linux; releases are
# built on windows-latest in CI.

import os

repo_root = os.path.abspath(os.path.join(SPECPATH, "..", ".."))
backend = os.path.join(repo_root, "backend")

a = Analysis(
    [os.path.join(SPECPATH, "launcher.py")],
    pathex=[backend],
    datas=[
        # main.py resolves STATIC_DIR relative to its own location, which in a
        # frozen app is the bundle's _internal directory.
        (os.path.join(repo_root, "frontend", "dist"), "static"),
        (os.path.join(SPECPATH, "env.template"), "."),
    ]
    # CI writes the release version to packaging/windows/VERSION before building
    + ([(os.path.join(SPECPATH, "VERSION"), ".")] if os.path.exists(os.path.join(SPECPATH, "VERSION")) else []),
    hiddenimports=[
        # Imported dynamically at runtime, invisible to static analysis:
        "aiosqlite",
        "sqlalchemy.dialects.sqlite.aiosqlite",
        "sqlalchemy.dialects.postgresql.asyncpg",
        "xknxproject",  # lazy import in knx_daemon._load_project_data
        "uvicorn.logging",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.protocols.websockets.websockets_impl",
        "uvicorn.lifespan.on",
    ],
    excludes=["pytest", "ruff"],
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    exclude_binaries=True,
    name="spectrum-knx",
    console=True,  # keep the console: it shows the URL and live logs
    icon=os.path.join(SPECPATH, "spectrum-knx.ico") if os.path.exists(os.path.join(SPECPATH, "spectrum-knx.ico")) else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    name="spectrum-knx",
)
