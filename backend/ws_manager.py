import json
from datetime import datetime
from typing import Dict, Any
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[WebSocket, Dict[str, Any]] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[websocket] = {}

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            del self.active_connections[websocket]

    async def update_filters(self, websocket: WebSocket, filters: Dict[str, Any]):
        # Retained for protocol compatibility — currently unused as live filtering
        # is handled entirely in the frontend.
        self.active_connections[websocket] = filters

    async def broadcast(self, telegram: dict):
        """Broadcasts every telegram to all connected clients — no server-side filtering.
        Live view filtering is performed in-memory in the React frontend."""
        if "timestamp" in telegram and isinstance(telegram["timestamp"], datetime):
            telegram["timestamp"] = telegram["timestamp"].isoformat()

        for connection in list(self.active_connections):
            try:
                await connection.send_json(telegram)
            except Exception:
                self.disconnect(connection)


manager = ConnectionManager()
