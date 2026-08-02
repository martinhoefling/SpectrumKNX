import asyncio
from backend import knx_daemon
from backend.api import get_statistics

async def main():
    knx_daemon.global_knx_project = {"fake": "project"}
    knx_daemon.project_name_map = {"ga": {"1/1/1": "Test GA"}, "ia": {"1.1.1": "Test IA"}}

    # Just setting up mock store to avoid DB errors
    from backend import api, database
    from unittest.mock import AsyncMock, patch

    class MockResult:
        def fetchall(self):
            return []

    class MockConn:
        async def execute(self, *args, **kwargs):
            return MockResult()
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args, **kwargs):
            pass

    class MockEngine:
        def connect(self):
            return MockConn()

    api.engine = MockEngine()

    try:
        res = await get_statistics()
        print("Success!", res)
    except Exception as e:
        import traceback
        traceback.print_exc()

asyncio.run(main())
