from fastapi import APIRouter, Header, HTTPException
import asyncpg
from typing import Optional

from app.core.config import settings

router = APIRouter()


def _dsn() -> str:
    return settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")


def _username(authorization: Optional[str]) -> str:
    if authorization and authorization.startswith("Bearer demo_token_"):
        return authorization.replace("Bearer demo_token_", "", 1)
    return "system"


async def _alert_rows(conn: asyncpg.Connection, where: str = "", limit: int = 100):
    return await conn.fetch(
        f"""
        SELECT
            a.id::text,
            a.level::text,
            a.status::text,
            a.confidence_score,
            a.triggered_at,
            a.resolved_at,
            a.resolution_note,
            a.max_delta_cm,
            a.max_rate,
            a.max_zscore,
            a.sensor_count,
            COALESCE(array_agg(DISTINCT s.code) FILTER (WHERE s.code IS NOT NULL), ARRAY[]::varchar[]) AS sensors
        FROM alerts a
        LEFT JOIN alert_sensor_evidence ase ON ase.alert_id = a.id
        LEFT JOIN sensors s ON s.id = ase.sensor_id
        {where}
        GROUP BY a.id
        ORDER BY a.triggered_at DESC
        LIMIT $1
        """,
        limit,
    )


@router.get("/active")
async def active_alerts():
    conn = await asyncpg.connect(_dsn())
    try:
        rows = await _alert_rows(conn, "WHERE a.status IN ('active','confirmed')", 50)
        current_level = rows[0]["level"] if rows else "normal"
        return {"alerts": [dict(row) for row in rows], "current_level": current_level}
    finally:
        await conn.close()


@router.get("/")
async def list_alerts(limit: int = 100):
    conn = await asyncpg.connect(_dsn())
    try:
        rows = await _alert_rows(conn, "", min(max(limit, 1), 500))
        total = await conn.fetchval("SELECT COUNT(*) FROM alerts")
        return {"alerts": [dict(row) for row in rows], "total": total}
    finally:
        await conn.close()


@router.post("/{alert_id}/resolve")
async def resolve_alert(alert_id: str, reason: str = "", authorization: Optional[str] = Header(default=None)):
    username = _username(authorization)
    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            user_id = await conn.fetchval("SELECT id FROM users WHERE username = $1", username)
            row = await conn.fetchrow(
                """
                UPDATE alerts
                SET status = 'resolved',
                    resolved_at = NOW(),
                    resolved_by = $2,
                    resolution_note = $3
                WHERE id = $1::uuid
                RETURNING id::text
                """,
                alert_id,
                user_id,
                reason,
            )
            if not row:
                raise HTTPException(status_code=404, detail="Alert tidak ditemukan")
            await conn.execute(
                """
                INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, reason)
                VALUES ($1, $2, 'ALERT_RESOLVED', 'alerts', $3, $4)
                """,
                user_id,
                username,
                alert_id,
                reason or "Alert diselesaikan",
            )
        return {"success": True, "alert_id": alert_id}
    finally:
        await conn.close()
