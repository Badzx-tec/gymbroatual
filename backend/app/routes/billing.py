from datetime import UTC, datetime
import hashlib

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from app.core.config import get_settings
from app.core.deps import get_current_owner
from app.db.mongo import get_db
from app.models.billing import CheckoutOut, SubscriptionStatusOut
from app.services.subscription import (
    compute_grace_until,
    compute_next_period_end,
    now_utc,
    subscription_allows_login,
)

router = APIRouter()


def status_from_action(action: str) -> str:
    if "cancel" in action:
        return "canceled"
    if "fail" in action or "reject" in action:
        return "past_due"
    return "active"


async def _subscription_status(owner_id: str) -> SubscriptionStatusOut:
    db = get_db()
    sub = await db.subscriptions.find_one({"owner_id": owner_id}, {"_id": 0})
    if not sub:
        raise HTTPException(status_code=404, detail="Assinatura nao encontrada")
    return SubscriptionStatusOut(
        owner_id=owner_id,
        status=sub["status"],
        provider=sub.get("provider", "mercadopago"),
        current_period_end=sub.get("current_period_end"),
        last_payment_at=sub.get("last_payment_at"),
        grace_until=sub.get("grace_until"),
        trial_ends_at=sub.get("trial_ends_at"),
        can_login=subscription_allows_login(sub),
    )


@router.get("/subscription/status", response_model=SubscriptionStatusOut)
async def subscription_status(owner: dict = Depends(get_current_owner)):
    return await _subscription_status(owner["owner_id"])


@router.post("/subscription/checkout", response_model=CheckoutOut)
async def subscription_checkout(owner: dict = Depends(get_current_owner)):
    return await create_checkout_for_owner(owner)


async def create_checkout_for_owner(owner: dict) -> CheckoutOut:
    settings = get_settings()
    db = get_db()
    owner_id = owner["owner_id"]

    checkout_url = f"{settings.frontend_base_url}/admin/assinatura?mock=1&owner_id={owner_id}"
    preapproval_id = f"mock_pre_{owner_id}"

    if settings.mp_access_token:
        payload = {
            "reason": "Assinatura GymBro",
            "auto_recurring": {
                "frequency": 1,
                "frequency_type": "months",
                "transaction_amount": settings.subscription_monthly_amount,
                "currency_id": "BRL",
            },
            "payer_email": owner["email"],
            "back_url": settings.frontend_base_url,
            "status": "pending",
        }
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                "https://api.mercadopago.com/preapproval",
                headers={"Authorization": f"Bearer {settings.mp_access_token}"},
                json=payload,
            )
            if response.is_success:
                data = response.json()
                checkout_url = data.get("init_point") or checkout_url
                preapproval_id = data.get("id")
            else:
                # keep mock URL as safe fallback to avoid dead-end in UI
                pass

    await db.subscriptions.update_one(
        {"owner_id": owner_id},
        {
            "$set": {
                "mp_preapproval_id": preapproval_id,
                "updated_at": now_utc(),
                "provider": "mercadopago",
            }
        },
    )

    return CheckoutOut(checkout_url=checkout_url, preapproval_id=preapproval_id)


@router.post("/webhook/mercadopago")
async def webhook_mercadopago(
    request: Request,
    x_signature: str | None = Header(default=None),
):
    settings = get_settings()
    db = get_db()

    raw = await request.body()
    payload = await request.json()

    if settings.mp_webhook_secret:
        digest = hashlib.sha256(raw + settings.mp_webhook_secret.encode("utf-8")).hexdigest()
        if x_signature and digest not in x_signature:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Assinatura de webhook invalida")

    event_id = str(payload.get("id") or payload.get("data", {}).get("id") or "")
    if not event_id:
        event_id = hashlib.sha256(raw).hexdigest()[:24]

    existing = await db.billing_events.find_one({"event_id": event_id})
    if existing:
        return {"status": "ignored", "reason": "duplicate"}

    now = datetime.now(UTC)
    action = payload.get("action", "")
    status_value = status_from_action(action)

    owner_id = payload.get("external_reference") or payload.get("metadata", {}).get("owner_id")
    if not owner_id:
        # fallback: update by known preapproval id
        pre_id = payload.get("data", {}).get("id") or payload.get("id")
        sub = await db.subscriptions.find_one({"mp_preapproval_id": pre_id}, {"_id": 0})
        owner_id = sub.get("owner_id") if sub else None

    if owner_id:
        update = {
            "status": status_value,
            "updated_at": now,
            "meta.last_webhook": {
                "id": event_id,
                "action": action,
                "type": payload.get("type"),
                "received_at": now,
            },
        }
        if status_value == "active":
            update["current_period_end"] = compute_next_period_end()
            update["last_payment_at"] = now
            update["grace_until"] = None
        elif status_value == "past_due":
            update["grace_until"] = compute_grace_until(now)

        await db.subscriptions.update_one({"owner_id": owner_id}, {"$set": update})

    await db.billing_events.insert_one(
        {
            "event_id": event_id,
            "action": action,
            "payload": payload,
            "received_at": now,
        }
    )

    return {"status": "ok"}
