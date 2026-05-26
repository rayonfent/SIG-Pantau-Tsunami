from fastapi import APIRouter
from datetime import datetime, timezone

router = APIRouter()

MOCK_READINGS = [
    {"sensor_id":"aaaa0001","water_level_cm":120.5,"delta_3m":1.2,"quality":"good","timestamp": datetime.now(timezone.utc).isoformat()},
    {"sensor_id":"aaaa0002","water_level_cm":115.2,"delta_3m":0.8,"quality":"good","timestamp": datetime.now(timezone.utc).isoformat()},
    {"sensor_id":"aaaa0003","water_level_cm":124.8,"delta_3m":-0.5,"quality":"good","timestamp": datetime.now(timezone.utc).isoformat()},
]

@router.get("/")
async def list_sensors():
    return {"sensors": [
        {"id":"aaaa0001","code":"SNS-PLG-01","name":"Sensor Pelabuhan Panjang","status":"online","water_level_cm":120.5,"last_seen": datetime.now(timezone.utc).isoformat()},
        {"id":"aaaa0002","code":"SNS-PLG-02","name":"Sensor Teluk Betung","status":"online","water_level_cm":115.2,"last_seen": datetime.now(timezone.utc).isoformat()},
        {"id":"aaaa0003","code":"SNS-PLG-03","name":"Sensor Muara Pidada","status":"online","water_level_cm":124.8,"last_seen": datetime.now(timezone.utc).isoformat()},
        {"id":"aaaa0004","code":"SNS-PLG-04","name":"Sensor Cadangan Pesisir","status":"online","water_level_cm":118.1,"last_seen": datetime.now(timezone.utc).isoformat()},
    ]}

@router.get("/{sensor_id}/readings")
async def sensor_readings(sensor_id: str, limit: int = 30):
    return {"readings": MOCK_READINGS, "sensor_id": sensor_id}
