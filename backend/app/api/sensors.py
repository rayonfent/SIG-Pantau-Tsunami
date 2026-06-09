from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from typing import Optional
import asyncpg

from app.core.config import settings

router = APIRouter()


class SensorPayload(BaseModel):
    code: str
    name: str
    lng: float
    lat: float
    address: str = ""
    elevation_m: float = 0
    is_primary: bool = True
    status: str = "online"


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
        VALUES ($1, $2, $3, 'sensors', $4, $5)
        """,
        user_id,
        username,
        action,
        entity_id,
        reason,
    )


@router.get("/")
async def list_sensors():
    conn = await asyncpg.connect(_dsn())
    try:
        rows = await conn.fetch(
            """
            SELECT
                s.id::text,
                s.code,
                s.name,
                s.status::text,
                s.last_seen,
                ST_X(s.location::geometry) AS lng,
                ST_Y(s.location::geometry) AS lat,
                r.water_level_cm,
                r.delta_1m,
                r.delta_3m,
                r.delta_5m,
                r.rate_cm_per_min,
                r.z_score,
                r.quality::text AS quality,
                r.recorded_at AS timestamp
            FROM sensors s
            LEFT JOIN LATERAL (
                SELECT *
                FROM sensor_readings sr
                WHERE sr.sensor_id = s.id
                ORDER BY sr.recorded_at DESC
                LIMIT 1
            ) r ON TRUE
            ORDER BY s.code
            """
        )
        return {"sensors": [dict(row) for row in rows]}
    finally:
        await conn.close()


@router.post("/")
async def create_sensor(payload: SensorPayload, authorization: Optional[str] = Header(default=None)):
    username = _username(authorization)
    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                INSERT INTO sensors (code, name, location, address, elevation_m, is_primary, status, last_seen)
                VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, $8::sensor_status, NOW())
                RETURNING id::text, code, name, status::text
                """,
                payload.code,
                payload.name,
                payload.lng,
                payload.lat,
                payload.address,
                payload.elevation_m,
                payload.is_primary,
                payload.status,
            )
            await _audit(conn, username, "CREATE_MASTER_DATA", row["id"], f"Sensor {payload.code} dibuat")
        return {"success": True, "sensor": dict(row)}
    finally:
        await conn.close()


@router.put("/{sensor_id}")
async def update_sensor(sensor_id: str, payload: SensorPayload, authorization: Optional[str] = Header(default=None)):
    username = _username(authorization)
    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE sensors
                SET code = $2,
                    name = $3,
                    location = ST_SetSRID(ST_MakePoint($4, $5), 4326),
                    address = $6,
                    elevation_m = $7,
                    is_primary = $8,
                    status = $9::sensor_status
                WHERE id = $1::uuid
                RETURNING id::text, code, name, status::text
                """,
                sensor_id,
                payload.code,
                payload.name,
                payload.lng,
                payload.lat,
                payload.address,
                payload.elevation_m,
                payload.is_primary,
                payload.status,
            )
            if not row:
                raise HTTPException(status_code=404, detail="Sensor tidak ditemukan")
            await _audit(conn, username, "UPDATE_MASTER_DATA", sensor_id, f"Sensor {payload.code} diperbarui")
        return {"success": True, "sensor": dict(row)}
    finally:
        await conn.close()


@router.delete("/{sensor_id}")
async def delete_sensor(sensor_id: str, authorization: Optional[str] = Header(default=None)):
    username = _username(authorization)
    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            exists = await conn.fetchval("SELECT code FROM sensors WHERE id = $1::uuid", sensor_id)
            if not exists:
                raise HTTPException(status_code=404, detail="Sensor tidak ditemukan")
            await conn.execute("DELETE FROM sensor_readings WHERE sensor_id = $1::uuid", sensor_id)
            await conn.execute("DELETE FROM sensors WHERE id = $1::uuid", sensor_id)
            await _audit(conn, username, "DELETE_MASTER_DATA", sensor_id, f"Sensor {exists} dihapus")
        return {"success": True, "sensor_id": sensor_id}
    finally:
        await conn.close()


@router.get("/{sensor_id}/readings")
async def sensor_readings(sensor_id: str, limit: int = 30):
    conn = await asyncpg.connect(_dsn())
    try:
        exists = await conn.fetchval("SELECT EXISTS(SELECT 1 FROM sensors WHERE id = $1::uuid)", sensor_id)
        if not exists:
            raise HTTPException(status_code=404, detail="Sensor tidak ditemukan")
        rows = await conn.fetch(
            """
            SELECT
                id,
                sensor_id::text,
                recorded_at AS timestamp,
                water_level_cm,
                raw_value,
                quality::text AS quality,
                delta_1m,
                delta_3m,
                delta_5m,
                rate_cm_per_min,
                z_score,
                smoothed_level,
                baseline_median
            FROM sensor_readings
            WHERE sensor_id = $1::uuid
            ORDER BY recorded_at DESC
            LIMIT $2
            """,
            sensor_id,
            min(max(limit, 1), 500),
        )
        return {"readings": [dict(row) for row in rows], "sensor_id": sensor_id}
    finally:
        await conn.close()
