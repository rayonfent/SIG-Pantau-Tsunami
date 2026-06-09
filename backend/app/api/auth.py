from typing import Optional

import asyncpg
import bcrypt
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter()

class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    full_name: str
    username: str


def _asyncpg_dsn() -> str:
    return settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")


def _username_from_token(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer demo_token_"):
        raise HTTPException(status_code=401, detail="Token tidak valid")
    return authorization.replace("Bearer demo_token_", "", 1)


async def _fetch_active_user(username: str):
    conn = await asyncpg.connect(_asyncpg_dsn())
    try:
        return await conn.fetchrow(
            """
            SELECT username, full_name, role::text AS role, hashed_password
            FROM users
            WHERE username = $1 AND is_active = TRUE
            """,
            username,
        )
    finally:
        await conn.close()


async def _insert_audit(username: str, action: str, reason: str):
    conn = await asyncpg.connect(_asyncpg_dsn())
    try:
        await conn.execute(
            """
            INSERT INTO audit_logs (user_id, username, action, entity_type, reason)
            SELECT id, username, $2, 'auth', $3
            FROM users
            WHERE username = $1
            """,
            username,
            action,
            reason,
        )
    finally:
        await conn.close()


def _verify_password(password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed_password.encode("utf-8"))
    except ValueError:
        return False


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest):
    user = await _fetch_active_user(req.username)
    if not user or not _verify_password(req.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Username atau password salah")

    # Keep the existing demo token format so current frontend/map authorization keeps working.
    token = f"demo_token_{req.username}"
    await _insert_audit(user["username"], "LOGIN", "User login berhasil")
    return LoginResponse(
        access_token=token,
        role=user["role"],
        full_name=user["full_name"],
        username=user["username"],
    )

@router.get("/me")
async def me(authorization: Optional[str] = Header(default=None)):
    username = _username_from_token(authorization)
    user = await _fetch_active_user(username)
    if not user:
        raise HTTPException(status_code=401, detail="User tidak ditemukan atau nonaktif")
    return {"username": user["username"], "role": user["role"], "full_name": user["full_name"]}


@router.post("/logout")
async def logout(authorization: Optional[str] = Header(default=None)):
    username = _username_from_token(authorization)
    user = await _fetch_active_user(username)
    if user:
        await _insert_audit(username, "LOGOUT", "User logout")
    return {"success": True}
