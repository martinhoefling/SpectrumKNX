from datetime import UTC, datetime

import pytest

from ws_manager import ConnectionManager


@pytest.mark.asyncio
async def test_websocket_manager():
    manager = ConnectionManager()
    
    class MockWebsocket:
        def __init__(self):
            self.accepted = False
            self.sent_data = []

        async def accept(self):
            self.accepted = True

        async def send_json(self, data):
            if data.get("raise_error"):
                 raise Exception("Simulated connection error")
            self.sent_data.append(data)

    ws1 = MockWebsocket()
    ws2 = MockWebsocket()
    
    await manager.connect(ws1)
    await manager.connect(ws2)
    assert ws1.accepted
    assert ws2.accepted
    
    # Update filters for ws1 (only wants telegrams from 1.1.1)
    await manager.update_filters(ws1, {"source_address": "1.1.1"})
    
    # Update filters for ws2 (wants GroupValueWrite only)
    await manager.update_filters(ws2, {"telegram_type": "GroupValueWrite"})
    
    # Broadcast telegram from 1.1.1 (Read)
    # Matches ws1 (source_addr), does NOT match ws2 (wrong type)
    await manager.broadcast({"source_address": "1.1.1", "target_address": "1/2/3", "telegram_type": "GroupValueRead"})
    assert len(ws1.sent_data) == 1
    assert len(ws2.sent_data) == 0
    
    # Broadcast telegram from 2.2.2 (Write)
    # Does NOT match ws1, matches ws2
    await manager.broadcast({"source_address": "2.2.2", "target_address": "1/2/3", "telegram_type": "GroupValueWrite"})
    assert len(ws1.sent_data) == 1
    assert len(ws2.sent_data) == 1
    
    # Test datetime JSON serialization handling
    ts = datetime(2023, 1, 1, tzinfo=UTC)
    await manager.broadcast({"source_address": "1.1.1", "telegram_type": "GroupValueWrite", "timestamp": ts})
    assert len(ws1.sent_data) == 2
    assert ws1.sent_data[1]["timestamp"] == ts.isoformat()
    
    # Test automatic disconnect on exception
    ws3 = MockWebsocket()
    await manager.connect(ws3)
    assert ws3 in manager.active_connections
    await manager.broadcast({"raise_error": True})
    assert ws3 not in manager.active_connections
    
    manager.disconnect(ws1)
    assert ws1 not in manager.active_connections
