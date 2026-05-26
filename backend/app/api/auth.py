from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

# Demo users (in production use DB + hashed passwords)
DEMO_USERS = {
    "admin":      {"password": "admin123",   "role": "admin",      "full_name": "Administrator"},
    "supervisor1":{"password": "super123",   "role": "supervisor", "full_name": "Budi Santoso"},
    "operator1":  {"password": "oper123",    "role": "operator",   "full_name": "Siti Rahayu"},
}

class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    full_name: str
    username: str

@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest):
    user = DEMO_USERS.get(req.username)
    if not user or user["password"] != req.password:
        raise HTTPException(status_code=401, detail="Username atau password salah")
    # Simple token (in production use JWT)
    token = f"demo_token_{req.username}"
    return LoginResponse(
        access_token=token,
        role=user["role"],
        full_name=user["full_name"],
        username=req.username,
    )

@router.get("/me")
async def me():
    return {"username": "operator1", "role": "operator", "full_name": "Siti Rahayu"}
