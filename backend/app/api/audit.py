from typing import Optional

from fastapi import APIRouter
import asyncpg

from app.core.config import settings

router = APIRouter()


def _dsn() -> str:
    return settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")


@router.get("/logs")
async def audit_logs(limit: int = 50, skip: int = 0, action: Optional[str] = None):
    conn = await asyncpg.connect(_dsn())
    try:
        params = [min(max(limit, 1), 500), max(skip, 0)]
        where = ""
        if action:
            where = "WHERE action = $3"
            params.append(action)
        rows = await conn.fetch(
            f"""
            SELECT
                id,
                username,
                action,
                entity_type,
                entity_id,
                reason,
                created_at
            FROM audit_logs
            {where}
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
            """,
            *params,
        )
        total = await conn.fetchval(f"SELECT COUNT(*) FROM audit_logs {where}", *params[2:])
        return {"logs": [dict(row) for row in rows], "total": total}
    finally:
        await conn.close()
