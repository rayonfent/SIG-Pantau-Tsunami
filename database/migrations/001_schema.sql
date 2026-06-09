-- ============================================================
-- SIG-PANTAU TSUNAMI: Database Schema
-- PostgreSQL + PostGIS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS & AUTH
-- ============================================================
CREATE TYPE user_role AS ENUM ('operator', 'supervisor', 'admin');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(64) UNIQUE NOT NULL,
    full_name VARCHAR(128) NOT NULL,
    email VARCHAR(128) UNIQUE NOT NULL,
    hashed_password TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'operator',
    pin_hash TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SENSORS
-- ============================================================
CREATE TYPE sensor_status AS ENUM ('online', 'suspect', 'offline', 'maintenance');
CREATE TYPE quality_flag AS ENUM ('good', 'suspect', 'bad', 'offline');

CREATE TABLE sensors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(32) UNIQUE NOT NULL,
    name VARCHAR(128) NOT NULL,
    location geometry(Point, 4326) NOT NULL,
    address TEXT,
    elevation_m FLOAT DEFAULT 0,
    is_primary BOOLEAN DEFAULT TRUE,
    backup_sensor_id UUID REFERENCES sensors(id),
    status sensor_status DEFAULT 'online',
    last_seen TIMESTAMPTZ,
    installed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sensors_location ON sensors USING GIST(location);

CREATE TABLE sensor_readings (
    id BIGSERIAL PRIMARY KEY,
    sensor_id UUID NOT NULL REFERENCES sensors(id),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    water_level_cm FLOAT NOT NULL,
    raw_value FLOAT,
    quality quality_flag DEFAULT 'good',
    delta_1m FLOAT,
    delta_3m FLOAT,
    delta_5m FLOAT,
    rate_cm_per_min FLOAT,
    z_score FLOAT,
    smoothed_level FLOAT,
    baseline_median FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_readings_sensor_time ON sensor_readings(sensor_id, recorded_at DESC);
CREATE INDEX idx_readings_recorded_at ON sensor_readings(recorded_at DESC);

-- ============================================================
-- THRESHOLD CONFIGURATION
-- ============================================================
CREATE TABLE threshold_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(128) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    -- suspect
    suspect_delta3m FLOAT DEFAULT 15,
    suspect_zscore FLOAT DEFAULT 2.0,
    -- waspada
    waspada_delta3m FLOAT DEFAULT 25,
    waspada_rate FLOAT DEFAULT 8,
    waspada_zscore FLOAT DEFAULT 2.5,
    -- siaga
    siaga_delta3m FLOAT DEFAULT 40,
    siaga_rate FLOAT DEFAULT 13,
    siaga_zscore FLOAT DEFAULT 3.0,
    -- awas
    awas_delta3m FLOAT DEFAULT 60,
    awas_rate FLOAT DEFAULT 20,
    awas_zscore FLOAT DEFAULT 3.5,
    -- confirmation
    min_sensors_confirm INTEGER DEFAULT 2,
    confirm_window_sec INTEGER DEFAULT 60,
    siren_auto_level VARCHAR(16) DEFAULT 'awas',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ALERTS
-- ============================================================
CREATE TYPE alert_level AS ENUM ('normal', 'suspect', 'waspada', 'siaga', 'awas');
CREATE TYPE alert_status AS ENUM ('active', 'confirmed', 'resolved', 'false_alarm');

CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    level alert_level NOT NULL,
    status alert_status DEFAULT 'active',
    confidence_score FLOAT DEFAULT 0,
    triggered_at TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id),
    resolution_note TEXT,
    max_delta_cm FLOAT,
    max_rate FLOAT,
    max_zscore FLOAT,
    sensor_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_triggered ON alerts(triggered_at DESC);

CREATE TABLE alert_sensor_evidence (
    id BIGSERIAL PRIMARY KEY,
    alert_id UUID NOT NULL REFERENCES alerts(id),
    sensor_id UUID NOT NULL REFERENCES sensors(id),
    reading_id BIGINT REFERENCES sensor_readings(id),
    delta_3m FLOAT,
    rate FLOAT,
    z_score FLOAT,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SIRENS
-- ============================================================
CREATE TYPE siren_status AS ENUM ('active', 'inactive', 'fault', 'maintenance');

CREATE TABLE sirens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(32) UNIQUE NOT NULL,
    name VARCHAR(128) NOT NULL,
    location geometry(Point, 4326) NOT NULL,
    radius_m FLOAT DEFAULT 500,
    status siren_status DEFAULT 'inactive',
    is_auto_enabled BOOLEAN DEFAULT TRUE,
    last_tested TIMESTAMPTZ,
    last_activated TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sirens_location ON sirens USING GIST(location);

CREATE TABLE siren_events (
    id BIGSERIAL PRIMARY KEY,
    siren_id UUID NOT NULL REFERENCES sirens(id),
    alert_id UUID REFERENCES alerts(id),
    event_type VARCHAR(32) NOT NULL, -- 'auto_on','manual_on','manual_off','test','fault','normal_off'
    triggered_by UUID REFERENCES users(id),
    reason TEXT,
    success BOOLEAN DEFAULT TRUE,
    error_detail TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FACILITIES & ASSETS
-- ============================================================
CREATE TYPE facility_type AS ENUM (
    'medis',
    'polisi',
    'damkar',
    'sar',
    'posko_evakuasi',
    'sekolah',
    'tempat_ibadah',
    'fasilitas_umum',
    'lainnya'
);

CREATE TABLE facilities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(128) NOT NULL,
    type facility_type NOT NULL,
    location geometry(Point, 4326) NOT NULL,
    address TEXT,
    phone VARCHAR(32),
    capacity INTEGER,
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_facilities_location ON facilities USING GIST(location);

CREATE TABLE heavy_equipment (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(128) NOT NULL,
    type VARCHAR(64),
    location geometry(Point, 4326) NOT NULL,
    status VARCHAR(32) DEFAULT 'available',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_heavy_eq_location ON heavy_equipment USING GIST(location);

-- ============================================================
-- EVACUATION
-- ============================================================
CREATE TYPE route_status AS ENUM ('clear','congested','warning','blocked','maintenance');

CREATE TABLE evacuation_routes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(128) NOT NULL,
    route geometry(LineString, 4326) NOT NULL,
    direction TEXT,
    capacity_persons INTEGER DEFAULT 500,
    distance_m FLOAT,
    estimated_time_min INTEGER,
    status route_status DEFAULT 'clear',
    priority INTEGER DEFAULT 1,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_evac_routes ON evacuation_routes USING GIST(route);

CREATE TABLE traffic_density (
    id BIGSERIAL PRIMARY KEY,
    route_id UUID NOT NULL REFERENCES evacuation_routes(id),
    density_percent FLOAT DEFAULT 0,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE safe_zones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(128) NOT NULL,
    zone geometry(Polygon, 4326) NOT NULL,
    elevation_m FLOAT,
    capacity INTEGER,
    current_count INTEGER DEFAULT 0,
    facilities TEXT[],
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_safe_zones ON safe_zones USING GIST(zone);

CREATE TABLE inundation_zones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(128),
    zone geometry(Polygon, 4326) NOT NULL,
    risk_level VARCHAR(16),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_inundation ON inundation_zones USING GIST(zone);

CREATE TYPE custom_map_point_type AS ENUM ('posko','titik_kumpul','bahaya','informasi','lainnya');

CREATE TABLE custom_map_points (
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
CREATE INDEX idx_custom_map_points_location ON custom_map_points USING GIST(location);
CREATE INDEX idx_custom_map_points_active ON custom_map_points(is_active);

-- ============================================================
-- SIMULATION
-- ============================================================
CREATE TYPE sim_status AS ENUM ('idle','running','paused','completed');

CREATE TABLE simulation_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(128),
    scenario VARCHAR(64),
    status sim_status DEFAULT 'idle',
    water_level_override FLOAT,
    started_by UUID REFERENCES users(id),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOG
-- ============================================================
CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    username VARCHAR(64),
    action VARCHAR(64) NOT NULL,
    entity_type VARCHAR(64),
    entity_id TEXT,
    old_value JSONB,
    new_value JSONB,
    reason TEXT,
    ip_address VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

-- ============================================================
-- SYSTEM EVENTS
-- ============================================================
CREATE TABLE system_events (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    severity VARCHAR(16) DEFAULT 'info',
    message TEXT,
    detail JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
