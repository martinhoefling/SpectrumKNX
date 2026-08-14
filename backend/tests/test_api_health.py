from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from knx_telegram_store import StoredTelegram, TelegramQueryResult

import main

client = TestClient(main.app)
empty_query_result = TelegramQueryResult(telegrams=[], total_count=0, limit_reached=False)


def test_health_endpoint_healthy():
    """Test /health and /api/health when all systems are operational."""
    with (
        patch("knx_daemon.is_connected", return_value=True),
        patch("database.store.query", new_callable=AsyncMock, return_value=empty_query_result),
    ):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["checks"]["database"]["status"] == "ok"
        assert data["checks"]["knx_connection"]["status"] == "ok"
        assert data["checks"]["knx_connection"]["connected"] is True

        api_response = client.get("/api/health")
        assert api_response.status_code == 200
        assert api_response.json()["status"] == "ok"


def test_health_endpoint_db_error():
    """Test /health when database query raises an exception."""
    with (
        patch("knx_daemon.is_connected", return_value=True),
        patch("database.store.query", new_callable=AsyncMock, side_effect=RuntimeError("Database connection failed")),
    ):
        response = client.get("/health")
        assert response.status_code == 503
        data = response.json()
        assert data["status"] == "unhealthy"
        assert data["checks"]["database"]["status"] == "error"
        assert "Database connection failed" in data["checks"]["database"]["error"]


def test_health_endpoint_knx_disconnected():
    """Test /health and /health/readiness when KNX daemon is disconnected."""
    with (
        patch("knx_daemon.is_connected", return_value=False),
        patch("database.store.query", new_callable=AsyncMock, return_value=empty_query_result),
    ):
        # Readiness / full check should fail (503)
        response = client.get("/health")
        assert response.status_code == 503
        data = response.json()
        assert data["status"] == "unhealthy"
        assert data["checks"]["knx_connection"]["status"] == "disconnected"
        assert data["checks"]["knx_connection"]["connected"] is False

        readiness_resp = client.get("/health/readiness")
        assert readiness_resp.status_code == 503

        # Liveness check should still pass (200) since DB is reachable
        liveness_resp = client.get("/health/liveness")
        assert liveness_resp.status_code == 200
        assert liveness_resp.json()["status"] == "ok"


def test_health_liveness_db_error():
    """Test /health/liveness when DB is failing."""
    with (
        patch("knx_daemon.is_connected", return_value=True),
        patch("database.store.query", new_callable=AsyncMock, side_effect=RuntimeError("DB Down")),
    ):
        response = client.get("/health/liveness")
        assert response.status_code == 503
        assert response.json()["status"] == "unhealthy"


def test_health_external_readonly_mode():
    """Test /health when STORE_MODE is external-readonly."""
    with (
        patch("database.STORE_MODE", "external-readonly"),
        patch("api.STORE_MODE", "external-readonly"),
        patch("ha_live_bridge.live_feed_status", return_value={"source": "ha_websocket", "connected": True}),
        patch("database.store.query", new_callable=AsyncMock, return_value=empty_query_result),
    ):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["checks"]["knx_connection"]["status"] == "ok"
        assert data["checks"]["knx_connection"]["connected"] is True


def test_health_telegram_activity_reporting():
    """Test timestamp and elapsed seconds calculations for telegram activity."""
    past_time = datetime.now(UTC) - timedelta(seconds=120)
    fake_telegram = StoredTelegram(
        timestamp=past_time,
        source="1.1.1",
        destination="0/0/1",
        telegramtype="GroupValueWrite",
        direction="Incoming",
        payload=True,
    )
    fake_res = TelegramQueryResult(telegrams=[fake_telegram], total_count=1, limit_reached=False)

    with (
        patch("knx_daemon.is_connected", return_value=True),
        patch("knx_daemon.get_last_telegram_timestamp", return_value=past_time),
        patch("database.store.query", new_callable=AsyncMock, return_value=fake_res),
    ):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        telegrams_check = data["checks"]["telegrams"]
        assert telegrams_check["status"] == "ok"
        assert telegrams_check["last_received_at"] is not None
        assert telegrams_check["seconds_since_last_telegram"] is not None
        assert telegrams_check["seconds_since_last_telegram"] >= 115
