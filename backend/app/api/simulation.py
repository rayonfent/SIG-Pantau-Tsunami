from fastapi import APIRouter, Header
from pydantic import BaseModel
from app.services.sensor_stream import get_simulation_state, set_simulation_mode
from app.websocket.manager import manager
from datetime import datetime, timezone
from typing import Optional
import asyncpg

from app.core.config import settings

router = APIRouter()

class SimStart(BaseModel):
    scenario: str = "normal"
    water_override: float = 0.0


def _dsn() -> str:
    return settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")


def _username(authorization: Optional[str]) -> str:
    if authorization and authorization.startswith("Bearer demo_token_"):
        return authorization.replace("Bearer demo_token_", "", 1)
    return "system"


@router.post("/start")
async def start_simulation(body: SimStart, authorization: Optional[str] = Header(default=None)):
    username = _username(authorization)
    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            user_id = await conn.fetchval("SELECT id FROM users WHERE username = $1", username)
            session_id = await conn.fetchval(
                """
                INSERT INTO simulation_sessions (name, scenario, status, water_level_override, started_by, started_at)
                VALUES ($1, $2, 'running', $3, $4, NOW())
                RETURNING id::text
                """,
                f"Simulasi {body.scenario}",
                body.scenario,
                body.water_override,
                user_id,
            )
            await conn.execute(
                """
                INSERT INTO system_events (event_type, severity, message, detail)
                VALUES ('SIMULATION_START', 'info', $1, $2::jsonb)
                """,
                f"Simulasi {body.scenario} dimulai",
                f'{{"scenario":"{body.scenario}","water_override":{body.water_override}}}',
            )
            await conn.execute(
                """
                INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, reason)
                VALUES ($1, $2, 'START_SIMULATION', 'simulation_sessions', $3, $4)
                """,
                user_id,
                username,
                session_id,
                f"Skenario {body.scenario}",
            )
    finally:
        await conn.close()

    set_simulation_mode("simulation", body.scenario, body.water_override, session_id)
    await manager.broadcast_simulation({
        "action": "start",
        "scenario": body.scenario,
        "water_override": body.water_override,
        "session_id": session_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"success": True, "mode": "simulation", "scenario": body.scenario, "session_id": session_id}

@router.post("/stop")
async def stop_simulation(authorization: Optional[str] = Header(default=None)):
    username = _username(authorization)
    state = get_simulation_state()
    session_id = state.get("session_id")
    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            user_id = await conn.fetchval("SELECT id FROM users WHERE username = $1", username)
            if session_id:
                await conn.execute(
                    """
                    UPDATE simulation_sessions
                    SET status = 'completed', ended_at = NOW()
                    WHERE id = $1::uuid
                    """,
                    session_id,
                )
            await conn.execute(
                """
                INSERT INTO system_events (event_type, severity, message)
                VALUES ('SIMULATION_STOP', 'info', 'Simulasi dihentikan')
                """
            )
            await conn.execute(
                """
                INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, reason)
                VALUES ($1, $2, 'STOP_SIMULATION', 'simulation_sessions', $3, 'Simulasi dihentikan')
                """,
                user_id,
                username,
                session_id,
            )
    finally:
        await conn.close()

    set_simulation_mode("live")
    await manager.broadcast_simulation({
        "action": "stop",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"success": True, "mode": "live"}

@router.post("/update")
async def update_simulation(body: SimStart):
    set_simulation_mode("simulation", body.scenario, body.water_override, get_simulation_state().get("session_id"))
    return {"success": True, "water_override": body.water_override}

@router.get("/status")
async def simulation_status():
    return get_simulation_state()
