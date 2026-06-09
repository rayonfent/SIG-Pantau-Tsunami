from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
from datetime import datetime, timezone
from typing import Optional

import asyncpg

from app.core.config import settings

router = APIRouter()


class CustomPointCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: Optional[str] = None
    type: str = Field(default="informasi", pattern="^(posko|titik_kumpul|bahaya|informasi|lainnya)$")
    lng: float = Field(..., ge=-180, le=180)
    lat: float = Field(..., ge=-90, le=90)


class InundationPayload(BaseModel):
    name: str
    coordinates: list[list[float]]
    risk_level: str = "medium"
    notes: Optional[str] = None


def _asyncpg_dsn() -> str:
    return settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")


def _user_from_token(authorization: Optional[str]) -> dict:
    if not authorization or not authorization.startswith("Bearer demo_token_"):
        raise HTTPException(status_code=401, detail="Token tidak valid")
    username = authorization.replace("Bearer demo_token_", "", 1)
    roles = {
        "admin": "admin",
        "supervisor1": "supervisor",
        "operator1": "operator",
    }
    return {"username": username, "role": roles.get(username, "operator")}


def _require_admin(authorization: Optional[str]) -> dict:
    user = _user_from_token(authorization)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Hanya admin yang dapat menambahkan titik peta")
    return user


def _polygon_wkt(coords: list[list[float]]) -> str:
    if len(coords) < 3:
        raise HTTPException(status_code=422, detail="Zona membutuhkan minimal 3 koordinat")
    closed = coords if coords[0] == coords[-1] else [*coords, coords[0]]
    return "POLYGON((" + ", ".join(f"{lng} {lat}" for lng, lat in closed) + "))"


async def _audit(conn: asyncpg.Connection, username: str, action: str, entity_type: str, entity_id: str, reason: str):
    user_id = await conn.fetchval("SELECT id FROM users WHERE username = $1", username)
    await conn.execute(
        """
        INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, reason)
        VALUES ($1, $2, $3, $4, $5, $6)
        """,
        user_id, username, action, entity_type, entity_id, reason,
    )


async def _ensure_custom_points_table(conn: asyncpg.Connection):
    await conn.execute(
        """
        DO $$
        BEGIN
            CREATE TYPE custom_map_point_type AS ENUM ('posko','titik_kumpul','bahaya','informasi','lainnya');
        EXCEPTION WHEN duplicate_object THEN
            NULL;
        END $$;

        CREATE TABLE IF NOT EXISTS custom_map_points (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            name VARCHAR(128) NOT NULL,
            description TEXT,
            type custom_map_point_type NOT NULL DEFAULT 'informasi',
            location geometry(Point, 4326) NOT NULL,
            created_by VARCHAR(64),
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_custom_map_points_location ON custom_map_points USING GIST(location);
        CREATE INDEX IF NOT EXISTS idx_custom_map_points_active ON custom_map_points(is_active);
        """
    )


async def _fetch_custom_points() -> list[dict]:
    conn = await asyncpg.connect(_asyncpg_dsn())
    try:
        await _ensure_custom_points_table(conn)
        rows = await conn.fetch(
            """
            SELECT
                id::text,
                name,
                COALESCE(description, '') AS description,
                type::text,
                ST_X(location::geometry) AS lng,
                ST_Y(location::geometry) AS lat,
                created_by,
                created_at
            FROM custom_map_points
            WHERE is_active = TRUE
            ORDER BY created_at DESC
            """
        )
        return [dict(row) for row in rows]
    finally:
        await conn.close()

@router.get("/config")
async def map_config():
    return {
        "center": [105.2756, -5.4712],
        "zoom": 14,
        "area_name": "Panjang, Bandar Lampung",
        "bounds": [[105.24, -5.50], [105.32, -5.44]],
    }

@router.get("/layers")
async def map_layers():
    return {
        "layers": [
            {"id": "sensors",        "label": "Sensor Muka Air",   "default": True},
            {"id": "sirens",         "label": "Sirine",             "default": True},
            {"id": "facilities",     "label": "Fasilitas Publik",   "default": True},
            {"id": "evacuation",     "label": "Jalur Evakuasi",     "default": True},
            {"id": "safe_zones",     "label": "Titik Kumpul",       "default": True},
            {"id": "inundation",     "label": "Zona Genangan",      "default": False},
            {"id": "custom_points",  "label": "Titik Admin",        "default": True},
            {"id": "heavy_equipment","label": "Alat Berat",         "default": False},
        ]
    }

@router.get("/status")
async def map_status():
    conn = await asyncpg.connect(_asyncpg_dsn())
    try:
        row = await conn.fetchrow(
            """
            SELECT
                (SELECT COUNT(*) FROM sensors WHERE status = 'online') AS sensors_online,
                (SELECT COUNT(*) FROM sensors) AS sensors_total,
                (SELECT COUNT(*) FROM sirens WHERE status = 'active') AS sirens_active,
                (SELECT COUNT(*) FROM sirens) AS sirens_total,
                (SELECT level::text FROM alerts ORDER BY triggered_at DESC LIMIT 1) AS alert_level
            """
        )
        return {**dict(row), "alert_level": row["alert_level"] or "normal", "last_updated": datetime.now(timezone.utc).isoformat()}
    finally:
        await conn.close()

@router.get("/sensors")
async def map_sensors():
    conn = await asyncpg.connect(_asyncpg_dsn())
    try:
        rows = await conn.fetch(
            """
            SELECT
                s.id::text,
                s.code,
                s.name,
                s.status::text,
                ST_X(s.location::geometry) AS lng,
                ST_Y(s.location::geometry) AS lat,
                r.water_level_cm,
                r.delta_3m,
                r.quality::text AS quality,
                r.recorded_at AS last_seen
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

@router.get("/sirens")
async def map_sirens():
    conn = await asyncpg.connect(_asyncpg_dsn())
    try:
        rows = await conn.fetch(
            """
            SELECT
                id::text,
                code,
                name,
                ST_X(location::geometry) AS lng,
                ST_Y(location::geometry) AS lat,
                radius_m,
                status::text,
                is_auto_enabled,
                last_activated
            FROM sirens
            ORDER BY code
            """
        )
        return {"sirens": [dict(row) for row in rows]}
    finally:
        await conn.close()

@router.get("/facilities")
async def map_facilities():
    conn = await asyncpg.connect(_asyncpg_dsn())
    try:
        rows = await conn.fetch(
            """
            SELECT
                id::text,
                name,
                type::text,
                ST_X(location::geometry) AS lng,
                ST_Y(location::geometry) AS lat,
                address,
                phone,
                capacity,
                notes,
                notes AS description
            FROM facilities
            WHERE is_active = TRUE
            ORDER BY type, name
            """
        )
        return {"facilities": [dict(row) for row in rows]}
    finally:
        await conn.close()

@router.get("/evacuation-routes")
async def map_evacuation():
    conn = await asyncpg.connect(_asyncpg_dsn())
    try:
        rows = await conn.fetch(
            """
            SELECT
                id::text,
                name,
                status::text,
                priority,
                direction,
                notes,
                notes AS description,
                capacity_persons,
                distance_m,
                estimated_time_min,
                ST_AsGeoJSON(route)::json AS geojson
            FROM evacuation_routes
            ORDER BY priority, name
            """
        )
        routes = []
        for row in rows:
            item = dict(row)
            item["coordinates"] = item.pop("geojson")["coordinates"]
            routes.append(item)
        return {"routes": routes}
    finally:
        await conn.close()

@router.get("/safe-zones")
async def map_safe_zones():
    conn = await asyncpg.connect(_asyncpg_dsn())
    try:
        rows = await conn.fetch(
            """
            SELECT
                id::text,
                name,
                elevation_m,
                capacity,
                current_count,
                facilities,
                ST_AsGeoJSON(zone)::json AS geojson
            FROM safe_zones
            WHERE is_active = TRUE
            ORDER BY name
            """
        )
        zones = []
        for row in rows:
            item = dict(row)
            item["coordinates"] = item.pop("geojson")["coordinates"][0]
            zones.append(item)
        return {"safe_zones": zones}
    finally:
        await conn.close()

@router.get("/inundation-zones")
async def map_inundation():
    conn = await asyncpg.connect(_asyncpg_dsn())
    try:
        rows = await conn.fetch(
            """
            SELECT
                id::text,
                name,
                risk_level,
                notes,
                ST_AsGeoJSON(zone)::json AS geojson
            FROM inundation_zones
            ORDER BY risk_level DESC, name
            """
        )
        zones = []
        for row in rows:
            item = dict(row)
            item["coordinates"] = item.pop("geojson")["coordinates"][0]
            zones.append(item)
        return {"zones": zones}
    finally:
        await conn.close()


@router.get("/heavy-equipment")
async def map_heavy_equipment():
    conn = await asyncpg.connect(_asyncpg_dsn())
    try:
        rows = await conn.fetch(
            """
            SELECT
                id::text,
                name,
                type,
                status,
                notes,
                notes AS description,
                ST_X(location::geometry) AS lng,
                ST_Y(location::geometry) AS lat
            FROM heavy_equipment
            ORDER BY status, name
            """
        )
        return {"equipment": [dict(row) for row in rows]}
    finally:
        await conn.close()


@router.post("/inundation-zones", status_code=201)
async def create_inundation_zone(req: InundationPayload, authorization: Optional[str] = Header(default=None)):
    user = _require_admin(authorization)
    conn = await asyncpg.connect(_asyncpg_dsn())
    try:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                INSERT INTO inundation_zones (name, zone, risk_level, notes)
                VALUES ($1, ST_SetSRID(ST_GeomFromText($2),4326), $3, $4)
                RETURNING id::text, name, risk_level
                """,
                req.name,
                _polygon_wkt(req.coordinates),
                req.risk_level,
                req.notes,
            )
            await _audit(conn, user["username"], "CREATE_MASTER_DATA", "inundation_zones", row["id"], f"Zona rawan {req.name} dibuat")
        return {"success": True, "zone": dict(row)}
    finally:
        await conn.close()


@router.put("/inundation-zones/{zone_id}")
async def update_inundation_zone(zone_id: str, req: InundationPayload, authorization: Optional[str] = Header(default=None)):
    user = _require_admin(authorization)
    conn = await asyncpg.connect(_asyncpg_dsn())
    try:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE inundation_zones
                SET name=$2, zone=ST_SetSRID(ST_GeomFromText($3),4326), risk_level=$4, notes=$5
                WHERE id=$1::uuid
                RETURNING id::text, name, risk_level
                """,
                zone_id,
                req.name,
                _polygon_wkt(req.coordinates),
                req.risk_level,
                req.notes,
            )
            if not row:
                raise HTTPException(status_code=404, detail="Zona rawan tidak ditemukan")
            await _audit(conn, user["username"], "UPDATE_MASTER_DATA", "inundation_zones", zone_id, f"Zona rawan {req.name} diperbarui")
        return {"success": True, "zone": dict(row)}
    finally:
        await conn.close()


@router.delete("/inundation-zones/{zone_id}")
async def delete_inundation_zone(zone_id: str, authorization: Optional[str] = Header(default=None)):
    user = _require_admin(authorization)
    conn = await asyncpg.connect(_asyncpg_dsn())
    try:
        async with conn.transaction():
            name = await conn.fetchval("SELECT name FROM inundation_zones WHERE id=$1::uuid", zone_id)
            if not name:
                raise HTTPException(status_code=404, detail="Zona rawan tidak ditemukan")
            await conn.execute("DELETE FROM inundation_zones WHERE id=$1::uuid", zone_id)
            await _audit(conn, user["username"], "DELETE_MASTER_DATA", "inundation_zones", zone_id, f"Zona rawan {name} dihapus")
        return {"success": True, "zone_id": zone_id}
    finally:
        await conn.close()


@router.get("/custom-points")
async def map_custom_points():
    return {"points": await _fetch_custom_points()}


@router.post("/custom-points", status_code=201)
async def create_custom_point(req: CustomPointCreate, authorization: Optional[str] = Header(default=None)):
    user = _require_admin(authorization)
    conn = await asyncpg.connect(_asyncpg_dsn())
    try:
        await _ensure_custom_points_table(conn)
        row = await conn.fetchrow(
            """
            INSERT INTO custom_map_points (name, description, type, location, created_by)
            VALUES ($1, $2, $3::custom_map_point_type, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6)
            RETURNING
                id::text,
                name,
                COALESCE(description, '') AS description,
                type::text,
                ST_X(location::geometry) AS lng,
                ST_Y(location::geometry) AS lat,
                created_by,
                created_at
            """,
            req.name,
            req.description,
            req.type,
            req.lng,
            req.lat,
            user["username"],
        )
        return {"point": dict(row)}
    finally:
        await conn.close()
