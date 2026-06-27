from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import knx_daemon
from knx_telegram_store import StoredTelegram, TelegramQueryResult
from main import app

client = TestClient(app)


def test_read_root():
    response = client.get("/")
    assert response.status_code == 200
    # Match the actual response in main.py
    assert response.json() == {"status": "ok", "app": "Spectrum KNX (Dev Mode)"}


def test_api_project_no_project():
    knx_daemon.global_knx_project = None
    response = client.get("/api/project")
    assert response.status_code == 200
    assert response.json()["status"] == "no_project_loaded"


def test_api_project_with_project():
    knx_daemon.global_knx_project = {"group_addresses": {"1/1/1": {}}, "devices": {}}
    response = client.get("/api/project")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert "1/1/1" in response.json()["group_addresses"]


def test_get_filter_options_no_project():
    knx_daemon.global_knx_project = None
    response = client.get("/api/filter-options")
    assert response.status_code == 200
    data = response.json()
    assert data["sources"] == []
    assert data["targets"] == []
    assert data["dpts"] == []
    assert "types" in data


def test_get_filter_options_with_project():
    knx_daemon.global_knx_project = {
        "devices": {
            "1.1.1": {"name": "Test Device 1"},
            "1.1.2": {"name": "Test Device 2"},
        },
        "group_addresses": {
            "1/2/3": {"name": "Test GA 1", "dpt": {"main": 1, "sub": 1}},
            "1/2/4": {"name": "Test GA 2", "dpt": {"main": 9}},
        },
    }
    response = client.get("/api/filter-options")
    assert response.status_code == 200
    data = response.json()

    assert len(data["sources"]) == 2
    assert data["sources"][0]["address"] == "1.1.1"
    assert data["sources"][0]["name"] == "Test Device 1"

    assert len(data["targets"]) == 2
    assert data["targets"][0]["address"] == "1/2/3"
    assert data["targets"][0]["name"] == "Test GA 1"

    assert len(data["dpts"]) == 2
    assert data["dpts"][0]["main"] == 1
    assert data["dpts"][0]["sub"] == 1
    assert data["dpts"][1]["main"] == 9
    assert data["dpts"][1]["sub"] is None


# Mock Database Store instead of DB Dependency
@patch("database.store.query", new_callable=AsyncMock)
def test_get_telegrams(mock_query):
    mock_query.return_value = TelegramQueryResult(
        telegrams=[
            StoredTelegram(
                timestamp=datetime(2023, 1, 1),
                source="1.1.1",
                destination="1/2/3",
                telegramtype="GroupValueWrite",
                direction="Incoming",
                dpt_main=1,
                dpt_sub=1,
                payload=None,
                value=1.0,
                raw_data="01",
                source_name="Test Source",
                destination_name="Test GA",
            )
        ],
        total_count=1,
        limit_reached=False,
    )

    response = client.get(
        "/api/telegrams?limit=10&source_address=1.1.1&target_address=1/2/3&telegram_type=GroupValueWrite"
    )
    assert response.status_code == 200
    data = response.json()
    assert "telegrams" in data
    assert len(data["telegrams"]) == 1
    assert data["telegrams"][0]["source_address"] == "1.1.1"
    assert data["telegrams"][0]["raw_data"] == "01"


@patch("database.store.query", new_callable=AsyncMock)
def test_get_telegrams_string_value_formatted(mock_query):
    """Strings stored as plain payload (new format) should display without JSON wrapping."""
    mock_query.return_value = TelegramQueryResult(
        telegrams=[
            StoredTelegram(
                timestamp=datetime(2023, 1, 1),
                source="1.1.1",
                destination="1/2/3",
                telegramtype="GroupValueWrite",
                direction="Incoming",
                dpt_main=16,
                dpt_sub=1,
                payload="hello world",
                value=None,
                raw_data=None,
            )
        ],
        total_count=1,
        limit_reached=False,
    )

    response = client.get("/api/telegrams?limit=10")
    assert response.status_code == 200
    t = response.json()["telegrams"][0]
    assert t["value_formatted"] == "hello world"


@patch("database.store.query", new_callable=AsyncMock)
def test_get_telegrams_legacy_wrapped_string_unwrapped(mock_query):
    """Strings stored in legacy {'value': x} format should be unwrapped for display."""
    mock_query.return_value = TelegramQueryResult(
        telegrams=[
            StoredTelegram(
                timestamp=datetime(2023, 1, 1),
                source="1.1.1",
                destination="1/2/3",
                telegramtype="GroupValueWrite",
                direction="Incoming",
                dpt_main=16,
                dpt_sub=1,
                payload={"value": "hello world"},
                value=None,
                raw_data=None,
            )
        ],
        total_count=1,
        limit_reached=False,
    )

    response = client.get("/api/telegrams?limit=10")
    assert response.status_code == 200
    t = response.json()["telegrams"][0]
    assert t["value_formatted"] == "hello world"
    assert t["value_formatted"] != "{'value': 'hello world'}"


def test_get_filter_options_invalid_device_address():
    knx_daemon.global_knx_project = {
        "devices": {
            "invalid_address": {"name": "Broken Device"},
        },
        "group_addresses": {},
    }
    response = client.get("/api/filter-options")
    assert response.status_code == 200
    data = response.json()

    assert len(data["sources"]) == 1
    assert data["sources"][0]["address"] == "invalid_address"
    assert data["sources"][0]["name"] == "Broken Device"


def test_get_filter_options_dpt_deduplication():
    knx_daemon.global_knx_project = {
        "devices": {},
        "group_addresses": {
            "1/2/3": {"name": "Test GA 1", "dpt": {"main": 1, "sub": 1}},
            "1/2/4": {"name": "Test GA 2", "dpt": {"main": 1, "sub": 1}},
            "1/2/5": {"name": "Test GA 3", "dpt": {"main": 9}},
            "1/2/6": {"name": "Test GA 4", "dpt": {"main": 9}},
        },
    }
    response = client.get("/api/filter-options")
    assert response.status_code == 200
    data = response.json()

    assert len(data["dpts"]) == 2
    # Ensure they are sorted and deduplicated
    assert data["dpts"][0]["main"] == 1
    assert data["dpts"][0]["sub"] == 1
    assert data["dpts"][1]["main"] == 9
    assert data["dpts"][1]["sub"] is None


@patch("database.store.query", new_callable=AsyncMock)
def test_get_telegrams_extended_filters(mock_query):
    mock_query.return_value = TelegramQueryResult(
        telegrams=[
            StoredTelegram(
                timestamp=datetime(2023, 1, 1),
                source="1.1.1",
                destination="1/2/3",
                telegramtype="GroupValueWrite",
                direction="Incoming",
                dpt_main=1,
                dpt_sub=1,
                payload=None,
                value=1.0,
                raw_data="01",
            )
        ],
        total_count=1,
        limit_reached=False,
    )
    # Test with dpt_main, start_time, and end_time
    response = client.get(
        "/api/telegrams?limit=10&dpt_main=1,9&start_time=2023-01-01T00:00:00Z&end_time=2023-12-31T23:59:59Z"
    )
    assert response.status_code == 200
    data = response.json()
    assert "telegrams" in data
    assert len(data["telegrams"]) == 1


@patch("database.store.query", new_callable=AsyncMock)
def test_get_telegrams_delta_no_match(mock_query):
    mock_query.return_value = TelegramQueryResult(telegrams=[], total_count=0, limit_reached=False)
    response = client.get("/api/telegrams?delta_before_ms=100&source_address=9.9.9")
    assert response.status_code == 200
    data = response.json()
    assert data["telegrams"] == []
    assert data["metadata"]["total_count"] == 0


@patch("database.store.query", new_callable=AsyncMock)
def test_get_telegrams_delta_with_matches(mock_query):
    from datetime import timedelta

    base_time = datetime(2023, 1, 1, 12, 0, 0, tzinfo=UTC)

    mock_query.return_value = TelegramQueryResult(
        telegrams=[
            StoredTelegram(
                timestamp=base_time - timedelta(milliseconds=50),
                source="1.1.2",
                destination="1/2/4",
                telegramtype="GroupValueRead",
                direction="Incoming",
                dpt_main=1,
                dpt_sub=1,
                payload=None,
                value=0.0,
                raw_data="00",
            ),
            StoredTelegram(
                timestamp=base_time,
                source="1.1.1",
                destination="1/2/3",
                telegramtype="GroupValueWrite",
                direction="Outgoing",
                dpt_main=1,
                dpt_sub=1,
                payload=None,
                value=1.0,
                raw_data="01",
            ),
        ],
        total_count=2,
        limit_reached=False,
    )

    response = client.get("/api/telegrams?delta_before_ms=100&delta_after_ms=100&source_address=1.1.1")
    assert response.status_code == 200
    data = response.json()
    assert len(data["telegrams"]) == 2
    assert data["metadata"]["total_count"] == 2
    sources = [t["source_address"] for t in data["telegrams"]]
    assert "1.1.1" in sources
    assert "1.1.2" in sources


def test_get_project_status_no_project(monkeypatch):
    monkeypatch.delenv("KNX_PROJECT_PATH", raising=False)
    monkeypatch.delenv("KNX_PASSWORD", raising=False)
    knx_daemon.global_knx_project = None

    with patch("api._project_upload_writable", return_value=True):
        response = client.get("/api/project/status")
    assert response.status_code == 200
    data = response.json()
    assert data["upload_feature_active"] is True
    assert data["upload_writable"] is True
    assert data["project_loaded"] is False
    assert data["upload_required"] is True


def test_get_project_status_with_env_vars(monkeypatch):
    monkeypatch.setenv("KNX_PROJECT_PATH", "/some/path")
    monkeypatch.setenv("KNX_PASSWORD", "secret")
    knx_daemon.global_knx_project = None

    with patch("api._project_upload_writable", return_value=True):
        response = client.get("/api/project/status")
    assert response.status_code == 200
    data = response.json()
    # Upload is always active now
    assert data["upload_feature_active"] is True
    assert data["upload_required"] is True


def test_get_project_status_not_writable(monkeypatch):
    monkeypatch.delenv("KNX_PROJECT_PATH", raising=False)
    knx_daemon.global_knx_project = None

    with patch("api._project_upload_writable", return_value=False):
        response = client.get("/api/project/status")
    assert response.status_code == 200
    assert response.json()["upload_writable"] is False


def test_upload_project_permission_error(monkeypatch, tmp_path):
    proj_file = tmp_path / "readonly.knxproj"
    proj_file.write_bytes(b"existing")
    proj_file.chmod(0o444)
    monkeypatch.setenv("KNX_PROJECT_PATH", str(proj_file))
    monkeypatch.delenv("KNX_PASSWORD", raising=False)

    response = client.post("/api/project/upload", data={"password": "test"}, files={"file": ("test.knxproj", b"dummy")})
    assert response.status_code == 403
    assert "Cannot write project file" in response.json()["detail"]


def test_upload_project_with_env_path(monkeypatch, tmp_path):
    """When KNX_PROJECT_PATH is set, upload writes to that path."""
    proj_file = tmp_path / "my.knxproj"
    monkeypatch.setenv("KNX_PROJECT_PATH", str(proj_file))
    monkeypatch.delenv("KNX_PASSWORD", raising=False)

    async def mock_load():
        knx_daemon.global_knx_project = {"fake": "project"}
        return True

    monkeypatch.setattr(knx_daemon, "_load_project_data", mock_load)

    response = client.post(
        "/api/project/upload", data={"password": "test_pass"}, files={"file": ("test.knxproj", b"dummy_content")}
    )
    assert response.status_code == 200
    assert proj_file.read_bytes() == b"dummy_content"
    # Password sidecar written next to the project file
    pwd_file = tmp_path / "my_password"
    assert pwd_file.read_text() == "test_pass"


def test_upload_project_invalid_file(monkeypatch):
    monkeypatch.delenv("KNX_PROJECT_PATH", raising=False)
    monkeypatch.delenv("KNX_PASSWORD", raising=False)
    response = client.post("/api/project/upload", data={"password": "test"}, files={"file": ("test.txt", b"dummy")})
    assert response.status_code == 400
    assert "must be a .knxproj file" in response.json()["detail"]


def test_upload_project_success(monkeypatch, tmp_path):
    monkeypatch.delenv("KNX_PROJECT_PATH", raising=False)
    monkeypatch.delenv("KNX_PASSWORD", raising=False)

    # Mock os.makedirs to ignore creating /project
    import os

    original_makedirs = os.makedirs

    def mock_makedirs(name, exist_ok=False):
        if name == "/project":
            return
        original_makedirs(name, exist_ok=exist_ok)

    monkeypatch.setattr(os, "makedirs", mock_makedirs)

    # Mock open using unittest.mock to intercept writes to /project/...
    from unittest.mock import mock_open

    m = mock_open()
    monkeypatch.setattr("builtins.open", m)

    # Mock knx_daemon._load_project_data
    async def mock_load():
        knx_daemon.global_knx_project = {"fake": "project"}
        return True

    monkeypatch.setattr(knx_daemon, "_load_project_data", mock_load)

    response = client.post(
        "/api/project/upload", data={"password": "test_pass"}, files={"file": ("test.knxproj", b"dummy_content")}
    )
    assert response.status_code == 200

    # Verify open was called correctly
    m.assert_any_call(os.path.join("/project", "knx_project.knxproj"), "wb")
    m.assert_any_call(os.path.join("/project", "knx_project_password"), "w", encoding="utf-8")


def test_upload_project_failure(monkeypatch, tmp_path):
    monkeypatch.delenv("KNX_PROJECT_PATH", raising=False)
    monkeypatch.delenv("KNX_PASSWORD", raising=False)

    import os

    original_makedirs = os.makedirs

    def mock_makedirs(name, exist_ok=False):
        if name == "/project":
            return
        original_makedirs(name, exist_ok=exist_ok)

    monkeypatch.setattr(os, "makedirs", mock_makedirs)

    from unittest.mock import mock_open

    m = mock_open()
    monkeypatch.setattr("builtins.open", m)

    # Mock os.remove to avoid deleting actual files
    def mock_remove(path):
        pass

    monkeypatch.setattr(os, "remove", mock_remove)

    async def mock_load():
        return False

    monkeypatch.setattr(knx_daemon, "_load_project_data", mock_load)

    response = client.post("/api/project/upload", data={"password": "bad"}, files={"file": ("test.knxproj", b"dummy")})
    assert response.status_code == 400
    assert "Incorrect password" in response.json()["detail"]


def test_upload_project_empty_password(monkeypatch, tmp_path):
    monkeypatch.delenv("KNX_PROJECT_PATH", raising=False)
    monkeypatch.delenv("KNX_PASSWORD", raising=False)

    import os

    original_makedirs = os.makedirs

    def mock_makedirs(name, exist_ok=False):
        if name == "/project":
            return
        original_makedirs(name, exist_ok=exist_ok)

    monkeypatch.setattr(os, "makedirs", mock_makedirs)

    from unittest.mock import mock_open

    m = mock_open()
    monkeypatch.setattr("builtins.open", m)

    async def mock_load():
        return True

    monkeypatch.setattr(knx_daemon, "_load_project_data", mock_load)

    # Test with empty password
    response = client.post("/api/project/upload", data={"password": ""}, files={"file": ("test.knxproj", b"dummy")})
    assert response.status_code == 200
    m.assert_any_call(os.path.join("/project", "knx_project_password"), "w", encoding="utf-8")
