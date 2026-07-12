from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import knx_daemon
from api import _aggregate_statistics
from knx_telegram_store import StoredTelegram, TelegramQueryResult
from main import app

client = TestClient(app)


def test_get_update_endpoint():
    with patch("api.update_check.get_update_info", new_callable=AsyncMock) as mock_update:
        mock_update.return_value = {"enabled": True, "update_available": True, "latest": "v1.11.0", "releases": []}
        response = client.get("/api/update")
    assert response.status_code == 200
    assert response.json()["latest"] == "v1.11.0"
    mock_update.assert_awaited_once()


def test_aggregate_statistics_builds_drilldown_children():
    # (source PA, destination GA, count) rows, already grouped by pair.
    rows = [
        ("1.1.1", "1/2/3", 10),
        ("1.1.2", "1/2/3", 4),
        ("1.1.1", "1/2/4", 1),
    ]
    ga_names = {"1/2/3": "Kitchen Light", "1/2/4": "Hall Light"}
    pa_names = {"1.1.1": "Switch A", "1.1.2": "Switch B"}

    result = _aggregate_statistics(rows, ga_names, pa_names)

    assert result["total"] == 15

    # GA view: most-used GA first, with contributing PAs as children (desc).
    top_ga = result["by_ga"][0]
    assert top_ga["address"] == "1/2/3"
    assert top_ga["count"] == 14
    assert top_ga["name"] == "Kitchen Light"
    assert [(c["address"], c["count"], c["name"]) for c in top_ga["children"]] == [
        ("1.1.1", 10, "Switch A"),
        ("1.1.2", 4, "Switch B"),
    ]

    # PA view: PA 1.1.1 sent to two GAs; children are destination GAs (desc).
    pa_111 = next(p for p in result["by_pa"] if p["address"] == "1.1.1")
    assert pa_111["count"] == 11
    assert [(c["address"], c["count"], c["name"]) for c in pa_111["children"]] == [
        ("1/2/3", 10, "Kitchen Light"),
        ("1/2/4", 1, "Hall Light"),
    ]


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


def test_get_building_no_project():
    knx_daemon.global_knx_project = None
    response = client.get("/api/building")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "no_project_loaded"
    assert data["tree"] == []
    assert data["unassigned_devices"] == []


def test_get_building_with_project():
    knx_daemon.global_knx_project = {
        "locations": {
            "B-1": {
                "type": "Building",
                "name": "Home",
                "devices": [],
                "spaces": {
                    "F-1": {
                        "type": "Floor",
                        "name": "Ground Floor",
                        "devices": ["1.1.1"],
                        "spaces": {},
                    }
                },
            }
        },
        "devices": {
            "1.1.1": {
                "name": "Switch Actuator",
                "individual_address": "1.1.1",
                "manufacturer_name": "ACME",
                "hardware_name": "SA/4",
                "communication_object_ids": ["O-1", "O-2", "O-3"],
                "channels": {
                    "CH-1": {"name": "Channel A", "communication_object_ids": ["O-1"]},
                },
            },
            # Device not placed in any location → unassigned bucket.
            "1.1.9": {
                "name": "Orphan",
                "individual_address": "1.1.9",
                "communication_object_ids": [],
                "channels": {},
            },
        },
        "communication_objects": {
            "O-1": {
                "number": 1,
                "name": "Switch",
                "text": "On/Off",
                "dpts": [{"main": 1, "sub": 1}],
                "group_address_links": ["1/2/3"],
            },
            # No GA links → must be omitted.
            "O-2": {"number": 2, "name": "Unused", "text": "", "group_address_links": []},
            # Linked but not in any channel → unassigned KO list.
            "O-3": {"number": 3, "name": "Status", "text": "State", "group_address_links": ["1/2/4"]},
        },
        "group_addresses": {
            "1/2/3": {"name": "Light On/Off"},
            "1/2/4": {"name": "Light Status"},
        },
    }
    response = client.get("/api/building")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"

    building = data["tree"][0]
    assert building["type"] == "Building"
    floor = building["spaces"][0]
    assert floor["name"] == "Ground Floor"

    device = floor["devices"][0]
    assert device["address"] == "1.1.1"
    assert device["manufacturer"] == "ACME"

    # O-1 is channelled, O-3 is unassigned, O-2 (no links) is dropped.
    assert len(device["channels"]) == 1
    assert device["channels"][0]["name"] == "Channel A"
    assert device["channels"][0]["kos"][0]["number"] == 1
    assert device["channels"][0]["kos"][0]["group_addresses"][0] == {"address": "1/2/3", "name": "Light On/Off"}
    # DPTs carry a resolved descriptive name for the building view (#160).
    assert device["channels"][0]["kos"][0]["dpts"] == [{"main": 1, "sub": 1, "name": "1.001 - Switch"}]
    assert len(device["kos"]) == 1
    assert device["kos"][0]["number"] == 3

    # The orphan device is reported separately.
    assert [d["address"] for d in data["unassigned_devices"]] == ["1.1.9"]


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


def _stored_telegram(destination: str, value: float) -> StoredTelegram:
    return StoredTelegram(
        timestamp=datetime(2023, 1, 1),
        source="1.1.1",
        destination=destination,
        telegramtype="GroupValueWrite",
        direction="Incoming",
        dpt_main=5,
        dpt_sub=1,
        payload=None,
        value=value,
        raw_data="7f",
        source_name="Test Source",
        destination_name="Test GA",
    )


@patch("database.store.get_last_unique_telegrams", new_callable=AsyncMock)
def test_get_last_telegrams(mock_last):
    mock_last.return_value = [_stored_telegram("1/2/3", 50.0), _stored_telegram("4/5/6", 25.0)]

    response = client.get("/api/telegrams/last")
    assert response.status_code == 200
    data = response.json()
    assert len(data["telegrams"]) == 2
    assert data["telegrams"][0]["target_address"] == "1/2/3"
    # Serialized like /api/telegrams (DPT names, formatted values, ...)
    assert data["telegrams"][0]["value_formatted"] is not None
    assert data["telegrams"][0]["dpt_name"] is not None


@patch("database.store.get_last_unique_telegrams", new_callable=AsyncMock)
def test_get_last_telegrams_filtered(mock_last):
    mock_last.return_value = [_stored_telegram("1/2/3", 50.0), _stored_telegram("4/5/6", 25.0)]

    response = client.get("/api/telegrams/last?target_address=4/5/6,7/8/9")
    assert response.status_code == 200
    data = response.json()
    assert [t["target_address"] for t in data["telegrams"]] == ["4/5/6"]


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


def _make_stats(count=100, size=4096):
    from knx_telegram_store import StoreStats

    return StoreStats(
        telegram_count=count,
        oldest_timestamp=datetime(2026, 1, 1, tzinfo=UTC),
        newest_timestamp=datetime(2026, 7, 1, tzinfo=UTC),
        size_bytes=size,
        backend="sqlite",
        retention_days=30,
    )


def _optimizable_caps():
    """A writable SQL backend advertising size stats + optimize (e.g. sqlite)."""
    from knx_telegram_store import StoreCapabilities

    return StoreCapabilities(
        supports_time_range=True,
        supports_time_delta=True,
        supports_pagination=True,
        supports_count=True,
        supports_size_stats=True,
        supports_optimize=True,
        read_only=False,
    )


def _patch_capabilities(caps):
    """Pins store.capabilities so these tests don't depend on the ambient DB
    backend (Postgres correctly reports supports_optimize=False since 0.7.1)."""
    from unittest.mock import PropertyMock

    import database

    return patch.object(type(database.store), "capabilities", new_callable=PropertyMock, return_value=caps)


@patch("database.store.get_stats", new_callable=AsyncMock)
def test_database_info(mock_stats):
    mock_stats.return_value = _make_stats()

    with _patch_capabilities(_optimizable_caps()):
        response = client.get("/api/database/info")
    assert response.status_code == 200
    data = response.json()
    assert data["backend"] == "sqlite"
    assert data["telegram_count"] == 100
    assert data["size_bytes"] == 4096
    assert data["oldest_timestamp"].startswith("2026-01-01")
    assert data["newest_timestamp"].startswith("2026-07-01")
    assert data["retention_days"] == 30
    # A writable SQL backend (e.g. sqlite) supports both maintenance features
    assert data["supports_size_stats"] is True
    assert data["supports_optimize"] is True


@patch("database.store.evict_older_than", new_callable=AsyncMock)
def test_database_purge_dry_run(mock_evict):
    mock_evict.return_value = 42

    response = client.post(
        "/api/database/purge",
        json={"older_than": "2026-06-01T00:00:00+00:00", "dry_run": True},
    )
    assert response.status_code == 200
    assert response.json() == {"deleted": 42, "dry_run": True}

    args, kwargs = mock_evict.call_args
    assert args[0] == datetime(2026, 6, 1, tzinfo=UTC)
    assert kwargs["dry_run"] is True


@patch("database.store.evict_older_than", new_callable=AsyncMock)
def test_database_purge_naive_cutoff_treated_as_utc(mock_evict):
    mock_evict.return_value = 7

    response = client.post(
        "/api/database/purge",
        json={"older_than": "2026-06-01T00:00:00"},
    )
    assert response.status_code == 200
    assert response.json() == {"deleted": 7, "dry_run": False}
    assert mock_evict.call_args[0][0] == datetime(2026, 6, 1, tzinfo=UTC)


def test_database_purge_requires_cutoff_or_all():
    response = client.post("/api/database/purge", json={})
    assert response.status_code == 400


@patch("database.store.clear", new_callable=AsyncMock)
@patch("database.store.get_stats", new_callable=AsyncMock)
def test_database_purge_all(mock_stats, mock_clear):
    mock_stats.return_value = _make_stats(count=555)

    # Dry run: report count, don't clear
    response = client.post("/api/database/purge", json={"purge_all": True, "dry_run": True})
    assert response.status_code == 200
    assert response.json() == {"deleted": 555, "dry_run": True}
    mock_clear.assert_not_called()

    # Real purge
    response = client.post("/api/database/purge", json={"purge_all": True})
    assert response.status_code == 200
    assert response.json() == {"deleted": 555, "dry_run": False}
    mock_clear.assert_awaited_once()


@patch("database.store.optimize", new_callable=AsyncMock)
@patch("database.store.get_stats", new_callable=AsyncMock)
def test_database_optimize(mock_stats, mock_optimize):
    mock_stats.side_effect = [_make_stats(size=8192), _make_stats(size=2048)]

    with _patch_capabilities(_optimizable_caps()):
        response = client.post("/api/database/optimize")
    assert response.status_code == 200
    assert response.json() == {"size_bytes_before": 8192, "size_bytes_after": 2048}
    mock_optimize.assert_awaited_once()


def _read_only_caps():
    from knx_telegram_store import StoreCapabilities

    return StoreCapabilities(
        supports_time_range=True,
        supports_time_delta=True,
        supports_pagination=True,
        supports_count=True,
        supports_size_stats=True,
        supports_optimize=False,
        read_only=True,
    )


@patch("database.store.get_stats", new_callable=AsyncMock)
def test_database_info_reports_read_only(mock_stats):
    from unittest.mock import PropertyMock

    import database

    mock_stats.return_value = _make_stats()
    with patch.object(type(database.store), "capabilities", new_callable=PropertyMock, return_value=_read_only_caps()):
        response = client.get("/api/database/info")
    assert response.status_code == 200
    data = response.json()
    assert data["read_only"] is True
    assert data["supports_optimize"] is False


def test_database_purge_rejected_when_read_only():
    from unittest.mock import PropertyMock

    import database

    with patch.object(type(database.store), "capabilities", new_callable=PropertyMock, return_value=_read_only_caps()):
        response = client.post("/api/database/purge", json={"purge_all": True})
        assert response.status_code == 403
        response = client.post("/api/database/optimize")
        assert response.status_code == 403
