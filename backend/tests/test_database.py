"""Tests for database.py's STORE_MODE branching.

database.py builds `store`/`engine` at import time from env vars, and other
modules import those objects by reference (`from database import store`).
Re-importing it in-process (e.g. via importlib.reload) would leave those
already-bound references stale and could corrupt state for every other test
in the suite that touches the shared store/engine. Each case here runs in a
fresh subprocess instead, so it is fully isolated and never runs a real
network connection (constructing a store just builds an engine object; it
does not connect).
"""

import subprocess
import sys


def _run(store_mode: str, database_url: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-c", "import database; print(type(database.store).__name__)"],
        cwd=__file__.rsplit("/tests/", 1)[0],
        env={"STORE_MODE": store_mode, "DATABASE_URL": database_url, "PATH": "/usr/bin:/bin"},
        capture_output=True,
        text=True,
        timeout=10,
    )


def test_postgres_readonly_builds_plain_postgres_store():
    result = _run("postgres-readonly", "postgresql+asyncpg://user:pass@localhost/db")
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "PostgresStore"


def test_postgres_readonly_rejects_sqlite_url():
    result = _run("postgres-readonly", "sqlite+aiosqlite:///some/path.db")
    assert result.returncode != 0
    assert "STORE_MODE=postgres-readonly requires a postgres DATABASE_URL" in result.stderr


def test_standalone_postgres_still_builds_buffered_store():
    """Unaffected by the new mode: standalone + postgres URL keeps writing/buffering."""
    result = _run("standalone", "postgresql+asyncpg://user:pass@localhost/db")
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "BufferedPostgresStore"
