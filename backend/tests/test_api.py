from datetime import UTC, datetime

from fastapi.testclient import TestClient

import knx_daemon
from database import get_db
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
        }
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

# Mock Database Dependency


async def override_get_db():
    class MockResult:
        def mappings(self):
            class MockMappings:
                def all(self):
                    return [
                        {
                            "timestamp": datetime(2023, 1, 1),
                            "source_address": "1.1.1", 
                            "target_address": "1/2/3",
                            "telegram_type": "GroupValueWrite",
                            "dpt": "1.001",
                            "dpt_main": 1,
                            "dpt_sub": 1,
                            "raw_data": b"\x01",
                            "value_numeric": 1.0,
                            "value_json": None
                        }
                    ]
            return MockMappings()
        def fetchall(self):
            return [[datetime(2023, 1, 1)]]

    class MockSession:
        async def execute(self, query):
            return MockResult()
        
        async def scalar(self, query):
            return 1
            
    yield MockSession()

app.dependency_overrides[get_db] = override_get_db

def test_get_telegrams():
    response = client.get("/api/telegrams?limit=10&source_address=1.1.1&target_address=1/2/3&telegram_type=GroupValueWrite")
    assert response.status_code == 200
    data = response.json()
    # The API returns {"telegrams": [...], "metadata": {...}}
    assert "telegrams" in data
    assert len(data["telegrams"]) == 1
    assert data["telegrams"][0]["source_address"] == "1.1.1"
    assert data["telegrams"][0]["raw_data"] == "01" 

def test_get_filter_options_invalid_device_address():
    knx_daemon.global_knx_project = {
        "devices": {
            "invalid_address": {"name": "Broken Device"},
        },
        "group_addresses": {}
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
        }
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

def test_get_telegrams_extended_filters():
    # Test with dpt_main, start_time, and end_time
    response = client.get("/api/telegrams?limit=10&dpt_main=1,9&start_time=2023-01-01T00:00:00Z&end_time=2023-12-31T23:59:59Z")
    assert response.status_code == 200
    data = response.json()
    assert "telegrams" in data
    # Ensure our mock returns the 1 item
    assert len(data["telegrams"]) == 1

def test_get_telegrams_delta_no_match():
    # If delta search matches no core rows, it returns empty
    async def override_db_no_match():
        class MockResult:
            def fetchall(self):
                return []
        class MockSession:
            async def execute(self, query):
                return MockResult()
        yield MockSession()

    app.dependency_overrides[get_db] = override_db_no_match
    try:
        response = client.get("/api/telegrams?delta_before_ms=100&source_address=9.9.9")
        assert response.status_code == 200
        data = response.json()
        assert data["telegrams"] == []
        assert data["metadata"]["total_count"] == 0
    finally:
        app.dependency_overrides.pop(get_db, None)

def test_get_telegrams_delta_with_matches():
    from datetime import datetime, timedelta
    base_time = datetime(2023, 1, 1, 12, 0, 0, tzinfo=UTC)

    # We will mock the DB connection differently: instead of a single mock returning everything,
    # we inspect the SQL query. The real API endpoint does two queries:
    # 1. Fetching the matching timestamps
    # 2. Context query with bounds min_ts - before and max_ts + after
    async def override_db_matches():
        class MockMappings:
            def all(self):
                return [
                    {
                        "timestamp": base_time - timedelta(milliseconds=50),
                        "source_address": "1.1.2",
                        "target_address": "1/2/4",
                        "telegram_type": "GroupValueRead",
                        "dpt": "1.001",
                        "dpt_main": 1,
                        "dpt_sub": 1,
                        "raw_data": b"\x00",
                        "value_numeric": 0.0,
                        "value_json": None
                    },
                    {
                        "timestamp": base_time,
                        "source_address": "1.1.1",
                        "target_address": "1/2/3",
                        "telegram_type": "GroupValueWrite",
                        "dpt": "1.001",
                        "dpt_main": 1,
                        "dpt_sub": 1,
                        "raw_data": b"\x01",
                        "value_numeric": 1.0,
                        "value_json": None
                    },
                    {
                        "timestamp": base_time + timedelta(milliseconds=150),
                        "source_address": "1.1.3",
                        "target_address": "1/2/5",
                        "telegram_type": "GroupValueResponse",
                        "dpt": "1.001",
                        "dpt_main": 1,
                        "dpt_sub": 1,
                        "raw_data": b"\x01",
                        "value_numeric": 1.0,
                        "value_json": None
                    }
                ]
        class MockResultContext:
            def mappings(self):
                return MockMappings()

        class MockResultTs:
            def fetchall(self):
                return [(base_time,)]

        class MockSession:
            async def execute(self, query):
                query_str = str(query)
                # Ensure we only return MockResultTs when it's just selecting the timestamp
                if "SELECT telegrams.timestamp \nFROM telegrams" in query_str:
                    return MockResultTs()
                # Otherwise it's the context query
                return MockResultContext()
        yield MockSession()

    app.dependency_overrides[get_db] = override_db_matches
    try:
        response = client.get("/api/telegrams?delta_before_ms=100&delta_after_ms=100&source_address=1.1.1")
        assert response.status_code == 200
        data = response.json()
        assert len(data["telegrams"]) == 2
        assert data["metadata"]["total_count"] == 2
        sources = [t["source_address"] for t in data["telegrams"]]
        assert "1.1.1" in sources
        assert "1.1.2" in sources
        assert "1.1.3" not in sources
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_get_project_status_active(monkeypatch):
    monkeypatch.delenv("KNX_PROJECT_PATH", raising=False)
    monkeypatch.delenv("KNX_PASSWORD", raising=False)
    knx_daemon.global_knx_project = None
    
    response = client.get("/api/project/status")
    assert response.status_code == 200
    data = response.json()
    assert data["upload_feature_active"] is True
    assert data["project_loaded"] is False
    assert data["upload_required"] is True

def test_get_project_status_inactive(monkeypatch):
    monkeypatch.setenv("KNX_PROJECT_PATH", "/some/path")
    monkeypatch.setenv("KNX_PASSWORD", "secret")
    knx_daemon.global_knx_project = None
    
    response = client.get("/api/project/status")
    assert response.status_code == 200
    data = response.json()
    assert data["upload_feature_active"] is False
    assert data["upload_required"] is False

def test_upload_project_disabled(monkeypatch):
    monkeypatch.setenv("KNX_PROJECT_PATH", "/some/path")
    response = client.post("/api/project/upload", data={"password": "test"}, files={"file": ("test.knxproj", b"dummy")})
    assert response.status_code == 400
    assert "disabled" in response.json()["detail"]

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
    
    response = client.post("/api/project/upload", data={"password": "test_pass"}, files={"file": ("test.knxproj", b"dummy_content")})
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
