from fastapi import APIRouter
from datetime import datetime, timezone
router = APIRouter()

@router.get("/logs")
async def audit_logs(limit: int = 50, skip: int = 0):
    return {"logs": [
        {"id":1,"username":"admin","action":"SYSTEM_INIT","entity_type":"system","reason":"Inisialisasi sistem","created_at": datetime.now(timezone.utc).isoformat()},
        {"id":2,"username":"admin","action":"CONFIG_CREATE","entity_type":"threshold_configs","reason":"Konfigurasi default","created_at": datetime.now(timezone.utc).isoformat()},
    ], "total": 2}
