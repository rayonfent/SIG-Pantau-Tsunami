from typing import Optional
import json

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, model_validator
import asyncpg

from app.core.config import settings

router = APIRouter()

LOCAL_MIN_LAT = -5.70
LOCAL_MAX_LAT = -5.20
LOCAL_MIN_LON = 104.90
LOCAL_MAX_LON = 105.60
ROUTE_STATUSES = {"clear", "warning", "blocked", "maintenance", "congested"}


class RoutePayload(BaseModel):
    name: str = Field(..., min_length=1)
    coordinates: list[list[float]]
    direction: str = Field(..., min_length=1)
    description: str = ""
    capacity_persons: int = Field(default=500, gt=0)
    distance_m: float | None = None
    estimated_time_min: int | None = None
    status: str = "clear"
    priority: int = Field(default=1, ge=1, le=5)
    notes: str = ""

    @model_validator(mode="after")
    def validate_route(self):
        if len(self.coordinates) < 2:
            raise ValueError("Rute membutuhkan minimal 2 titik")
        if self.status not in ROUTE_STATUSES:
            raise ValueError("status rute tidak valid")
        for coord in self.coordinates:
            if len(coord) != 2:
                raise ValueError("setiap titik harus berisi longitude dan latitude")
            lng, lat = float(coord[0]), float(coord[1])
            if not (-180 <= lng <= 180 and -90 <= lat <= 90):
                raise ValueError("koordinat rute tidak valid")
            if not (LOCAL_MIN_LAT <= lat <= LOCAL_MAX_LAT and LOCAL_MIN_LON <= lng <= LOCAL_MAX_LON):
                raise ValueError("koordinat rute berada di luar area operasional Bandar Lampung")
        if not self.notes and self.description:
            self.notes = self.description
        if not self.description and self.notes:
            self.description = self.notes
        return self


class SafeZonePayload(BaseModel):
    name: str
    coordinates: list[list[float]]
    elevation_m: float | None = None
    capacity: int | None = None
    current_count: int = 0
    facilities: list[str] = []
    is_active: bool = True
    notes: str = ""


def _dsn() -> str:
    return settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")


def _username(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer demo_token_"):
        raise HTTPException(status_code=401, detail="Token tidak valid")
    return authorization.replace("Bearer demo_token_", "", 1)


async def _require_admin(conn, authorization: Optional[str]) -> str:
    username = _username(authorization)
    role = await conn.fetchval(
        "SELECT role::text FROM users WHERE username=$1 AND is_active=TRUE",
        username,
    )
    if role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="Hanya admin/operator yang dapat mengubah jalur evakuasi")
    return username


async def _ensure_route_storage(conn):
    await conn.execute(
        """
        ALTER TABLE evacuation_routes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
        ALTER TYPE route_status ADD VALUE IF NOT EXISTS 'warning';
        ALTER TYPE route_status ADD VALUE IF NOT EXISTS 'maintenance';
        """
    )


def _line_wkt(coords: list[list[float]]) -> str:
    if len(coords) < 2:
        raise HTTPException(status_code=422, detail="Rute membutuhkan minimal 2 koordinat")
    return "LINESTRING(" + ", ".join(f"{lng} {lat}" for lng, lat in coords) + ")"


def _route_geojson(coords: list[list[float]]) -> str:
    return json.dumps({"type": "LineString", "coordinates": coords})


def _polygon_wkt(coords: list[list[float]]) -> str:
    if len(coords) < 3:
        raise HTTPException(status_code=422, detail="Zona membutuhkan minimal 3 koordinat")
    closed = coords if coords[0] == coords[-1] else [*coords, coords[0]]
    return "POLYGON((" + ", ".join(f"{lng} {lat}" for lng, lat in closed) + "))"


async def _audit(conn, username: str, action: str, entity_type: str, entity_id: str, reason: str):
    user_id = await conn.fetchval("SELECT id FROM users WHERE username = $1", username)
    await conn.execute(
        """
        INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, reason)
        VALUES ($1, $2, $3, $4, $5, $6)
        """,
        user_id, username, action, entity_type, entity_id, reason,
    )


def _geometry(value):
    return json.loads(value) if isinstance(value, str) else value


@router.get("/routes")
async def evacuation_routes():
    conn = await asyncpg.connect(_dsn())
    try:
        await _ensure_route_storage(conn)
        rows = await conn.fetch(
            """
            SELECT
                r.id::text,
                r.name,
                r.direction,
                r.capacity_persons,
                r.distance_m,
                r.estimated_time_min,
                r.status::text,
                r.priority,
                r.notes,
                r.notes AS description,
                ST_AsGeoJSON(r.route)::json AS geometry,
                COALESCE(td.density_percent, 0) AS density_percent
            FROM evacuation_routes r
            LEFT JOIN LATERAL (
                SELECT density_percent
                FROM traffic_density
                WHERE route_id = r.id
                ORDER BY recorded_at DESC
                LIMIT 1
            ) td ON TRUE
            ORDER BY r.priority, r.name
            """
        )
        routes = []
        for row in rows:
            item = dict(row)
            item["geometry"] = _geometry(item["geometry"])
            item["coordinates"] = item["geometry"]["coordinates"]
            routes.append(item)
        return {"routes": routes}
    finally:
        await conn.close()


@router.post("/routes")
async def create_route(payload: RoutePayload, authorization: Optional[str] = Header(default=None)):
    conn = await asyncpg.connect(_dsn())
    try:
        await _ensure_route_storage(conn)
        username = await _require_admin(conn, authorization)
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                INSERT INTO evacuation_routes (name, route, direction, capacity_persons, distance_m, estimated_time_min, status, priority, notes)
                SELECT $1, geom, $3, $4, ST_Length(geom::geography), COALESCE($5, CEIL(ST_Length(geom::geography) / 80.0)::int), $6::route_status, $7, $8
                FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($2),4326) AS geom) g
                RETURNING id::text, name, status::text, distance_m, estimated_time_min
                """,
                payload.name, _route_geojson(payload.coordinates), payload.direction, payload.capacity_persons,
                payload.estimated_time_min, payload.status, payload.priority, payload.notes,
            )
            await _audit(conn, username, "EVACUATION_ROUTE_CREATE", "evacuation_routes", row["id"], f"Rute {payload.name} dibuat")
        return {"success": True, "route": dict(row)}
    finally:
        await conn.close()


@router.put("/routes/{route_id}")
async def update_route(route_id: str, payload: RoutePayload, authorization: Optional[str] = Header(default=None)):
    conn = await asyncpg.connect(_dsn())
    try:
        await _ensure_route_storage(conn)
        username = await _require_admin(conn, authorization)
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE evacuation_routes
                SET name=$2, route=geom, direction=$4,
                    capacity_persons=$5, distance_m=ST_Length(geom::geography),
                    estimated_time_min=COALESCE($6, CEIL(ST_Length(geom::geography) / 80.0)::int),
                    status=$7::route_status, priority=$8, notes=$9, updated_at=NOW()
                FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($3),4326) AS geom) g
                WHERE id=$1::uuid
                RETURNING id::text, name, status::text, distance_m, estimated_time_min
                """,
                route_id, payload.name, _route_geojson(payload.coordinates), payload.direction, payload.capacity_persons,
                payload.estimated_time_min, payload.status, payload.priority, payload.notes,
            )
            if not row:
                raise HTTPException(status_code=404, detail="Rute tidak ditemukan")
            await _audit(conn, username, "EVACUATION_ROUTE_UPDATE", "evacuation_routes", route_id, f"Rute {payload.name} diperbarui")
        return {"success": True, "route": dict(row)}
    finally:
        await conn.close()


@router.delete("/routes/{route_id}")
async def delete_route(route_id: str, authorization: Optional[str] = Header(default=None)):
    conn = await asyncpg.connect(_dsn())
    try:
        await _ensure_route_storage(conn)
        username = await _require_admin(conn, authorization)
        async with conn.transaction():
            name = await conn.fetchval("SELECT name FROM evacuation_routes WHERE id=$1::uuid", route_id)
            if not name:
                raise HTTPException(status_code=404, detail="Rute tidak ditemukan")
            await conn.execute("DELETE FROM traffic_density WHERE route_id=$1::uuid", route_id)
            await conn.execute("DELETE FROM evacuation_routes WHERE id=$1::uuid", route_id)
            await _audit(conn, username, "EVACUATION_ROUTE_DELETE", "evacuation_routes", route_id, f"Rute {name} dihapus")
        return {"success": True, "route_id": route_id}
    finally:
        await conn.close()


@router.get("/safe-zones")
async def safe_zones():
    conn = await asyncpg.connect(_dsn())
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
                is_active,
                notes,
                ST_AsGeoJSON(zone)::json AS geometry
            FROM safe_zones
            ORDER BY name
            """
        )
        zones = []
        for row in rows:
            item = dict(row)
            item["geometry"] = _geometry(item["geometry"])
            item["coordinates"] = item["geometry"]["coordinates"][0]
            zones.append(item)
        return {"safe_zones": zones}
    finally:
        await conn.close()


@router.post("/safe-zones")
async def create_safe_zone(payload: SafeZonePayload, authorization: Optional[str] = Header(default=None)):
    username = _username(authorization)
    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                INSERT INTO safe_zones (name, zone, elevation_m, capacity, current_count, facilities, is_active, notes)
                VALUES ($1, ST_SetSRID(ST_GeomFromText($2),4326), $3, $4, $5, $6, $7, $8)
                RETURNING id::text, name
                """,
                payload.name, _polygon_wkt(payload.coordinates), payload.elevation_m, payload.capacity,
                payload.current_count, payload.facilities, payload.is_active, payload.notes,
            )
            await _audit(conn, username, "CREATE_MASTER_DATA", "safe_zones", row["id"], f"Zona aman {payload.name} dibuat")
        return {"success": True, "safe_zone": dict(row)}
    finally:
        await conn.close()


@router.put("/safe-zones/{zone_id}")
async def update_safe_zone(zone_id: str, payload: SafeZonePayload, authorization: Optional[str] = Header(default=None)):
    username = _username(authorization)
    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE safe_zones
                SET name=$2, zone=ST_SetSRID(ST_GeomFromText($3),4326), elevation_m=$4,
                    capacity=$5, current_count=$6, facilities=$7, is_active=$8, notes=$9
                WHERE id=$1::uuid
                RETURNING id::text, name
                """,
                zone_id, payload.name, _polygon_wkt(payload.coordinates), payload.elevation_m,
                payload.capacity, payload.current_count, payload.facilities, payload.is_active, payload.notes,
            )
            if not row:
                raise HTTPException(status_code=404, detail="Zona aman tidak ditemukan")
            await _audit(conn, username, "UPDATE_MASTER_DATA", "safe_zones", zone_id, f"Zona aman {payload.name} diperbarui")
        return {"success": True, "safe_zone": dict(row)}
    finally:
        await conn.close()


@router.delete("/safe-zones/{zone_id}")
async def delete_safe_zone(zone_id: str, authorization: Optional[str] = Header(default=None)):
    username = _username(authorization)
    conn = await asyncpg.connect(_dsn())
    try:
        async with conn.transaction():
            name = await conn.fetchval("SELECT name FROM safe_zones WHERE id=$1::uuid", zone_id)
            if not name:
                raise HTTPException(status_code=404, detail="Zona aman tidak ditemukan")
            await conn.execute("DELETE FROM safe_zones WHERE id=$1::uuid", zone_id)
            await _audit(conn, username, "DELETE_MASTER_DATA", "safe_zones", zone_id, f"Zona aman {name} dihapus")
        return {"success": True, "zone_id": zone_id}
    finally:
        await conn.close()


@router.get("/recommended")
async def recommended_routes():
    conn = await asyncpg.connect(_dsn())
    try:
        rows = await conn.fetch(
            """
            SELECT id::text, name
            FROM evacuation_routes
            WHERE status = 'clear'
            ORDER BY priority
            LIMIT 2
            """
        )
        return {
            "recommended": [row["id"] for row in rows],
            "note": ", ".join(row["name"] for row in rows) or "Belum ada jalur clear",
        }
    finally:
        await conn.close()
