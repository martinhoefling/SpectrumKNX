"""Tests for the backup hooks: POST /api/backup/begin and /api/backup/end.

The add-on's backup_pre/backup_post commands call these from inside the
container, so only loopback peers are accepted, and they must stay reachable
when UI login is on.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from knx_telegram_store import BufferedPostgresStore, BufferedSqliteStore
from knx_telegram_store.backends.sqlite import SqliteStore

import api
from main import app

local = TestClient(app, client=("127.0.0.1", 50000))
remote = TestClient(app, client=("192.168.1.20", 50000))


@pytest.fixture(autouse=True)
def _no_backup_in_progress():
    api._backup_timer = None
    yield
    api._backup_timer = None


def _sqlite_store(read_only_file=None):
    """A SQLite store object (never initialized) whose backup calls are recorded."""
    store = SqliteStore(read_only_file, read_only=True) if read_only_file else BufferedSqliteStore(":memory:")
    store.begin_backup = AsyncMock()
    store.end_backup = AsyncMock()
    return patch("api.store", new=store)


def test_begin_and_end_lock_a_sqlite_store():
    with _sqlite_store() as store:
        response = local.post("/api/backup/begin")
        assert response.status_code == 200, response.text
        assert response.json() == {"locked": True}
        store.begin_backup.assert_awaited_once()
        assert api._backup_timer is not None

        response = local.post("/api/backup/end")
        assert response.status_code == 200, response.text
        assert response.json() == {"locked": False}
        store.end_backup.assert_awaited_once()
        assert api._backup_timer is None


def test_begin_twice_holds_once():
    with _sqlite_store() as store:
        assert local.post("/api/backup/begin").json() == {"locked": True}
        assert local.post("/api/backup/begin").json() == {"locked": True}
        store.begin_backup.assert_awaited_once()

        local.post("/api/backup/end")
        store.end_backup.assert_awaited_once()


def test_end_without_begin_is_harmless():
    with _sqlite_store() as store:
        response = local.post("/api/backup/end")
        assert response.status_code == 200
        assert response.json() == {"locked": False}
        store.end_backup.assert_not_awaited()


def test_remote_peers_are_refused():
    with _sqlite_store() as store:
        assert remote.post("/api/backup/begin").status_code == 403
        assert remote.post("/api/backup/end").status_code == 403
        store.begin_backup.assert_not_awaited()
        store.end_backup.assert_not_awaited()


def test_read_only_sqlite_store_is_not_locked(tmp_path):
    """Companion mode reads Home Assistant's file; its owner handles backups."""
    with _sqlite_store(read_only_file=tmp_path / "telegrams.db") as store:
        response = local.post("/api/backup/begin")
        assert response.status_code == 200
        assert response.json() == {"locked": False}
        store.begin_backup.assert_not_awaited()


def test_postgres_store_is_not_locked():
    """A backup of this container does not copy PostgreSQL's data."""
    store = BufferedPostgresStore("postgresql+asyncpg://user:pass@localhost/db")  # builds an engine, never connects
    store.begin_backup = AsyncMock()
    with patch("api.store", new=store):
        response = local.post("/api/backup/begin")
        assert response.status_code == 200
        assert response.json() == {"locked": False}
        store.begin_backup.assert_not_awaited()


def test_store_error_is_reported():
    from knx_telegram_store import KnxTelegramStoreException

    with _sqlite_store() as store:
        store.begin_backup.side_effect = KnxTelegramStoreException("boom")
        response = local.post("/api/backup/begin")
        assert response.status_code == 503
        assert "boom" in response.json()["detail"]
        assert api._backup_timer is None


def test_hooks_stay_reachable_when_login_is_on(monkeypatch):
    monkeypatch.setenv("AUTH_UI_ENABLED", "true")
    with _sqlite_store():
        assert local.post("/api/backup/begin").status_code == 200
        assert local.post("/api/backup/end").status_code == 200
        # Not the login gate's 401: the endpoint itself refuses remote peers.
        assert remote.post("/api/backup/begin").status_code == 403


@pytest.mark.asyncio
async def test_timeout_releases_the_lock():
    with _sqlite_store() as store:
        timer = MagicMock()
        api._backup_timer = timer
        await api._backup_timed_out()
        timer.cancel.assert_called_once()
        store.end_backup.assert_awaited_once()
        assert api._backup_timer is None

        # A timeout that fires after the hook already ended the backup does nothing.
        await api._backup_timed_out()
        store.end_backup.assert_awaited_once()
