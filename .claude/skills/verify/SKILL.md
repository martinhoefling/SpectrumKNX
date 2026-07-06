---
name: verify
description: Build, launch, and drive SpectrumKNX locally (backend + frontend) to verify changes end-to-end.
---

# Verify SpectrumKNX changes

## Backend (FastAPI, no KNX gateway needed)

Runs fine without a KNX gateway (daemon logs connection errors but the API works).
Use a throwaway sqlite DB to avoid needing Postgres:

```bash
cd backend
DATABASE_URL="sqlite+aiosqlite:////abs/path/to/test.db" venv/bin/uvicorn main:app --port 8321
```

Seed telegrams through the storage library (NOT `seed_data.py` — that targets the
legacy `models.py` schema, not the knx-telegram-store schema):

```python
from knx_telegram_store.backends.sqlite import SqliteStore  # backend/venv has it
# store.store_many([StoredTelegram(...), ...]) after await store.initialize()
```

## Frontend (Vite dev server, proxies /api and /ws)

```bash
cd frontend
VITE_BACKEND_URL=http://localhost:8321 npx vite --port 5199
```

## Driving the UI headlessly

Playwright's bundled chromium is not installed and `--with-deps` needs sudo;
system Chrome works: `npm i playwright` in a scratch dir, then
`chromium.launch({ channel: 'chrome' })`. Toolbar overlays are reached via
`button[title="..."]` (e.g. "Database maintenance", "Traffic statistics").

## Gotchas

- Timestamps from sqlite round-trip as naive UTC ISO strings; the frontend
  renders them via `new Date(ts)`, i.e. shifted to local time. App-wide behavior.
- `ruff check backend` has 3 pre-existing I001 import-order errors on main
  (api.py, knx_daemon.py, tests/test_api.py) — not a regression signal.
