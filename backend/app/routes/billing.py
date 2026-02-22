import hashlib
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from app.core.config import get_settings
from app.core.deps import require_roles
from app.core.http import get_client_ip
from app.core.rate_limit import enforce_rate_limit
from app.db.mongo import get_db
from app.models.billing import CheckoutOut, SubscriptionStatusOut
from app.services.billing_reconcile import reconcile_subscriptions
from app.services.observability import log_event
from app.services.subscription import (
    compute_grace_until,
    compute_next_period_end,
    now_utc,
    subscription_allows_login,
)

router = APIRouter()


def status_from_action(action: str) -> str:
    action = (action or "").lower()
    if "cancel" in action:
        return "canceled"
    if "fail" in action or "reject" in action or "past_due" in action:
        return "past_due"
    if "expire" in action:
        return "expired"
    return "active"


def status_from_payload(payload: dict) -> str:
    details = payload.get("data") or {}
    external_status = (
        str(details.get("status") or payload.get("status") or payload.get("type") or "")
        .lower()
        .strip()
    )
    if external_status in {"authorized", "approved", "active", "paid"}:
        return "active"
    if external_status in {"cancelled", "canceled", "paused"}:
        return "canceled"
    if external_status in {"rejected", "failed", "failure", "past_due"}:
        return "past_due"
    if external_status in {"expired"}:
        return "expired"
    return status_from_action(str(payload.get("action", "")))


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
async def subscription_status(actor: dict = Depends(require_roles("OWNER", "MANAGER"))):
    return await _subscription_status(actor["owner_id"])


@router.post("/subscription/checkout", response_model=CheckoutOut)
async def subscription_checkout(actor: dict = Depends(require_roles("OWNER", "MANAGER"))):
    return await create_checkout_for_owner(actor)


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
            "notification_url": f"{settings.app_base_url.rstrip('/')}/api/billing/webhook/mercadopago",
            "external_reference": owner_id,
            "metadata": {"owner_id": owner_id},
        }
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                "https://api.mercadopago.com/preapproval",
                headers={"Authorization": f"Bearer {settings.mp_access_token}"},
                json=payload,
            )
            if response.is_success:
                data = response.json()
                checkout_url = (
                    data.get("init_point") or data.get("sandbox_init_point") or checkout_url
                )
                preapproval_id = data.get("id") or preapproval_id
            else:
                raise HTTPException(
                    status_code=502,
                    detail=f"Falha ao criar checkout no Mercado Pago (status {response.status_code})",
                )

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
async def webhook_mercadopago(request: Request, x_signature: str | None = Header(default=None)):
    settings = get_settings()
    db = get_db()
    source_ip = get_client_ip(request)
    await enforce_rate_limit(
        scope="billing.webhook",
        key=source_ip,
        limit=settings.webhook_rate_limit,
        window_seconds=settings.webhook_window_seconds,
        error_detail="Webhook temporariamente limitado por excesso de trafego",
    )

    raw = await request.body()
    payload = await request.json()

    if settings.mp_webhook_secret:
        digest = hashlib.sha256(raw + settings.mp_webhook_secret.encode("utf-8")).hexdigest()
        signature_value = x_signature or ""
        if signature_value.startswith("ts="):
            for part in signature_value.split(","):
                if part.strip().startswith("v1="):
                    signature_value = part.strip().split("=", 1)[1]
                    break
        if signature_value and digest != signature_value and digest not in signature_value:
            now = datetime.now(UTC)
            await db.billing_events.insert_one(
                {
                    "event_id": f"rejected_signature:{int(now.timestamp() * 1000000)}:{digest[:8]}",
                    "action": "webhook_rejected",
                    "owner_id": payload.get("external_reference")
                    or payload.get("metadata", {}).get("owner_id"),
                    "status": "rejected",
                    "payload": {
                        "reason": "invalid_signature",
                        "ip": source_ip,
                        "type": payload.get("type"),
                        "action": payload.get("action"),
                    },
                    "received_at": now,
                }
            )
            log_event(
                "billing_webhook_rejected",
                reason="invalid_signature",
                ip=source_ip,
                action=payload.get("action"),
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Assinatura de webhook invalida",
            )

    event_id = str(payload.get("id") or payload.get("data", {}).get("id") or "")
    if not event_id:
        event_id = hashlib.sha256(raw).hexdigest()[:24]

    if await db.billing_events.find_one({"event_id": event_id}):
        return {"status": "ignored", "reason": "duplicate"}

    now = datetime.now(UTC)
    action = payload.get("action", "")
    status_value = status_from_payload(payload)

    owner_id = payload.get("external_reference") or payload.get("metadata", {}).get("owner_id")
    if not owner_id:
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
            "owner_id": owner_id,
            "status": status_value,
            "payload": payload,
            "received_at": now,
        }
    )
    if status_value in {"past_due", "canceled", "expired"}:
        log_event(
            "billing_webhook_failure",
            owner_id=owner_id,
            status=status_value,
            action=action,
            event_id=event_id,
            ip=source_ip,
        )

    return {"status": "ok"}


@router.get("/webhook/logs")
async def webhook_logs(limit: int = 100, actor: dict = Depends(require_roles("OWNER", "MANAGER"))):
    db = get_db()
    return (
        await db.billing_events.find({"owner_id": actor["owner_id"]}, {"_id": 0})
        .sort("received_at", -1)
        .limit(limit)
        .to_list(limit)
    )


@router.post("/reconcile/run")
async def run_reconcile(actor: dict = Depends(require_roles("OWNER", "MANAGER"))):
    summary = await reconcile_subscriptions(owner_id=actor["owner_id"], limit=1)
    return {"owner_id": actor["owner_id"], "summary": summary}
