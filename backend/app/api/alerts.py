from fastapi import APIRouter
from datetime import datetime, timezone

router = APIRouter()

@router.get("/active")
async def active_alerts():
    return {"alerts": [], "current_level": "normal"}

@router.get("/")
async def list_alerts():
    return {"alerts": [], "total": 0}

@router.post("/{alert_id}/resolve")
async def resolve_alert(alert_id: str, reason: str = ""):
    return {"success": True, "alert_id": alert_id}
