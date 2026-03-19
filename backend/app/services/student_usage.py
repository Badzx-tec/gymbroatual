from datetime import datetime, timedelta

from app.core.time import UTC, coerce_datetime_utc

USAGE_INACTIVE_THRESHOLD_DAYS = 30
USAGE_STATUS_ACTIVE = "active_recent"
USAGE_STATUS_INACTIVE = "inactive_recent"
USAGE_STATUS_UNKNOWN = "unknown"


def compute_operational_usage_status(
    last_real_usage_at,
    *,
    now: datetime | None = None,
    threshold_days: int = USAGE_INACTIVE_THRESHOLD_DAYS,
) -> str:
    parsed = coerce_datetime_utc(last_real_usage_at)
    if not parsed:
        return USAGE_STATUS_UNKNOWN
    current_now = now or datetime.now(UTC)
    if parsed >= current_now - timedelta(days=max(1, int(threshold_days or 30))):
        return USAGE_STATUS_ACTIVE
    return USAGE_STATUS_INACTIVE


def build_operational_usage_snapshot(
    last_real_usage_at,
    *,
    source: str | None = None,
    now: datetime | None = None,
) -> dict:
    parsed = coerce_datetime_utc(last_real_usage_at)
    return {
        "last_real_usage_at": parsed,
        "operational_usage_status": compute_operational_usage_status(parsed, now=now),
        "last_real_usage_source": str(source or "").strip().lower() or None,
    }


async def touch_student_usage(
    db,
    *,
    owner_id: str,
    student_id: str,
    usage_at,
    source: str,
    updated_at: datetime | None = None,
) -> dict:
    effective_usage = coerce_datetime_utc(usage_at) or datetime.now(UTC)
    snapshot = build_operational_usage_snapshot(effective_usage, source=source, now=effective_usage)
    await db.students.update_one(
        {"owner_id": owner_id, "student_id": student_id},
        {
            "$set": {
                **snapshot,
                "updated_at": updated_at or datetime.now(UTC),
            }
        },
    )
    return snapshot
