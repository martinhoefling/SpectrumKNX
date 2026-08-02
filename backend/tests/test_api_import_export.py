"""API tests for the telegram import/export endpoints (see DESIGN_IMPORT_EXPORT.md)."""

import io
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import telegram_import
from knx_telegram_store import StoredTelegram, TelegramQueryResult
from main import app

client = TestClient(app)


def _reset_job():
    telegram_import.current_job = None


# ── /api/import/status ───────────────────────────────────────────────────────


def test_import_status_idle():
    _reset_job()
    response = client.get("/api/import/status")
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "idle"
    assert "read_only" in body


def test_import_status_reports_running_job():
    telegram_import.current_job = telegram_import.ImportJob(filename="log.xml")
    try:
        body = client.get("/api/import/status").json()
        assert body["state"] == "running"
        assert body["filename"] == "log.xml"
    finally:
        _reset_job()


# ── /api/import (upload) ─────────────────────────────────────────────────────


def test_import_rejects_bad_extension():
    _reset_job()
    response = client.post("/api/import", files={"file": ("log.txt", b"nope", "text/plain")})
    assert response.status_code == 400


@patch("api.READ_ONLY", True)
def test_import_forbidden_in_read_only():
    response = client.post("/api/import", files={"file": ("log.xml", b"<x/>", "application/xml")})
    assert response.status_code == 403


@patch("api.telegram_import.start_import")
def test_import_starts_job(mock_start):
    _reset_job()
    mock_start.return_value = telegram_import.ImportJob(filename="log.xml")
    response = client.post("/api/import", files={"file": ("log.xml", b"<CommunicationLog/>", "application/xml")})
    assert response.status_code == 200
    assert response.json()["state"] == "running"
    assert mock_start.called
    # The upload was spooled to a real temp path that is handed to the importer.
    assert mock_start.call_args[0][1].endswith(".xml")


@patch("api.telegram_import.start_import", side_effect=RuntimeError("An import is already running"))
def test_import_conflict_when_running(mock_start):
    _reset_job()
    response = client.post("/api/import", files={"file": ("log.xml", b"<CommunicationLog/>", "application/xml")})
    assert response.status_code == 409


# ── /api/import/cancel ───────────────────────────────────────────────────────


def test_cancel_when_none_running():
    _reset_job()
    assert client.post("/api/import/cancel").status_code == 404


def test_cancel_running_job():
    telegram_import.current_job = telegram_import.ImportJob(filename="log.xml")
    try:
        assert client.post("/api/import/cancel").status_code == 200
        assert telegram_import.current_job.cancel_requested is True
    finally:
        _reset_job()


# ── /api/export ──────────────────────────────────────────────────────────────


@patch("database.store.query", new_callable=AsyncMock)
def test_export_streams_communication_log(mock_query):
    mock_query.return_value = TelegramQueryResult(
        telegrams=[
            StoredTelegram(
                timestamp=datetime(2026, 3, 5, 0, 0, 0, tzinfo=UTC),
                source="1.0.18",
                destination="2/4/61",
                telegramtype="GroupValueWrite",
                direction="Incoming",
                dpt_main=5,
                dpt_sub=1,
                payload=None,
                value=200.0,
                raw_data="00c8",
            )
        ],
        total_count=1,
        limit_reached=False,
    )

    response = client.get("/api/export?start_time=2026-03-05T00:00:00Z")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/xml")
    assert "attachment" in response.headers["content-disposition"]
    body = response.text
    assert "<CommunicationLog" in body and "</CommunicationLog>" in body
    assert "L_Data.ind" in body
    # Re-parse the exported XML to confirm it round-trips through the library reader.
    from knx_telegram_store.formats import iter_communication_log

    records = list(iter_communication_log(io.BytesIO(body.encode())))
    assert len(records) == 1
    assert records[0].service == "L_Data.ind"


@patch("database.store.query", new_callable=AsyncMock)
def test_export_empty_still_valid_xml(mock_query):
    mock_query.return_value = TelegramQueryResult(telegrams=[], total_count=0, limit_reached=False)
    body = client.get("/api/export").text
    assert body.startswith("<?xml")
    assert "<CommunicationLog" in body and "</CommunicationLog>" in body
