import pytest
from fastapi.testclient import TestClient
from main import app
import knx_daemon
from database import get_db

client = TestClient(app)

def test_read_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "app": "KNX Analyzer"}

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

# Mock Database Dependency
async def override_get_db():
    class MockResult:
        def mappings(self):
            class MockMappings:
                def all(self):
                    return [
                        {
                            "timestamp": "2023-01-01T00:00:00Z", 
                            "source_address": "1.1.1", 
                            "target_address": "1/2/3",
                            "telegram_type": "GroupValueWrite",
                            "raw_data": b"\x01" # bytes required hex encoding testing
                        }
                    ]
            return MockMappings()

    class MockSession:
        async def execute(self, query):
            return MockResult()
            
    yield MockSession()

app.dependency_overrides[get_db] = override_get_db

def test_get_telegrams():
    response = client.get("/api/telegrams?limit=10&source_address=1.1.1&target_address=1/2/3&telegram_type=GroupValueWrite")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["source_address"] == "1.1.1"
    assert data[0]["raw_data"] == "01" # Should be correctly hex encoded by the API route
