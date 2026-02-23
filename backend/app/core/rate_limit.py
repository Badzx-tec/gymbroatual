from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from pymongo import ReturnDocument

from app.db.mongo import get_db


async def enforce_rate_limit(
    scope: str,
    key: str,
    limit: int,
    window_seconds: int,
    *,
    error_detail: str = "Muitas requisicoes. Tente novamente em instantes.",
) -> None:
    if limit <= 0 or window_seconds <= 0:
        return

    now = datetime.now(UTC)
    bucket = int(now.timestamp()) // window_seconds
    bucket_id = f"{scope}:{key}:{bucket}"
    expires_at = now + timedelta(seconds=max(window_seconds * 2, 60))

    db = get_db()
    doc = await db.rate_limits.find_one_and_update(
        {"_id": bucket_id},
        {
            "$inc": {"count": 1},
            "$setOnInsert": {
                "scope": scope,
                "key": key,
                "bucket": bucket,
                "created_at": now,
                "expires_at": expires_at,
            },
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )

    if int(doc.get("count", 0)) > limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=error_detail,
            headers={"X-Error-Code": "RATE_LIMITED"},
        )
