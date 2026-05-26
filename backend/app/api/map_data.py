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


async def _ensure_custom_points_table(conn: asyncpg.Connection):
    await conn.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'custom_map_point_type') THEN
                CREATE TYPE custom_map_point_type AS ENUM ('posko','titik_kumpul','bahaya','informasi','lainnya');
            END IF;
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
    return {
        "sensors_online": 4,
        "sensors_total": 4,
        "sirens_active": 0,
        "sirens_total": 3,
        "alert_level": "normal",
        "last_updated": datetime.now(timezone.utc).isoformat(),
    }

@router.get("/sensors")
async def map_sensors():
    return {"sensors": [
        {"id":"aaaa0001-aaaa-aaaa-aaaa-aaaaaaaaaaaa","code":"SNS-PLG-01","name":"Sensor Pelabuhan Panjang","lng":105.2733,"lat":-5.4712,"status":"online","water_level_cm":120},
        {"id":"aaaa0002-aaaa-aaaa-aaaa-aaaaaaaaaaaa","code":"SNS-PLG-02","name":"Sensor Teluk Betung","lng":105.2890,"lat":-5.4580,"status":"online","water_level_cm":115},
        {"id":"aaaa0003-aaaa-aaaa-aaaa-aaaaaaaaaaaa","code":"SNS-PLG-03","name":"Sensor Muara Pidada","lng":105.2610,"lat":-5.4850,"status":"online","water_level_cm":125},
        {"id":"aaaa0004-aaaa-aaaa-aaaa-aaaaaaaaaaaa","code":"SNS-PLG-04","name":"Sensor Cadangan Pesisir","lng":105.2980,"lat":-5.4640,"status":"online","water_level_cm":118},
    ]}

@router.get("/sirens")
async def map_sirens():
    return {"sirens": [
        {"id":"bbbb0001","code":"SRN-PLG-01","name":"Sirine Pelabuhan Panjang","lng":105.2733,"lat":-5.4720,"radius_m":800,"status":"inactive"},
        {"id":"bbbb0002","code":"SRN-PLG-02","name":"Sirine Pasar Panjang","lng":105.2811,"lat":-5.4688,"radius_m":600,"status":"inactive"},
        {"id":"bbbb0003","code":"SRN-PLG-03","name":"Sirine Gudang Pusri","lng":105.2650,"lat":-5.4790,"radius_m":700,"status":"inactive"},
    ]}

@router.get("/facilities")
async def map_facilities():
    return {"facilities": [
        {"id":"f001","name":"Polsek Panjang","type":"polisi","lng":105.2756,"lat":-5.4698,"phone":"(0721) 35001"},
        {"id":"f002","name":"Puskesmas Panjang","type":"medis","lng":105.2820,"lat":-5.4672,"phone":"(0721) 35678"},
        {"id":"f003","name":"RS Urip Sumoharjo","type":"medis","lng":105.2940,"lat":-5.4610,"phone":"(0721) 772200"},
        {"id":"f004","name":"Pos Damkar Panjang","type":"damkar","lng":105.2795,"lat":-5.4705,"phone":"(0721) 112"},
        {"id":"f005","name":"Pos SAR Teluk Lampung","type":"sar","lng":105.2700,"lat":-5.4730,"phone":"(0721) 115"},
    ]}

@router.get("/evacuation-routes")
async def map_evacuation():
    return {"routes": [
        {
            "id":"r001","name":"Jalur A - Ke Tanjung Karang","status":"clear","priority":1,
            "coordinates":[[105.2733,-5.4712],[105.2780,-5.4680],[105.2850,-5.4620],[105.2950,-5.4540],[105.3050,-5.4460]],
            "distance_m":4800,"estimated_time_min":20
        },
        {
            "id":"r002","name":"Jalur B - Ke Sukabumi","status":"clear","priority":2,
            "coordinates":[[105.2890,-5.4580],[105.2920,-5.4510],[105.2960,-5.4440],[105.3000,-5.4380]],
            "distance_m":3600,"estimated_time_min":15
        },
        {
            "id":"r003","name":"Jalur C - Alternatif Timur","status":"clear","priority":3,
            "coordinates":[[105.2980,-5.4640],[105.3010,-5.4580],[105.3050,-5.4510]],
            "distance_m":2800,"estimated_time_min":12
        },
    ]}

@router.get("/safe-zones")
async def map_safe_zones():
    return {"safe_zones": [
        {
            "id":"sz001","name":"GOR Saburai","elevation_m":45,"capacity":5000,"current_count":0,
            "coordinates":[[105.2940,-5.4480],[105.2970,-5.4480],[105.2970,-5.4510],[105.2940,-5.4510],[105.2940,-5.4480]]
        },
        {
            "id":"sz002","name":"Stadion Pahoman","elevation_m":38,"capacity":8000,"current_count":0,
            "coordinates":[[105.2600,-5.4350],[105.2640,-5.4350],[105.2640,-5.4380],[105.2600,-5.4380],[105.2600,-5.4350]]
        },
        {
            "id":"sz003","name":"Area Evakuasi Bukit Randu","elevation_m":62,"capacity":2000,"current_count":0,
            "coordinates":[[105.3040,-5.4440],[105.3080,-5.4440],[105.3080,-5.4480],[105.3040,-5.4480],[105.3040,-5.4440]]
        },
    ]}

@router.get("/inundation-zones")
async def map_inundation():
    return {"zones": [
        {
            "id":"iz001","name":"Zona Genangan Tinggi","risk_level":"high",
            "coordinates":[[105.2600,-5.4700],[105.3000,-5.4700],[105.3000,-5.4800],[105.2600,-5.4800],[105.2600,-5.4700]]
        },
        {
            "id":"iz002","name":"Zona Genangan Sedang","risk_level":"medium",
            "coordinates":[[105.2600,-5.4620],[105.2850,-5.4620],[105.2850,-5.4700],[105.2600,-5.4700],[105.2600,-5.4620]]
        },
    ]}


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
