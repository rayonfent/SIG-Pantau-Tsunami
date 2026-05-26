from fastapi import APIRouter
from datetime import datetime, timezone
router = APIRouter()

@router.get("/daily")
async def daily_report():
    return {"date": datetime.now(timezone.utc).date().isoformat(), "alerts": 0, "sensor_uptime": "100%", "siren_events": 0}

@router.get("/device-health")
async def device_health():
    return {"sensors_online": 4, "sensors_total": 4, "sirens_ok": 3, "sirens_fault": 0}
