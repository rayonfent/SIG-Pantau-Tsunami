from fastapi import APIRouter
from pydantic import BaseModel
from app.websocket.manager import manager
from datetime import datetime, timezone

router = APIRouter()

class SirenAction(BaseModel):
    reason: str = ""
    confirm_pin: str = ""

@router.get("/")
async def list_sirens():
    return {"sirens": [
        {"id":"bbbb0001","code":"SRN-PLG-01","name":"Sirine Pelabuhan Panjang","status":"inactive","radius_m":800},
        {"id":"bbbb0002","code":"SRN-PLG-02","name":"Sirine Pasar Panjang","status":"inactive","radius_m":600},
        {"id":"bbbb0003","code":"SRN-PLG-03","name":"Sirine Gudang Pusri","status":"inactive","radius_m":700},
    ]}

@router.post("/{siren_id}/on")
async def activate_siren(siren_id: str, body: SirenAction):
    await manager.broadcast_siren({
        "action": "manual_on",
        "siren_id": siren_id,
        "reason": body.reason,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"success": True, "siren_id": siren_id, "action": "on"}

@router.post("/{siren_id}/off")
async def deactivate_siren(siren_id: str, body: SirenAction):
    await manager.broadcast_siren({
        "action": "manual_off",
        "siren_id": siren_id,
        "reason": body.reason,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"success": True, "siren_id": siren_id, "action": "off"}

@router.post("/{siren_id}/test")
async def test_siren(siren_id: str):
    await manager.broadcast_siren({
        "action": "test",
        "siren_id": siren_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"success": True, "siren_id": siren_id, "action": "test"}
