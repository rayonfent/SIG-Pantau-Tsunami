from fastapi import APIRouter
router = APIRouter()

@router.get("/routes")
async def evacuation_routes():
    return {"routes": [
        {"id":"r001","name":"Jalur A","status":"clear","distance_m":4800,"estimated_time_min":20},
        {"id":"r002","name":"Jalur B","status":"clear","distance_m":3600,"estimated_time_min":15},
        {"id":"r003","name":"Jalur C","status":"clear","distance_m":2800,"estimated_time_min":12},
    ]}

@router.get("/safe-zones")
async def safe_zones():
    return {"safe_zones": [
        {"id":"sz001","name":"GOR Saburai","elevation_m":45,"capacity":5000,"current_count":0},
        {"id":"sz002","name":"Stadion Pahoman","elevation_m":38,"capacity":8000,"current_count":0},
        {"id":"sz003","name":"Bukit Randu","elevation_m":62,"capacity":2000,"current_count":0},
    ]}

@router.get("/recommended")
async def recommended_routes():
    return {"recommended": ["r001","r002"], "note":"Jalur A dan B clear, prioritas tinggi"}
