from datetime import datetime, timedelta

import httpx

from app.core.time import UTC


def _to_utc_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def payment_status_to_subscription_status(payment_status: str | None) -> str:
    status_value = (payment_status or "").strip().lower()
    if status_value in {"approved", "authorized"}:
        return "active"
    if status_value in {"cancelled", "canceled", "rejected", "refunded", "charged_back"}:
        return "past_due"
    if status_value in {"pending", "in_process", "in_mediation"}:
        return "past_due"
    return "past_due"


def payment_owner_id(payment: dict | None) -> str | None:
    if not isinstance(payment, dict):
        return None
    external_reference = str(payment.get("external_reference") or "").strip()
    if external_reference:
        return external_reference
    metadata = payment.get("metadata") or {}
    owner_id = str(metadata.get("owner_id") or "").strip()
    return owner_id or None


def payment_approved_at(payment: dict | None) -> datetime | None:
    if not isinstance(payment, dict):
        return None
    return (
        _to_utc_datetime(payment.get("date_approved"))
        or _to_utc_datetime(payment.get("date_last_updated"))
        or _to_utc_datetime(payment.get("date_created"))
    )


def is_recent_approved_payment(payment: dict | None, *, max_age_days: int = 45) -> bool:
    if not isinstance(payment, dict):
        return False
    if payment_status_to_subscription_status(payment.get("status")) != "active":
        return False
    approved_at = payment_approved_at(payment)
    if approved_at is None:
        return False
    now = datetime.now(UTC)
    return now - approved_at <= timedelta(days=max_age_days)


async def fetch_payment(
    client: httpx.AsyncClient, payment_id: str, token: str
) -> dict:
    response = await client.get(
        f"https://api.mercadopago.com/v1/payments/{payment_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    response.raise_for_status()
    return response.json()


async def search_recent_approved_payment(
    client: httpx.AsyncClient, external_reference: str, token: str
) -> dict | None:
    response = await client.get(
        "https://api.mercadopago.com/v1/payments/search",
        headers={"Authorization": f"Bearer {token}"},
        params={
            "external_reference": external_reference,
            "status": "approved",
            "sort": "date_approved",
            "criteria": "desc",
            "limit": 1,
        },
    )
    response.raise_for_status()
    payload = response.json()
    results = payload.get("results") or payload.get("response", {}).get("results") or []
    return results[0] if results else None
