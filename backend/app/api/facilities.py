from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, model_validator
import asyncpg

from app.core.config import settings

router = APIRouter()


LOCAL_MIN_LAT = -5.70
LOCAL_MAX_LAT = -5.20
LOCAL_MIN_LON = 104.90
LOCAL_MAX_LON = 105.60

FACILITY_TYPES = {
    "medis", "polisi", "damkar", "sar", "posko_evakuasi",
    "sekolah", "tempat_ibadah", "fasilitas_umum", "lainnya",
}
EQUIPMENT_STATUSES = {"available", "in_use", "maintenance", "unavailable"}


def _location_status(latitude: float | None, longitude: float | None) -> str:
    if latitude is None or longitude is None:
        return "missing"
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return "invalid_range"
    if not (LOCAL_MIN_LAT <= latitude <= LOCAL_MAX_LAT and LOCAL_MIN_LON <= longitude <= LOCAL_MAX_LON):
        return "outside_project_area"
    return "verified_area"


class FacilityPayload(BaseModel):
    name: str = Field(..., min_length=1)
    type: str = "lainnya"
    longitude: float | None = Field(default=None, ge=-180, le=180)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    lat: float | None = Field(default=None, ge=-90, le=90)
    address: str = ""
    phone: str = ""
    description: str = ""
    capacity: int | None = None
    is_active: bool = True
    notes: str = ""

    @model_validator(mode="after")
    def normalize_coordinates(self):
        if self.longitude is None:
            self.longitude = self.lng
        if self.latitude is None:
            self.latitude = self.lat
        if self.longitude is None or self.latitude is None:
            raise ValueError("latitude dan longitude wajib diisi")
        if self.type not in FACILITY_TYPES:
            raise ValueError("jenis fasilitas tidak valid")
        if _location_status(self.latitude, self.longitude) != "verified_area":
            raise ValueError("lokasi berada di luar area operasional Bandar Lampung")
        if not self.notes and self.description:
            self.notes = self.description
        if not self.description and self.notes:
            self.description = self.notes
        self.lng = self.longitude
        self.lat = self.latitude
        return self


class EquipmentPayload(BaseModel):
    name: str = Field(..., min_length=1)
    type: str = Field(default="lainnya", min_length=1)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    lat: float | None = Field(default=None, ge=-90, le=90)
    status: str = "available"
    description: str = ""
    notes: str = ""

    @model_validator(mode="after")
    def normalize_coordinates(self):
        if self.longitude is None:
            self.longitude = self.lng
        if self.latitude is None:
            self.latitude = self.lat
        if self.longitude is None or self.latitude is None:
            raise ValueError("latitude dan longitude wajib diisi")
        if self.status not in EQUIPMENT_STATUSES:
            raise ValueError("status aset tidak valid")
        if _location_status(self.latitude, self.longitude) != "verified_area":
            raise ValueError("lokasi berada di luar area operasional Bandar Lampung")
        if not self.notes and self.description:
            self.notes = self.description
        if not self.description and self.notes:
            self.description = self.notes
        self.lng = self.longitude
        self.lat = self.latitude
        return self


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
        raise HTTPException(status_code=403, detail="Hanya admin/operator yang dapat mengubah fasilitas dan aset")
    return username


async def _ensure_facility_storage(conn):
    await conn.execute(
        """
        ALTER TABLE facilities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
        ALTER TABLE heavy_equipment ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
        ALTER TYPE facility_type ADD VALUE IF NOT EXISTS 'posko_evakuasi';
        ALTER TYPE facility_type ADD VALUE IF NOT EXISTS 'sekolah';
        ALTER TYPE facility_type ADD VALUE IF NOT EXISTS 'tempat_ibadah';
        ALTER TYPE facility_type ADD VALUE IF NOT EXISTS 'fasilitas_umum';
        """
    )


async def _audit(conn, username: str, action: str, entity_type: str, entity_id: str, reason: str):
    user_id = await conn.fetchval("SELECT id FROM users WHERE username = $1", username)
    await conn.execute(
        """
        INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, reason)
        VALUES ($1, $2, $3, $4, $5, $6)
        """,
        user_id,
        username,
        action,
        entity_type,
        entity_id,
        reason,
    )


@router.get("/")
async def list_facilities():
    conn = await asyncpg.connect(_dsn())
    try:
        await _ensure_facility_storage(conn)
        rows = await conn.fetch(
            """
            SELECT
                id::text,
                name,
                type::text,
                address,
                phone,
                capacity,
                is_active,
                notes,
                notes AS description,
                ST_Y(location::geometry) AS latitude,
                ST_X(location::geometry) AS longitude,
                ST_Y(location::geometry) AS lat,
                ST_X(location::geometry) AS lng
            FROM facilities
            ORDER BY type, name
            """
        )
        facilities = []
        for row in rows:
            item = dict(row)
            item["location_status"] = _location_status(item.get("latitude"), item.get("longitude"))
            facilities.append(item)
        return {"facilities": facilities}
    finally:
        await conn.close()


@router.post("/")
async def create_facility(payload: FacilityPayload, authorization: Optional[str] = Header(default=None)):
    conn = await asyncpg.connect(_dsn())
    try:
        await _ensure_facility_storage(conn)
        username = await _require_admin(conn, authorization)
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                INSERT INTO facilities (name, type, location, address, phone, capacity, is_active, notes)
                VALUES ($1, $2::facility_type, ST_SetSRID(ST_MakePoint($3,$4),4326), $5, $6, $7, $8, $9)
                RETURNING id::text, name, type::text
                """,
                payload.name, payload.type, payload.longitude, payload.latitude, payload.address, payload.phone, payload.capacity, payload.is_active, payload.notes,
            )
            await _audit(conn, username, "FACILITY_CREATE", "facilities", row["id"], f"Fasilitas {payload.name} dibuat")
        return {"success": True, "facility": dict(row)}
    finally:
        await conn.close()


@router.put("/{facility_id}")
async def update_facility(facility_id: str, payload: FacilityPayload, authorization: Optional[str] = Header(default=None)):
    conn = await asyncpg.connect(_dsn())
    try:
        await _ensure_facility_storage(conn)
        username = await _require_admin(conn, authorization)
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE facilities
                SET name=$2, type=$3::facility_type, location=ST_SetSRID(ST_MakePoint($4,$5),4326),
                    address=$6, phone=$7, capacity=$8, is_active=$9, notes=$10, updated_at=NOW()
                WHERE id=$1::uuid
                RETURNING id::text, name, type::text
                """,
                facility_id, payload.name, payload.type, payload.longitude, payload.latitude, payload.address, payload.phone, payload.capacity, payload.is_active, payload.notes,
            )
            if not row:
                raise HTTPException(status_code=404, detail="Fasilitas tidak ditemukan")
            await _audit(conn, username, "FACILITY_UPDATE", "facilities", facility_id, f"Fasilitas {payload.name} diperbarui")
        return {"success": True, "facility": dict(row)}
    finally:
        await conn.close()


@router.delete("/{facility_id}")
async def delete_facility(facility_id: str, authorization: Optional[str] = Header(default=None)):
    conn = await asyncpg.connect(_dsn())
    try:
        await _ensure_facility_storage(conn)
        username = await _require_admin(conn, authorization)
        async with conn.transaction():
            name = await conn.fetchval("SELECT name FROM facilities WHERE id=$1::uuid", facility_id)
            if not name:
                raise HTTPException(status_code=404, detail="Fasilitas tidak ditemukan")
            await conn.execute("DELETE FROM facilities WHERE id=$1::uuid", facility_id)
            await _audit(conn, username, "FACILITY_DELETE", "facilities", facility_id, f"Fasilitas {name} dihapus")
        return {"success": True, "facility_id": facility_id}
    finally:
        await conn.close()


@router.get("/equipment")
async def list_equipment():
    conn = await asyncpg.connect(_dsn())
    try:
        await _ensure_facility_storage(conn)
        rows = await conn.fetch(
            """
            SELECT
                id::text,
                name,
                type,
                status,
                notes,
                notes AS description,
                ST_Y(location::geometry) AS latitude,
                ST_X(location::geometry) AS longitude,
                ST_Y(location::geometry) AS lat,
                ST_X(location::geometry) AS lng
            FROM heavy_equipment
            ORDER BY status, name
            """
        )
        equipment = []
        for row in rows:
            item = dict(row)
            item["location_status"] = _location_status(item.get("latitude"), item.get("longitude"))
            equipment.append(item)
        return {"equipment": equipment}
    finally:
        await conn.close()


@router.post("/equipment")
async def create_equipment(payload: EquipmentPayload, authorization: Optional[str] = Header(default=None)):
    conn = await asyncpg.connect(_dsn())
    try:
        await _ensure_facility_storage(conn)
        username = await _require_admin(conn, authorization)
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                INSERT INTO heavy_equipment (name, type, location, status, notes)
                VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3,$4),4326), $5, $6)
                RETURNING id::text, name, type, status
                """,
                payload.name, payload.type, payload.longitude, payload.latitude, payload.status, payload.notes,
            )
            await _audit(conn, username, "ASSET_CREATE", "heavy_equipment", row["id"], f"Aset {payload.name} dibuat")
        return {"success": True, "equipment": dict(row)}
    finally:
        await conn.close()


@router.put("/equipment/{equipment_id}")
async def update_equipment(equipment_id: str, payload: EquipmentPayload, authorization: Optional[str] = Header(default=None)):
    conn = await asyncpg.connect(_dsn())
    try:
        await _ensure_facility_storage(conn)
        username = await _require_admin(conn, authorization)
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE heavy_equipment
                SET name=$2, type=$3, location=ST_SetSRID(ST_MakePoint($4,$5),4326), status=$6, notes=$7, updated_at=NOW()
                WHERE id=$1::uuid
                RETURNING id::text, name, type, status
                """,
                equipment_id, payload.name, payload.type, payload.longitude, payload.latitude, payload.status, payload.notes,
            )
            if not row:
                raise HTTPException(status_code=404, detail="Aset tidak ditemukan")
            await _audit(conn, username, "ASSET_UPDATE", "heavy_equipment", equipment_id, f"Aset {payload.name} diperbarui")
        return {"success": True, "equipment": dict(row)}
    finally:
        await conn.close()


@router.delete("/equipment/{equipment_id}")
async def delete_equipment(equipment_id: str, authorization: Optional[str] = Header(default=None)):
    conn = await asyncpg.connect(_dsn())
    try:
        await _ensure_facility_storage(conn)
        username = await _require_admin(conn, authorization)
        async with conn.transaction():
            name = await conn.fetchval("SELECT name FROM heavy_equipment WHERE id=$1::uuid", equipment_id)
            if not name:
                raise HTTPException(status_code=404, detail="Aset tidak ditemukan")
            await conn.execute("DELETE FROM heavy_equipment WHERE id=$1::uuid", equipment_id)
            await _audit(conn, username, "ASSET_DELETE", "heavy_equipment", equipment_id, f"Aset {name} dihapus")
        return {"success": True, "equipment_id": equipment_id}
    finally:
        await conn.close()
