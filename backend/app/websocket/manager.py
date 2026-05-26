"""
WebSocket Connection Manager
Handles broadcasting sensor, alert, siren, health, simulation events
"""
import json
import asyncio
import logging
from typing import Dict, List
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.client_roles: Dict[WebSocket, str] = {}

    async def connect(self, websocket: WebSocket, role: str = "operator"):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.client_roles[websocket] = role
        logger.info(f"WS connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        self.client_roles.pop(websocket, None)
        logger.info(f"WS disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, event_type: str, data: dict):
        message = json.dumps({
            "event": event_type,
            "data": data,
        })
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                disconnected.append(connection)
        for conn in disconnected:
            self.disconnect(conn)

    async def broadcast_sensor_update(self, sensor_data: dict):
        await self.broadcast("sensor_update", sensor_data)

    async def broadcast_alert(self, alert_data: dict):
        await self.broadcast("alert", alert_data)

    async def broadcast_siren(self, siren_data: dict):
        await self.broadcast("siren_event", siren_data)

    async def broadcast_health(self, health_data: dict):
        await self.broadcast("system_health", health_data)

    async def broadcast_simulation(self, sim_data: dict):
        await self.broadcast("simulation_update", sim_data)


manager = ConnectionManager()
