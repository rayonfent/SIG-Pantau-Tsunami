from datetime import datetime, timezone

from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
import asyncpg

from app.core.config import settings

router = APIRouter()


class ThresholdPayload(BaseModel):
    name: str = "Konfigurasi Default MVP"
    suspect_delta3m: float = 15
    suspect_zscore: float = 2
    waspada_delta3m: float = 25
    waspada_rate: float = 8
    waspada_zscore: float = 2.5
    siaga_delta3m: float = 40
    siaga_rate: float = 13
    siaga_zscore: float = 3
    awas_delta3m: float = 60
    awas_rate: float = 20
    awas_zscore: float = 3.5
    min_sensors_confirm: int = 2
    confirm_window_sec: int = 60
    siren_auto_level: str = "awas"


def _dsn() -> str:
    return settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")


def _username(authorization: Optional[str]) -> str:
    if authorization and authorization.startswith("Bearer demo_token_"):
        return authorization.replace("Bearer demo_token_", "", 1)
    return "system"


@router.get("/dashboard")
async def dashboard_summary():
    conn = await asyncpg.connect(_dsn())
    try:
        row = await conn.fetchrow(
            """
            SELECT
                (SELECT COUNT(*) FROM sensors WHERE status = 'online') AS sensors_online,
                (SELECT COUNT(*) FROM sensors WHERE status <> 'online') AS sensors_offline,
                (SELECT COUNT(*) FROM sensors) AS sensors_total,
                (SELECT COUNT(*) FROM alerts WHERE status IN ('active','confirmed')) AS alerts_active,
                (SELECT COUNT(*) FROM alerts WHERE triggered_at::date = CURRENT_DATE) AS alerts_today,
                (SELECT COUNT(*) FROM sirens WHERE status = 'active') AS sirens_active,
                (SELECT COUNT(*) FROM sirens WHERE status <> 'active') AS sirens_inactive,
                (SELECT COUNT(*) FROM sirens) AS sirens_total,
                (SELECT level::text FROM alerts WHERE status IN ('active','confirmed') ORDER BY triggered_at DESC LIMIT 1) AS active_level,
                (SELECT level::text FROM alerts ORDER BY triggered_at DESC LIMIT 1) AS latest_level,
                (SELECT triggered_at FROM alerts ORDER BY triggered_at DESC LIMIT 1) AS latest_alert_at
            """
        )
        readings = await conn.fetch(
            """
            SELECT
                s.code,
                s.name,
                r.recorded_at AS timestamp,
                r.water_level_cm,
                r.delta_3m,
                r.rate_cm_per_min,
                r.z_score,
                r.quality::text AS quality
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
        alerts = await conn.fetch(
            """
            SELECT id::text, level::text, status::text, confidence_score, triggered_at, max_delta_cm, max_rate, max_zscore, sensor_count
            FROM alerts
            ORDER BY triggered_at DESC
            LIMIT 10
            """
        )
        return {
            **dict(row),
            "current_level": row["active_level"] or "normal",
            "backend_status": "ok",
            "database_status": "ok",
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "readings": [dict(r) for r in readings],
            "latest_alerts": [dict(a) for a in alerts],
        }
    finally:
        await conn.close()


@router.get("/threshold-config")
async def threshold_config():
    conn = await asyncpg.connect(_dsn())
    try:
        row = await conn.fetchrow(
            """
            SELECT
                id::text,
                name,
                is_active,
                suspect_delta3m,
                suspect_zscore,
                waspada_delta3m,
                waspada_rate,
                waspada_zscore,
                siaga_delta3m,
                siaga_rate,
                siaga_zscore,
                awas_delta3m,
                awas_rate,
                awas_zscore,
                min_sensors_confirm,
                confirm_window_sec,
                siren_auto_level,
                updated_at
            FROM threshold_configs
            WHERE is_active = TRUE
            ORDER BY created_at DESC
            LIMIT 1
            """
        )
        if not row:
            raise HTTPException(status_code=404, detail="Konfigurasi threshold tidak ditemukan")
        return {"config": dict(row)}
    finally:
        await conn.close()


@router.put("/threshold-config")
async def update_threshold_config(payload: ThresholdPayload, authorization: Optional[str] = Header(default=None)):
    username = _username(authorization)
    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            user_id = await conn.fetchval("SELECT id FROM users WHERE username = $1", username)
            config_id = await conn.fetchval("SELECT id FROM threshold_configs WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 1")
            if not config_id:
                config_id = await conn.fetchval(
                    "INSERT INTO threshold_configs (name, is_active, created_by) VALUES ($1, TRUE, $2) RETURNING id",
                    payload.name,
                    user_id,
                )
            row = await conn.fetchrow(
                """
                UPDATE threshold_configs
                SET name=$2,
                    suspect_delta3m=$3,
                    suspect_zscore=$4,
                    waspada_delta3m=$5,
                    waspada_rate=$6,
                    waspada_zscore=$7,
                    siaga_delta3m=$8,
                    siaga_rate=$9,
                    siaga_zscore=$10,
                    awas_delta3m=$11,
                    awas_rate=$12,
                    awas_zscore=$13,
                    min_sensors_confirm=$14,
                    confirm_window_sec=$15,
                    siren_auto_level=$16,
                    updated_at=NOW()
                WHERE id=$1
                RETURNING id::text, name
                """,
                config_id,
                payload.name,
                payload.suspect_delta3m,
                payload.suspect_zscore,
                payload.waspada_delta3m,
                payload.waspada_rate,
                payload.waspada_zscore,
                payload.siaga_delta3m,
                payload.siaga_rate,
                payload.siaga_zscore,
                payload.awas_delta3m,
                payload.awas_rate,
                payload.awas_zscore,
                payload.min_sensors_confirm,
                payload.confirm_window_sec,
                payload.siren_auto_level,
            )
            await conn.execute(
                """
                INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, reason)
                VALUES ($1, $2, 'THRESHOLD_CHANGED', 'threshold_configs', $3, 'Konfigurasi threshold diperbarui')
                """,
                user_id,
                username,
                str(config_id),
            )
        return {"success": True, "config": dict(row)}
    finally:
        await conn.close()


@router.get("/daily")
async def daily_report():
    conn = await asyncpg.connect(_dsn())
    try:
        level_rows = await conn.fetch(
            """
            SELECT level::text, COUNT(*) AS count
            FROM alerts
            WHERE triggered_at::date = CURRENT_DATE
            GROUP BY level
            """
        )
        row = await conn.fetchrow(
            """
            SELECT
                CURRENT_DATE::text AS date,
                (SELECT COUNT(*) FROM alerts WHERE triggered_at::date = CURRENT_DATE) AS alerts,
                (SELECT COUNT(*) FROM siren_events WHERE created_at::date = CURRENT_DATE) AS siren_events,
                (SELECT COUNT(*) FROM system_events WHERE created_at::date = CURRENT_DATE) AS system_events,
                (SELECT COUNT(*) FROM sensors) AS sensors_total,
                (SELECT COUNT(*) FROM sensors WHERE status <> 'online') AS sensors_offline,
                (SELECT COUNT(*) FROM sirens) AS sirens_total,
                (SELECT COUNT(*) FROM sirens WHERE status = 'active') AS sirens_active
            """
        )
        return {**dict(row), "level_distribution": [dict(r) for r in level_rows]}
    finally:
        await conn.close()


@router.get("/device-health")
async def device_health():
    conn = await asyncpg.connect(_dsn())
    try:
        row = await conn.fetchrow(
            """
            SELECT
                (SELECT COUNT(*) FROM sensors WHERE status = 'online') AS sensors_online,
                (SELECT COUNT(*) FROM sensors) AS sensors_total,
                (SELECT COUNT(*) FROM sirens WHERE status <> 'fault') AS sirens_ok,
                (SELECT COUNT(*) FROM sirens WHERE status = 'fault') AS sirens_fault,
                (SELECT COUNT(*) FROM sirens WHERE status = 'active') AS sirens_active
            """
        )
        return dict(row)
    finally:
        await conn.close()
