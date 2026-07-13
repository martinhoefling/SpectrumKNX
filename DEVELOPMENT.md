# Development Guide

This document provides instructions for setting up the development environment, understanding the technology stack, and deploying the application using Docker.

## Technology Stack

### Backend
- **Language:** Python 3.14+
- **Framework:** [FastAPI](https://fastapi.tiangolo.com/)
- **KNX Integration:** [xknx](https://xknx.io/) for bus communication and [xknxproject](https://github.com/XKNX/xknxproject) for ETS project parsing.
- **ORM:** [SQLAlchemy](https://www.sqlalchemy.org/) (Async)
- **Database Driver:** `asyncpg` (PostgreSQL) or `aiosqlite` (SQLite)

### Frontend
- **Framework:** [React](https://react.dev/) + [Vite](https://vitejs.dev/)
- **Language:** TypeScript
- **State Management:** React Hooks
- **Data Table:** [TanStack Table v8](https://tanstack.com/table/v8)
- **Icons:** [Lucide React](https://lucide.dev/)
- **Styling:** Vanilla CSS (Modern CSS variables, Flexbox/Grid)

### Storage & Infrastructure
- **Database:** [PostgreSQL](https://www.postgresql.org/) (default). The [TimescaleDB](https://www.timescale.com/) extension is optional — when available it is used automatically for hypertable partitioning and native compression; any plain PostgreSQL server works too. Alternatively SQLite via `aiosqlite` for lightweight setups.
- **Containerization:** [Docker](https://www.docker.com/) & [Docker Compose](https://docs.docker.com/compose/).

---

## Getting Started

### 1. Prerequisites
- Docker and Docker Compose installed.
- Python 3.14 installed (for local backend development).
- Node.js 24+ installed (for local frontend development).

### 2. Environment Configuration
Copy the example environment file and adjust the values as needed:
```bash
cp .env_example .env
```
Key variables:
- `DATABASE_URL`: (Optional) Full SQLAlchemy connection string. Use `postgresql+asyncpg://...` for PostgreSQL or `sqlite+aiosqlite:////path/to/file.db` for SQLite.
- `POSTGRES_USER/PASSWORD/DB`: Individual PostgreSQL credentials used when `DATABASE_URL` is omitted and the PostgreSQL backend is active.
- `KNX_PASSWORD`: Password for your ETS project export.
- `KNX_PROJECT_PATH`: Path to the `.knxproj` file inside the container.
- `KNX_GATEWAY_IP`: IP of your KNX interface (or `AUTO`). See `DEPLOYMENT.md` for advanced connection settings.
- `APP_IMAGE`: Docker image to use for production stacks.
- `VITE_BACKEND_URL`: (Frontend only) The URL of the backend API (default: `http://localhost:8000`).

Companion mode (read an external telegram store instead of running the KNX daemon):
- `STORE_MODE`: `standalone` (default) or `external-readonly` — read a sqlite store owned and written by another process (e.g. Home Assistant's KNX integration). Requires a `sqlite+aiosqlite://` `DATABASE_URL`; the KNX daemon is not started, and purge/optimize are disabled.
- `LIVE_SOURCE`: Live-feed source in companion mode: `ha_websocket` (default — subscribe to HA's `knx/subscribe_telegrams`), `poll` (interval-poll the store; no HA required) or `none`.
- `HA_WS_URL`: Home Assistant websocket URL (default `ws://supervisor/core/websocket`; for local dev e.g. `ws://localhost:8123/api/websocket`).
- `HA_TOKEN` / `SUPERVISOR_TOKEN`: Access token for the HA websocket (a long-lived token in dev; the Supervisor injects `SUPERVISOR_TOKEN` in the add-on). Without a token, `ha_websocket` falls back to polling.
- `LIVE_POLL_INTERVAL`: Poll interval in seconds for `LIVE_SOURCE=poll` (default `1.0`).

### 3. Database Setup
The backend supports two storage backends selected via `DATABASE_URL`:

**PostgreSQL (default):** Start the database via Docker Compose. The bundled container ships TimescaleDB, but any plain PostgreSQL server works as well — the backend detects the extension at startup and falls back automatically. The schema is created automatically on first startup.
```bash
docker-compose up -d db
```

**SQLite (no external database required):** Set `DATABASE_URL` to a `sqlite+aiosqlite://` URL and skip the database container entirely.
```bash
export DATABASE_URL="sqlite+aiosqlite:///spectrum_knx.db"
```

**External read-only (companion mode):** Point at a sqlite store written by another process — no database of our own, no KNX daemon. Useful for developing against a copy of Home Assistant's `.storage/knx/telegrams.db`:
```bash
export STORE_MODE="external-readonly"
export DATABASE_URL="sqlite+aiosqlite:////path/to/telegrams.db"
export LIVE_SOURCE="poll"   # or ha_websocket + HA_WS_URL + HA_TOKEN
```

### 4. Running the Backend

#### Locally (Recommended for Development)
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```
The API will be available at `http://localhost:8000`.

#### Via Docker
```bash
docker-compose up backend
```

### 5. Running the Frontend
The frontend currently runs natively using the Vite development server.

```bash
cd frontend
npm install
npm run dev
```
The application will be available at `http://localhost:5173`.

---

## Docker Stacks

Spectrum KNX uses a multi-stack Docker approach to balance development productivity with production reliability.

### 1. Development Stack (Default)
Used for daily coding. Includes the Vite development server and auto-reloading backend.
```bash
docker-compose up -d
```
Docker automatically uses `docker-compose.override.yml` for this mode, which mounts your local source code for live-reloading.

### 2. Development Stack with Local knx-telegram-store
If you are developing the `knx-telegram-store` library in parallel in the same parent directory, you can mount and use the local source files instead of the released package by adding `docker-compose.dev-store.yml`:
```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.dev-store.yml up --build
```
This mounts the local repository and adjusts the container's `PYTHONPATH`.

### 3. Production Stack
Pulls the monolithic pre-built image from GHCR. Does not require local Node.js or high build times.
```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```
This mode ignores local builds and mounts, using the official image instead.

---

## Project Structure

- `/backend`: FastAPI application, KNX daemon, and database models.
- `/frontend`: React application and UI components.
- `/db`: (Removed) Schema is now managed by the `knx-telegram-store` library at runtime.
- `/project`: Directory for storing ETS `.knxproj` files for parsing.
- `docker-compose.yml`: Main orchestration file for services.
