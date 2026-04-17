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
                            "dpt": "1.001",
                            "dpt_main": 1,
                            "dpt_sub": 1,
                            "raw_data": b"\x01",
                            "value_numeric": 1.0,
                            "value_json": None
                        }
                    ]
            return MockMappings()

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
