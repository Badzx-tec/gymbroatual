from datetime import UTC, datetime, timedelta

from app.core.config import get_settings


def now_utc() -> datetime:
    return datetime.now(UTC)


def _as_utc_datetime(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    return None


def subscription_allows_login(subscription: dict | None) -> bool:
    if not subscription:
        return False

    now = now_utc()
    status = subscription.get("status", "expired")
    trial_ends_at = _as_utc_datetime(subscription.get("trial_ends_at"))
    current_period_end = _as_utc_datetime(subscription.get("current_period_end"))
    grace_until = _as_utc_datetime(subscription.get("grace_until"))

    if status == "active" and current_period_end and current_period_end >= now:
        return True
    if status == "trialing" and trial_ends_at and trial_ends_at >= now:
        return True
    if status == "past_due" and grace_until and grace_until >= now:
        return True
    return False


def compute_next_period_end(reference: datetime | None = None, *, days: int = 30) -> datetime:
    base = reference or now_utc()
    period_days = max(1, int(days or 30))
    return base + timedelta(days=period_days)


def compute_grace_until(reference: datetime | None = None) -> datetime:
    settings = get_settings()
    base = reference or now_utc()
    return base + timedelta(days=settings.payment_grace_days)


def initial_trial_end() -> datetime:
    settings = get_settings()
    return now_utc() + timedelta(days=settings.trial_days)


def initial_subscription(owner_id: str) -> dict:
    settings = get_settings()
    return {
        "owner_id": owner_id,
        "status": "trialing",
        "provider": "mercadopago",
        "mp_preapproval_id": None,
        "current_period_end": None,
        "trial_ends_at": initial_trial_end(),
        "last_payment_at": None,
        "grace_until": None,
        "meta": {"monthly_amount": settings.subscription_monthly_amount},
        "created_at": now_utc(),
        "updated_at": now_utc(),
    }
