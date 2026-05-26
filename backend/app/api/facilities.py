from fastapi import APIRouter
router = APIRouter()

@router.get("/")
async def list_facilities():
    return {"facilities": [
        {"id":"f001","name":"Polsek Panjang","type":"polisi","phone":"(0721) 35001"},
        {"id":"f002","name":"Puskesmas Panjang","type":"medis","phone":"(0721) 35678"},
        {"id":"f003","name":"RS Urip Sumoharjo","type":"medis","phone":"(0721) 772200"},
        {"id":"f004","name":"Pos Damkar Panjang","type":"damkar","phone":"(0721) 112"},
        {"id":"f005","name":"Pos SAR Teluk Lampung","type":"sar","phone":"(0721) 115"},
    ]}
