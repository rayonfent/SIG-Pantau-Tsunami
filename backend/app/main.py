"""
SIG-PANTAU TSUNAMI - FastAPI Main Application
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.websocket.manager import manager
from app.services.sensor_stream import stream_sensors
from app.api import sensors, alerts, sirens, evacuation, facilities, simulation, auth, map_data, audit, reports

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start sensor stream background task
    task = asyncio.create_task(stream_sensors())
    logger.info("✅ Sensor stream started")
    yield
    task.cancel()
    logger.info("🛑 Sensor stream stopped")


app = FastAPI(
    title="SIG-PANTAU TSUNAMI API",
    description="Sistem Informasi Geografis Deteksi Dini Tsunami - Panjang, Lampung",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(map_data.router, prefix="/api/map", tags=["Map"])
app.include_router(sensors.router, prefix="/api/sensors", tags=["Sensors"])
app.include_router(alerts.router, prefix="/api/alerts", tags=["Alerts"])
app.include_router(sirens.router, prefix="/api/sirens", tags=["Sirens"])
app.include_router(evacuation.router, prefix="/api/evacuation", tags=["Evacuation"])
app.include_router(facilities.router, prefix="/api/facilities", tags=["Facilities"])
app.include_router(simulation.router, prefix="/api/simulation", tags=["Simulation"])
app.include_router(audit.router, prefix="/api/audit", tags=["Audit"])
app.include_router(reports.router, prefix="/api/reports", tags=["Reports"])


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Echo back ping
            if data == "ping":
                await websocket.send_text('{"event":"pong"}')
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "SIG-PANTAU TSUNAMI", "version": "1.0.0"}
