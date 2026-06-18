"""
Sensor Stream Service
Generates realistic dummy sensor data every 10 seconds
Runs anomaly detection and broadcasts via WebSocket
"""
import asyncio
import math
import random
import logging
import asyncpg
from datetime import datetime, timezone
from collections import deque
from typing import Dict, Deque

from app.core.config import settings
from app.websocket.manager import manager
from app.services.detection_engine import (
    SensorReading, ThresholdConfig, detect_multi_sensor,
    simulate_water_level, moving_median
)

logger = logging.getLogger(__name__)

# Global simulation state
simulation_state = {
    "mode": "live",       # live | simulation
    "scenario": "normal",
    "water_override": 0.0,
    "tick": 0,
    "session_id": None,
}

# Per-sensor rolling windows for smoothing + baseline
sensor_windows: Dict[str, Deque[float]] = {}
sensor_baseline_windows: Dict[str, Deque[float]] = {}

SENSOR_DATA = [
    {"id": "aaaa0001-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "code": "SNS-PLG-01", "name": "Sensor Pelabuhan Panjang", "base_level": 120.0},
    {"id": "aaaa0002-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "code": "SNS-PLG-02", "name": "Sensor Teluk Betung", "base_level": 115.0},
    {"id": "aaaa0003-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "code": "SNS-PLG-03", "name": "Sensor Muara Pidada", "base_level": 125.0},
]

DEFAULT_CFG = ThresholdConfig()

# Track last readings for delta calculation
last_readings: Dict[str, list[float]] = {s["id"]: [] for s in SENSOR_DATA}

# Current alert state
current_alert_level = "normal"
alert_stable_counter = 0
siren_active = False
siren_last_activated = None


def _dsn() -> str:
    return settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")


async def _persist_readings(sensor_updates: list[dict], readings: list[SensorReading]):
    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            for update, reading in zip(sensor_updates, readings):
                await conn.execute(
                    """
                    UPDATE sensors
                    SET status = $2::sensor_status,
                        last_seen = CASE WHEN $2 = 'offline' THEN last_seen ELSE NOW() END
                    WHERE id = $1::uuid
                    """,
                    reading.sensor_id,
                    "offline" if reading.quality == "offline" else "online",
                )
                await conn.execute(
                    """
                    INSERT INTO sensor_readings (
                        sensor_id, water_level_cm, raw_value, quality, delta_1m, delta_3m, delta_5m,
                        rate_cm_per_min, z_score, smoothed_level, baseline_median
                    )
                    VALUES ($1::uuid, $2, $3, $4::quality_flag, $5, $6, $7, $8, $9, $10, $11)
                    """,
                    reading.sensor_id,
                    reading.water_level_cm,
                    reading.water_level_cm,
                    reading.quality,
                    reading.delta_1m,
                    reading.delta_3m,
                    reading.delta_5m,
                    reading.rate_cm_per_min,
                    reading.z_score,
                    reading.smoothed_level,
                    reading.baseline_median,
                )
    finally:
        await conn.close()


async def _persist_alert(result, readings: list[SensorReading]) -> str | None:
    if result.level == "normal":
        return None

    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            alert_id = await conn.fetchval(
                """
                INSERT INTO alerts (
                    level, status, confidence_score, max_delta_cm, max_rate, max_zscore, sensor_count
                )
                VALUES ($1::alert_level, 'active', $2, $3, $4, $5, $6)
                RETURNING id::text
                """,
                result.level,
                result.confidence_score,
                result.max_delta_cm,
                result.max_rate,
                result.max_zscore,
                result.sensor_count,
            )
            for reading in readings:
                if reading.quality in ("bad", "offline"):
                    continue
                reading_id = await conn.fetchval(
                    """
                    SELECT id
                    FROM sensor_readings
                    WHERE sensor_id = $1::uuid
                    ORDER BY recorded_at DESC
                    LIMIT 1
                    """,
                    reading.sensor_id,
                )
                await conn.execute(
                    """
                    INSERT INTO alert_sensor_evidence (alert_id, sensor_id, reading_id, delta_3m, rate, z_score)
                    VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
                    """,
                    alert_id,
                    reading.sensor_id,
                    reading_id,
                    reading.delta_3m,
                    reading.rate_cm_per_min,
                    reading.z_score,
                )
            await conn.execute(
                """
                INSERT INTO system_events (event_type, severity, message, detail)
                VALUES ('ALERT_CREATED', $1, $2, $3::jsonb)
                """,
                "critical" if result.level == "awas" else "warning",
                f"Alert {result.level.upper()} dibuat oleh detection engine",
                f'{{"alert_id":"{alert_id}","confidence":{result.confidence_score}}}',
            )
            await conn.execute(
                """
                INSERT INTO audit_logs (username, action, entity_type, entity_id, reason)
                VALUES ('system', 'ALERT_CREATED', 'alerts', $1, $2)
                """,
                alert_id,
                "; ".join(result.triggered_by) or f"Level {result.level}",
            )
            return alert_id
    finally:
        await conn.close()


async def _persist_auto_siren(alert_id: str | None, siren_ids: list[str]):
    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            await conn.execute("UPDATE sirens SET status = 'active', last_activated = NOW() WHERE is_auto_enabled = TRUE")
            for sid in siren_ids:
                await conn.execute(
                    """
                    INSERT INTO siren_events (siren_id, alert_id, event_type, reason, success)
                    VALUES ($1::uuid, $2::uuid, 'auto_on', 'Level AWAS terdeteksi - otomasi sirine', TRUE)
                    """,
                    sid,
                    alert_id,
                )
            await conn.execute(
                """
                INSERT INTO audit_logs (username, action, entity_type, entity_id, reason)
                VALUES ('system', 'SIREN_ACTIVATED', 'sirens', $1, 'Level AWAS terdeteksi')
                """,
                ",".join(siren_ids),
            )
    finally:
        await conn.close()


async def _persist_auto_siren_off():
    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            rows = await conn.fetch("UPDATE sirens SET status = 'inactive' WHERE status = 'active' RETURNING id::text")
            for row in rows:
                await conn.execute(
                    """
                    INSERT INTO siren_events (siren_id, event_type, reason, success)
                    VALUES ($1::uuid, 'normal_off', 'Kondisi normal stabil >= 10 menit', TRUE)
                    """,
                    row["id"],
                )
            await conn.execute(
                """
                INSERT INTO audit_logs (username, action, entity_type, reason)
                VALUES ('system', 'SIREN_DEACTIVATED', 'sirens', 'Kondisi normal stabil >= 10 menit')
                """
            )
    finally:
        await conn.close()


async def _persist_normal_state():
    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            resolved = await conn.fetch(
                """
                UPDATE alerts
                SET status = 'resolved',
                    resolved_at = COALESCE(resolved_at, NOW()),
                    resolution_note = COALESCE(resolution_note, 'Kondisi kembali normal')
                WHERE status IN ('active','confirmed')
                RETURNING id::text
                """
            )
            active_sirens = await conn.fetch("UPDATE sirens SET status = 'inactive' WHERE status = 'active' RETURNING id::text")
            if resolved:
                await conn.execute(
                    """
                    INSERT INTO audit_logs (username, action, entity_type, reason)
                    VALUES ('system', 'ALERT_RESOLVED', 'alerts', 'Kondisi kembali normal')
                    """
                )
            for row in active_sirens:
                await conn.execute(
                    """
                    INSERT INTO siren_events (siren_id, event_type, reason, success)
                    VALUES ($1::uuid, 'normal_off', 'Kondisi kembali normal', TRUE)
                    """,
                    row["id"],
                )
            if active_sirens:
                await conn.execute(
                    """
                    INSERT INTO audit_logs (username, action, entity_type, reason)
                    VALUES ('system', 'SIREN_DEACTIVATED', 'sirens', 'Kondisi kembali normal')
                    """
                )
    finally:
        await conn.close()


def get_noisy_level(base: float, tick: int) -> float:
    """Tidal + noise simulation."""
    tidal = math.sin(tick * 0.01) * 2
    noise = random.gauss(0, 0.25)
    return base + tidal + noise


async def stream_sensors():
    global current_alert_level, alert_stable_counter, siren_active, siren_last_activated

    tick = 0

    while True:
        try:
            readings = []
            sensor_updates = []

            for sensor in SENSOR_DATA:
                sid = sensor["id"]
                base = sensor["base_level"]

                # Initialize windows
                if sid not in sensor_windows:
                    sensor_windows[sid] = deque(maxlen=5)
                    sensor_baseline_windows[sid] = deque(maxlen=270)  # 45min @ 10s
                    last_readings[sid] = [base] * 10

                # Determine mode
                if simulation_state["mode"] == "simulation":
                    if simulation_state["scenario"] == "sensor_offline" and sensor["code"] == "SNS-PLG-01":
                        quality = "offline"
                        raw_level = base
                    else:
                        raw_level = simulate_water_level(
                            base + simulation_state["water_override"],
                            simulation_state["scenario"],
                            simulation_state["tick"]
                        )
                        quality = "good"
                else:
                    raw_level = get_noisy_level(base, tick)
                    quality = "good"

                # Smoothing
                sensor_windows[sid].append(raw_level)
                smoothed = moving_median(list(sensor_windows[sid]))

                # Baseline
                sensor_baseline_windows[sid].append(smoothed)
                baseline = moving_median(list(sensor_baseline_windows[sid]))

                # Deltas
                hist = last_readings[sid]
                delta_1m = smoothed - hist[-6] if len(hist) >= 6 else 0
                delta_3m = smoothed - hist[-18] if len(hist) >= 18 else smoothed - hist[0]
                delta_5m = smoothed - hist[-30] if len(hist) >= 30 else smoothed - hist[0]

                hist.append(smoothed)
                if len(hist) > 60:
                    last_readings[sid] = hist[-60:]

                rate = delta_1m * 6  # per-minute rate from 10s reading
                std_dev = max(abs(baseline) * 0.04, 5.0)
                z_score = abs(smoothed - baseline) / std_dev if std_dev > 0 else 0

                reading = SensorReading(
                    sensor_id=sid,
                    water_level_cm=round(smoothed, 2),
                    quality=quality,
                    delta_1m=round(delta_1m, 2),
                    delta_3m=round(delta_3m, 2),
                    delta_5m=round(delta_5m, 2),
                    rate_cm_per_min=round(rate, 2),
                    z_score=round(z_score, 3),
                    smoothed_level=round(smoothed, 2),
                    baseline_median=round(baseline, 2),
                )
                readings.append(reading)

                sensor_updates.append({
                    "sensor_id": sid,
                    "code": sensor["code"],
                    "name": sensor["name"],
                    "water_level_cm": reading.water_level_cm,
                    "delta_1m": reading.delta_1m,
                    "delta_3m": reading.delta_3m,
                    "rate_cm_per_min": reading.rate_cm_per_min,
                    "z_score": reading.z_score,
                    "quality": quality,
                    "baseline_median": reading.baseline_median,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

            # Run detection
            await _persist_readings(sensor_updates, readings)
            result = detect_multi_sensor(readings, DEFAULT_CFG)

            # Check for level change
            if result.level != current_alert_level:
                alert_id = await _persist_alert(result, readings)
                alert_payload = {
                    "id": alert_id,
                    "level": result.level,
                    "previous_level": current_alert_level,
                    "confidence_score": result.confidence_score,
                    "confidence_label": result.confidence_label,
                    "triggered_by": result.triggered_by,
                    "max_delta_cm": result.max_delta_cm,
                    "max_rate": result.max_rate,
                    "max_zscore": result.max_zscore,
                    "sensor_count": result.sensor_count,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "auto_siren": result.level == "awas",
                }
                await manager.broadcast_alert(alert_payload)

                # Auto siren
                if result.level == "awas" and not siren_active:
                    siren_active = True
                    siren_last_activated = datetime.now(timezone.utc)
                    siren_ids = ["bbbb0001-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                                 "bbbb0002-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                                 "bbbb0003-bbbb-bbbb-bbbb-bbbbbbbbbbbb"]
                    await _persist_auto_siren(alert_id, siren_ids)
                    await manager.broadcast_siren({
                        "action": "auto_on",
                        "reason": "Level AWAS terdeteksi - otomasi sirine",
                        "timestamp": siren_last_activated.isoformat(),
                        "siren_ids": siren_ids,
                    })

                alert_stable_counter = 0
                current_alert_level = result.level
            else:
                alert_stable_counter += 1
                if result.level == "normal" and alert_stable_counter == 1:
                    await _persist_normal_state()

            # Auto siren off if normal stable 60 ticks (10 min)
            if siren_active and result.level == "normal" and alert_stable_counter >= 60:
                siren_active = False
                await _persist_auto_siren_off()
                await manager.broadcast_siren({
                    "action": "auto_off",
                    "reason": "Kondisi normal stabil >= 10 menit",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

            # Broadcast sensor updates
            await manager.broadcast_sensor_update({
                "sensors": sensor_updates,
                "detection": {
                    "level": result.level,
                    "confidence_score": result.confidence_score,
                    "confidence_label": result.confidence_label,
                    "siren_active": siren_active,
                },
                "mode": simulation_state["mode"],
            })

            tick += 1
            simulation_state["tick"] = tick

        except Exception as e:
            logger.error(f"Sensor stream error: {e}")

        await asyncio.sleep(10)


def get_simulation_state():
    return {**simulation_state, "siren_active": siren_active, "current_level": current_alert_level}

def set_simulation_mode(mode: str, scenario: str = "normal", water_override: float = 0.0, session_id: str | None = None):
    global current_alert_level, alert_stable_counter, siren_active, sensor_windows, sensor_baseline_windows, last_readings
    simulation_state["mode"] = mode
    simulation_state["scenario"] = scenario
    simulation_state["water_override"] = water_override
    simulation_state["session_id"] = session_id if mode == "simulation" else None
    if mode == "simulation":
        simulation_state["tick"] = 0

    # Reset sensor histories to avoid false delta/anomaly triggers
    sensor_windows.clear()
    sensor_baseline_windows.clear()
    last_readings.clear()

    if mode != "simulation":
        # Reset alert level and siren when returning to LIVE
        current_alert_level = "normal"
        alert_stable_counter = 0
        siren_active = False
