from datetime import datetime
from typing import Any


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[Any, dict[str, Any]] = {}

    async def connect(self, websocket: Any):
        await websocket.accept()
        self.active_connections[websocket] = {}

    def disconnect(self, websocket: Any):
        if websocket in self.active_connections:
            del self.active_connections[websocket]

    async def update_filters(self, websocket: Any, filters: dict[str, Any]):
        """Update the server-side filters for this specific connection."""
        self.active_connections[websocket] = filters

    async def broadcast(self, telegram: dict):
        """Broadcasts telegrams to connected clients, applying server-side filters."""
        if "timestamp" in telegram and isinstance(telegram["timestamp"], datetime):
            telegram["timestamp"] = telegram["timestamp"].isoformat()

        for connection, filters in list(self.active_connections.items()):
            # Apply filters if present
            should_send = True
            for key, val in filters.items():
                if telegram.get(key) != val:
                    should_send = False
                    break
            
            if not should_send:
                continue

            try:
                await connection.send_json(telegram)
            except Exception:
                self.disconnect(connection)


manager = ConnectionManager()
