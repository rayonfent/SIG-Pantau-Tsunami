-- ============================================================
-- SEED DATA: SIG-PANTAU TSUNAMI
-- Area: Panjang, Lampung, Indonesia
-- ============================================================

-- Users
INSERT INTO users (id, username, full_name, email, hashed_password, role, pin_hash) VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin', 'Administrator Sistem', 'admin@sigtsu.id',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGNPO0DpMHNW1CMUL8YBnU0E3Vy', -- password: admin123
   'admin', '$2b$12$pin_hash_placeholder'),
  ('22222222-2222-2222-2222-222222222222', 'supervisor1', 'Budi Santoso', 'budi@sigtsu.id',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGNPO0DpMHNW1CMUL8YBnU0E3Vy',
   'supervisor', NULL),
  ('33333333-3333-3333-3333-333333333333', 'operator1', 'Siti Rahayu', 'siti@sigtsu.id',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGNPO0DpMHNW1CMUL8YBnU0E3Vy',
   'operator', NULL);

-- Sensors (Area Panjang, Lampung - pesisir Teluk Lampung)
INSERT INTO sensors (id, code, name, location, address, elevation_m, is_primary, status) VALUES
  ('aaaa0001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SNS-PLG-01', 'Sensor Pelabuhan Panjang',
   ST_SetSRID(ST_MakePoint(105.2733, -5.4712), 4326),
   'Pelabuhan Panjang, Bandar Lampung', -2.5, TRUE, 'online'),
  ('aaaa0002-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SNS-PLG-02', 'Sensor Teluk Betung',
   ST_SetSRID(ST_MakePoint(105.2890, -5.4580), 4326),
   'Teluk Betung, Bandar Lampung', -1.8, TRUE, 'online'),
  ('aaaa0003-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SNS-PLG-03', 'Sensor Muara Pidada',
   ST_SetSRID(ST_MakePoint(105.2610, -5.4850), 4326),
   'Muara Pidada, Panjang', -3.1, TRUE, 'online'),
  ('aaaa0004-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SNS-PLG-04', 'Sensor Cadangan Pesisir',
   ST_SetSRID(ST_MakePoint(105.2980, -5.4640), 4326),
   'Pesisir Timur Panjang', -1.2, FALSE, 'online');

-- Update backup sensor
UPDATE sensors SET backup_sensor_id = 'aaaa0004-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
WHERE id = 'aaaa0001-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- Threshold Config Default
INSERT INTO threshold_configs (id, name, is_active, created_by) VALUES
  ('cccc0001-cccc-cccc-cccc-cccccccccccc', 'Konfigurasi Default MVP', TRUE,
   '11111111-1111-1111-1111-111111111111');

-- Sirens
INSERT INTO sirens (id, code, name, location, radius_m, status, is_auto_enabled) VALUES
  ('bbbb0001-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'SRN-PLG-01', 'Sirine Pelabuhan Panjang',
   ST_SetSRID(ST_MakePoint(105.2733, -5.4720), 4326), 800, 'inactive', TRUE),
  ('bbbb0002-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'SRN-PLG-02', 'Sirine Pasar Panjang',
   ST_SetSRID(ST_MakePoint(105.2811, -5.4688), 4326), 600, 'inactive', TRUE),
  ('bbbb0003-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'SRN-PLG-03', 'Sirine Gudang Pusri',
   ST_SetSRID(ST_MakePoint(105.2650, -5.4790), 4326), 700, 'inactive', TRUE);

-- Facilities
INSERT INTO facilities (name, type, location, address, phone) VALUES
  ('Polsek Panjang', 'polisi',
   ST_SetSRID(ST_MakePoint(105.2756, -5.4698), 4326),
   'Jl. Yos Sudarso, Panjang', '(0721) 35001'),
  ('Puskesmas Panjang', 'medis',
   ST_SetSRID(ST_MakePoint(105.2820, -5.4672), 4326),
   'Jl. Panjang Raya, Bandar Lampung', '(0721) 35678'),
  ('RS Urip Sumoharjo', 'medis',
   ST_SetSRID(ST_MakePoint(105.2940, -5.4610), 4326),
   'Jl. Urip Sumoharjo No.200', '(0721) 772200'),
  ('Pos Damkar Panjang', 'damkar',
   ST_SetSRID(ST_MakePoint(105.2795, -5.4705), 4326),
   'Jl. Yos Sudarso Km.7', '(0721) 112'),
  ('Pos SAR Teluk Lampung', 'sar',
   ST_SetSRID(ST_MakePoint(105.2700, -5.4730), 4326),
   'Pelabuhan Panjang Dalam', '(0721) 115');

-- Heavy Equipment
INSERT INTO heavy_equipment (name, type, location, status) VALUES
  ('Excavator CAT 320', 'Excavator',
   ST_SetSRID(ST_MakePoint(105.2760, -5.4715), 4326), 'available'),
  ('Truk Evakuasi 01', 'Truk',
   ST_SetSRID(ST_MakePoint(105.2800, -5.4680), 4326), 'available'),
  ('Ambulance SAR', 'Ambulance',
   ST_SetSRID(ST_MakePoint(105.2700, -5.4730), 4326), 'available');

-- Evacuation Routes (LineString menuju zona aman di darat)
INSERT INTO evacuation_routes (name, route, direction, capacity_persons, distance_m, estimated_time_min, status, priority) VALUES
  ('Jalur A - Panjang ke Tanjung Karang',
   ST_SetSRID(ST_GeomFromText('LINESTRING(105.2733 -5.4712, 105.2780 -5.4680, 105.2850 -5.4620, 105.2950 -5.4540, 105.3050 -5.4460)'), 4326),
   'Ke arah Tanjung Karang (barat laut)', 1000, 4800, 20, 'clear', 1),
  ('Jalur B - Panjang ke Sukabumi',
   ST_SetSRID(ST_GeomFromText('LINESTRING(105.2890 -5.4580, 105.2920 -5.4510, 105.2960 -5.4440, 105.3000 -5.4380)'), 4326),
   'Ke arah Sukabumi (utara)', 800, 3600, 15, 'clear', 2),
  ('Jalur C - Alternatif Timur',
   ST_SetSRID(ST_GeomFromText('LINESTRING(105.2980 -5.4640, 105.3010 -5.4580, 105.3050 -5.4510)'), 4326),
   'Ke arah dataran tinggi timur', 600, 2800, 12, 'clear', 3);

-- Safe Zones (Polygon zona aman di dataran tinggi)
INSERT INTO safe_zones (name, zone, elevation_m, capacity, facilities) VALUES
  ('Titik Kumpul GOR Saburai',
   ST_SetSRID(ST_GeomFromText('POLYGON((105.2940 -5.4480, 105.2970 -5.4480, 105.2970 -5.4510, 105.2940 -5.4510, 105.2940 -5.4480))'), 4326),
   45.0, 5000, ARRAY['toilet','air bersih','tenda darurat']),
  ('Titik Kumpul Stadion Pahoman',
   ST_SetSRID(ST_GeomFromText('POLYGON((105.2600 -5.4350, 105.2640 -5.4350, 105.2640 -5.4380, 105.2600 -5.4380, 105.2600 -5.4350))'), 4326),
   38.0, 8000, ARRAY['toilet','medis','dapur umum']),
  ('Area Evakuasi Bukit Randu',
   ST_SetSRID(ST_GeomFromText('POLYGON((105.3040 -5.4440, 105.3080 -5.4440, 105.3080 -5.4480, 105.3040 -5.4480, 105.3040 -5.4440))'), 4326),
   62.0, 2000, ARRAY['pos kesehatan']);

-- Inundation Zones (zona berisiko banjir/tsunami)
INSERT INTO inundation_zones (name, zone, risk_level) VALUES
  ('Zona Genangan Tinggi - Pesisir Panjang',
   ST_SetSRID(ST_GeomFromText('POLYGON((105.2600 -5.4700, 105.3000 -5.4700, 105.3000 -5.4800, 105.2600 -5.4800, 105.2600 -5.4700))'), 4326),
   'high'),
  ('Zona Genangan Sedang - Muara Sungai',
   ST_SetSRID(ST_GeomFromText('POLYGON((105.2600 -5.4620, 105.2850 -5.4620, 105.2850 -5.4700, 105.2600 -5.4700, 105.2600 -5.4620))'), 4326),
   'medium');

-- Seed sensor readings (normal baseline)
INSERT INTO sensor_readings (sensor_id, recorded_at, water_level_cm, quality, delta_1m, delta_3m, delta_5m, rate_cm_per_min, z_score, smoothed_level, baseline_median)
SELECT
  s.id,
  NOW() - (i || ' seconds')::INTERVAL,
  120 + (random() * 10 - 5),
  'good',
  random() * 2 - 1,
  random() * 4 - 2,
  random() * 6 - 3,
  random() * 1 - 0.5,
  random() * 0.8 - 0.4,
  120 + (random() * 8 - 4),
  120
FROM sensors s
CROSS JOIN generate_series(0, 270, 10) AS t(i)
WHERE s.code IN ('SNS-PLG-01','SNS-PLG-02','SNS-PLG-03');

-- Audit log entries
INSERT INTO audit_logs (user_id, username, action, entity_type, reason) VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin', 'SYSTEM_INIT', 'system', 'Inisialisasi sistem SIG-PANTAU TSUNAMI'),
  ('11111111-1111-1111-1111-111111111111', 'admin', 'CONFIG_CREATE', 'threshold_configs', 'Konfigurasi threshold default dibuat');

-- System event
INSERT INTO system_events (event_type, severity, message) VALUES
  ('SYSTEM_START', 'info', 'SIG-PANTAU TSUNAMI sistem berhasil diinisialisasi dengan data seed Panjang, Lampung');
