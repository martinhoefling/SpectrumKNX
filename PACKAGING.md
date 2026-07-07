# Packaging: Debian package & Windows build

Design and implementation plan for distributing Spectrum KNX as a standalone
application outside Docker/Home Assistant — as a Debian package (`.deb`) and a
Windows build — using the **SQLite storage backend** (no PostgreSQL/TimescaleDB).

Status legend: `[ ]` planned · `[x]` done · notes are updated as implementation
progresses.

## Why this is feasible

With `DATABASE_URL=sqlite+aiosqlite:///...` the whole app is a single Python
process: FastAPI/uvicorn serves the API, the websocket stream and the prebuilt
frontend from `backend/static/`; xknx talks to the bus; aiosqlite persists
telegrams. All dependencies are pure Python or ship manylinux/win wheels.
Node.js is only needed at build time (frontend), never at runtime.

Configuration is entirely environment-driven (`load_dotenv()` at startup), so
both packages configure the app through an env file. Relevant keys:
`DATABASE_URL`, `KNX_CONNECTION_TYPE`, `KNX_GATEWAY_IP`, `KNX_*` (secure/keys),
`KNX_PROJECT_PATH`, `STORE_MODE`, `LOG_LEVEL`. Note the in-app project upload
falls back to a hardcoded `/project` directory when `KNX_PROJECT_PATH` is
unset — **both packages must set `KNX_PROJECT_PATH`** to a writable location.

## Step 0 — Python 3.13 baseline

- [x] Verify the backend runs and the test suite passes on Python 3.13
      (Debian 13 "trixie" ships 3.13; the Docker image uses 3.14).
      *Result: all 65 backend tests pass on 3.13.13; no 3.14-only syntax or
      dependency issues found.*
- [x] Declare `requires-python = ">=3.13"` in `backend/pyproject.toml` and set
      `ruff` `target-version = "py313"` accordingly.
- [x] Add Python 3.13 to the CI test matrix so compatibility is enforced
      (`ci.yml` now tests 3.13 and 3.14).

## Step 1 — Packaging metadata (`backend/pyproject.toml`)

- [x] Add a `[project]` table: name `spectrum-knx`, `requires-python = ">=3.13"`,
      and the list of **direct runtime dependencies**. The version stays a
      placeholder — releases are versioned by git tag, surfaced at runtime via
      `APP_VERSION` (same mechanism as the Docker image).
- [x] Move dev-only tools (pytest, ruff, pre-commit, httpx) to a
      `[dependency-groups] dev` group.
- [x] Role split instead of replacement: `pyproject.toml` declares the direct
      dependencies; `requirements.txt` remains the pinned lock (with
      transitives) that Docker image, HA add-on and the packages below install
      from — no change to the existing build paths. Both files must be updated
      together when adding a dependency (noted in both).

## Step 2 — Debian package (bundled venv)

Self-contained package, not aimed at the official Debian archive (xknx and
knx-telegram-store are not packaged in Debian; bundling a venv is the
established pragmatic approach).

Layout:

| Path | Content |
|---|---|
| `/opt/spectrum-knx/venv` | virtualenv with the app + runtime deps |
| `/opt/spectrum-knx/app` | backend sources + `static/` frontend build |
| `/etc/spectrum-knx/spectrum-knx.env` | env-file config (conffile) |
| `/lib/systemd/system/spectrum-knx.service` | systemd unit |
| `/var/lib/spectrum-knx` | state: sqlite DB, uploaded `.knxproj` (created via systemd `StateDirectory`) |

Decisions:

- **Interpreter**: the venv links against the distro's `python3` — the package
  is built inside a `debian:trixie` container so paths and the interpreter
  version (3.13) match the target. `Depends: python3 (>= 3.13)`.
- **Service**: runs as a dedicated `spectrum-knx` system user (created in
  `postinst`), `StateDirectory=spectrum-knx`, `EnvironmentFile=` the conffile.
  Defaults in the env file: sqlite DB and `KNX_PROJECT_PATH` under
  `/var/lib/spectrum-knx`, KNX routing (multicast) mode.
- **Arch**: `amd64` and `arm64` via qemu in CI (all native deps have wheels
  for both; nothing is compiled at build time).
- **Build tooling**: a plain `packaging/debian/build.sh` using `python3 -m venv`
  + `dpkg-deb --build` (no dh-virtualenv dependency); runnable locally in
  Docker and in CI. `lintian` runs as a sanity check (informational).

Steps:

- [x] `packaging/debian/` skeleton: `control.in`, `postinst`, `prerm`,
      `postrm`, `spectrum-knx.service`, `spectrum-knx.env`, `build.sh`.
      *Notes: the venv is created at its final `/opt/spectrum-knx/venv` path
      during the build so script shebangs are correct; only runtime deps are
      installed (direct deps from `pyproject.toml`, versions constrained by
      `requirements.txt`) — package size ≈ 13 MB. The unit gets defaults via
      `Environment=` so an old conffile can't break an upgrade; `APP_VERSION`
      is baked into the unit at build time. The web UI defaults to port 8000.*
- [x] Local build inside `debian:trixie` container; verified with
      `dpkg-deb -c`, `lintian` (remaining tags are the expected
      `dir-or-file-in-opt` for venv-bundled software) and an install/run smoke
      test: service user created, UI served with correct title/version,
      sqlite store written to `/var/lib/spectrum-knx`.

## Step 3 — Windows build (PyInstaller)

- **Mode**: PyInstaller **onedir** (folder with `spectrum-knx.exe`), shipped as
  a zip. Onedir starts faster and triggers fewer antivirus false positives
  than onefile; an Inno Setup installer can be layered on later.
- **Launcher**: `packaging/windows/launcher.py` is the PyInstaller entry point.
  It loads `.env` next to the exe (created from a template on first run),
  defaults `DATABASE_URL` and `KNX_PROJECT_PATH` to
  `%LOCALAPPDATA%\SpectrumKNX\`, starts uvicorn on `127.0.0.1:8000` and opens
  the default browser. Console window stays visible for logs (documented;
  a tray/service wrapper via WinSW is a possible follow-up).
- **Static frontend**: bundled as PyInstaller data files so `main.py`'s
  `STATIC_DIR` (relative to `__file__`) resolves inside the bundle.
- **Firewall**: first KNX routing (multicast) use triggers a Windows Firewall
  prompt — documented in the README section.

Steps:

- [x] `packaging/windows/`: `launcher.py`, `spectrum-knx.spec`, `env.template`,
      `spectrum-knx.ico` (generated from `frontend/public/favicon.svg`).
      *Notes: the launcher finalizes the environment (defaults →
      `%LOCALAPPDATA%\SpectrumKNX`) before importing the backend, because
      `database.py` reads env at import time. `env.template` ships inside
      `_internal` and is copied to `.env` next to the exe on first run.
      Hidden imports cover uvicorn's dynamic loops/protocols, the SQLAlchemy
      sqlite/asyncpg dialects and the lazily imported `xknxproject`.*
- [x] Validated the spec with PyInstaller on Linux (same spec, Linux binary):
      bundle starts, serves the UI, creates `.env` and the data directory.
      The real `.exe` is built in CI on `windows-latest`.

## Step 4 — CI build & release pipeline

Extend the existing tag-driven release flow (`release.yml` builds the Docker
image and creates the GitHub Release on `v*` tags):

- [x] New jobs in `release.yml` (same workflow, so artifacts land on the same
      release; they `need` the Docker job so the release already exists when
      they upload):
  - `build-deb` — matrix `{amd64, arm64}`, runs the deb build in a
    `debian:trixie` container (arm64 via `docker/setup-qemu-action`; all
    native deps ship arm64 wheels, nothing compiles). Install + HTTP smoke
    test on amd64. Uploads `spectrum-knx_<version>_<arch>.deb`.
  - `build-windows` — `windows-latest`, Python 3.13, frontend build,
    PyInstaller, smoke test (starts the exe, checks `/api/version` and the
    page title), uploads `spectrum-knx-<version>-windows-x64.zip`.
- [x] Artifacts attached with `softprops/action-gh-release` (appends files to
      the tag's release).
- [x] Version: taken from the tag, like the Docker build. Baked into the deb
      `control` + systemd unit (`Environment=APP_VERSION=`) and into the
      Windows bundle as a `VERSION` data file read by the launcher.

## Step 5 — Documentation

- [x] README: "📦 Debian Package & Windows" section linking to release assets.
- [x] DEPLOYMENT.md: new "4. Debian Package & Windows" section (install,
      file locations, service management, upgrade/uninstall notes; former
      sections 4/5 renumbered to 5/6).
- [x] This document tracks implementation status and records deviations from
      the plan.

## Out of scope (possible follow-ups)

- Official Debian archive inclusion (would require packaging xknx,
  xknxproject, knx-telegram-store as debs).
- Windows service wrapper (WinSW/NSSM), signed binaries, Inno Setup installer.
- macOS bundle.
