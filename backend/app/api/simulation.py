from fastapi import APIRouter
from pydantic import BaseModel
from app.services.sensor_stream import get_simulation_state, set_simulation_mode
from app.websocket.manager import manager
from datetime import datetime, timezone

router = APIRouter()

class SimStart(BaseModel):
    scenario: str = "normal"
    water_override: float = 0.0

@router.post("/start")
async def start_simulation(body: SimStart):
    set_simulation_mode("simulation", body.scenario, body.water_override)
    await manager.broadcast_simulation({
        "action": "start",
        "scenario": body.scenario,
        "water_override": body.water_override,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"success": True, "mode": "simulation", "scenario": body.scenario}

@router.post("/stop")
async def stop_simulation():
    set_simulation_mode("live")
    await manager.broadcast_simulation({
        "action": "stop",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"success": True, "mode": "live"}

@router.post("/update")
async def update_simulation(body: SimStart):
    set_simulation_mode("simulation", body.scenario, body.water_override)
    return {"success": True, "water_override": body.water_override}

@router.get("/status")
async def simulation_status():
    return get_simulation_state()
