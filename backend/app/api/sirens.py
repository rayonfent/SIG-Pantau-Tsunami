from datetime import datetime, timezone
from typing import Optional

import asyncpg
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.core.config import settings
from app.websocket.manager import manager

router = APIRouter()


class SirenAction(BaseModel):
    reason: str = ""
    confirm_pin: str = ""


class SirenPayload(BaseModel):
    code: str
    name: str
    lng: float
    lat: float
    radius_m: float = 500
    status: str = "inactive"
    is_auto_enabled: bool = True


def _dsn() -> str:
    return settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")


def _username(authorization: Optional[str]) -> str:
    if authorization and authorization.startswith("Bearer demo_token_"):
        return authorization.replace("Bearer demo_token_", "", 1)
    return "system"


async def _audit(conn, username: str, action: str, entity_id: str, reason: str):
    user_id = await conn.fetchval("SELECT id FROM users WHERE username = $1", username)
    await conn.execute(
        """
        INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, reason)
        VALUES ($1, $2, $3, 'sirens', $4, $5)
        """,
        user_id,
        username,
        action,
        entity_id,
        reason,
    )


@router.get("/")
async def list_sirens():
    conn = await asyncpg.connect(_dsn())
    try:
        rows = await conn.fetch(
            """
            SELECT
                id::text,
                code,
                name,
                status::text,
                radius_m,
                is_auto_enabled,
                last_tested,
                last_activated,
                ST_X(location::geometry) AS lng,
                ST_Y(location::geometry) AS lat
            FROM sirens
            ORDER BY code
            """
        )
        return {"sirens": [dict(row) for row in rows]}
    finally:
        await conn.close()


@router.post("/")
async def create_siren(payload: SirenPayload, authorization: Optional[str] = Header(default=None)):
    username = _username(authorization)
    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                INSERT INTO sirens (code, name, location, radius_m, status, is_auto_enabled)
                VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6::siren_status, $7)
                RETURNING id::text, code, name, status::text
                """,
                payload.code, payload.name, payload.lng, payload.lat, payload.radius_m, payload.status, payload.is_auto_enabled,
            )
            await _audit(conn, username, "CREATE_MASTER_DATA", row["id"], f"Sirine {payload.code} dibuat")
        return {"success": True, "siren": dict(row)}
    finally:
        await conn.close()


@router.put("/{siren_id}")
async def update_siren(siren_id: str, payload: SirenPayload, authorization: Optional[str] = Header(default=None)):
    username = _username(authorization)
    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE sirens
                SET code=$2, name=$3, location=ST_SetSRID(ST_MakePoint($4,$5),4326),
                    radius_m=$6, status=$7::siren_status, is_auto_enabled=$8
                WHERE id=$1::uuid
                RETURNING id::text, code, name, status::text
                """,
                siren_id, payload.code, payload.name, payload.lng, payload.lat, payload.radius_m, payload.status, payload.is_auto_enabled,
            )
            if not row:
                raise HTTPException(status_code=404, detail="Sirine tidak ditemukan")
            await _audit(conn, username, "UPDATE_MASTER_DATA", siren_id, f"Sirine {payload.code} diperbarui")
        return {"success": True, "siren": dict(row)}
    finally:
        await conn.close()


@router.delete("/{siren_id}")
async def delete_siren(siren_id: str, authorization: Optional[str] = Header(default=None)):
    username = _username(authorization)
    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            code = await conn.fetchval("SELECT code FROM sirens WHERE id=$1::uuid", siren_id)
            if not code:
                raise HTTPException(status_code=404, detail="Sirine tidak ditemukan")
            await conn.execute("DELETE FROM siren_events WHERE siren_id=$1::uuid", siren_id)
            await conn.execute("DELETE FROM sirens WHERE id=$1::uuid", siren_id)
            await _audit(conn, username, "DELETE_MASTER_DATA", siren_id, f"Sirine {code} dihapus")
        return {"success": True, "siren_id": siren_id}
    finally:
        await conn.close()


async def _change_siren(siren_id: str, action: str, body: SirenAction, authorization: Optional[str]):
    username = _username(authorization)
    status = "active" if action == "manual_on" else "inactive"
    event_type = "manual_on" if action == "manual_on" else "manual_off"
    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            user_id = await conn.fetchval("SELECT id FROM users WHERE username = $1", username)
            row = await conn.fetchrow(
                """
                UPDATE sirens
                SET status = $2::siren_status,
                    last_activated = CASE WHEN $2 = 'active' THEN NOW() ELSE last_activated END
                WHERE id = $1::uuid
                RETURNING id::text, code, name, status::text, radius_m
                """,
                siren_id,
                status,
            )
            if not row:
                raise HTTPException(status_code=404, detail="Sirine tidak ditemukan")
            await conn.execute(
                """
                INSERT INTO siren_events (siren_id, event_type, triggered_by, reason, success)
                VALUES ($1::uuid, $2, $3, $4, TRUE)
                """,
                siren_id,
                event_type,
                user_id,
                body.reason,
            )
            await conn.execute(
                """
                INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, reason)
                VALUES ($1, $2, $3, 'sirens', $4, $5)
                """,
                user_id,
                username,
                "SIREN_ACTIVATED" if status == "active" else "SIREN_DEACTIVATED",
                siren_id,
                body.reason or event_type,
            )
        payload = {
            "action": action,
            "siren_id": siren_id,
            "reason": body.reason,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await manager.broadcast_siren(payload)
        return {"success": True, "siren": dict(row), "action": "on" if status == "active" else "off"}
    finally:
        await conn.close()


@router.post("/{siren_id}/on")
async def activate_siren(siren_id: str, body: SirenAction, authorization: Optional[str] = Header(default=None)):
    return await _change_siren(siren_id, "manual_on", body, authorization)


@router.post("/{siren_id}/off")
async def deactivate_siren(siren_id: str, body: SirenAction, authorization: Optional[str] = Header(default=None)):
    return await _change_siren(siren_id, "manual_off", body, authorization)


@router.post("/{siren_id}/test")
async def test_siren(siren_id: str, authorization: Optional[str] = Header(default=None)):
    username = _username(authorization)
    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            user_id = await conn.fetchval("SELECT id FROM users WHERE username = $1", username)
            row = await conn.fetchrow(
                "UPDATE sirens SET last_tested = NOW() WHERE id = $1::uuid RETURNING id::text, code, name",
                siren_id,
            )
            if not row:
                raise HTTPException(status_code=404, detail="Sirine tidak ditemukan")
            await conn.execute(
                """
                INSERT INTO siren_events (siren_id, event_type, triggered_by, reason, success)
                VALUES ($1::uuid, 'test', $2, 'Tes sirine manual', TRUE)
                """,
                siren_id,
                user_id,
            )
            await conn.execute(
                """
                INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, reason)
                VALUES ($1, $2, 'SIREN_TESTED', 'sirens', $3, 'Tes sirine manual')
                """,
                user_id,
                username,
                siren_id,
            )
        await manager.broadcast_siren({
            "action": "test",
            "siren_id": siren_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return {"success": True, "siren": dict(row), "action": "test"}
    finally:
        await conn.close()
