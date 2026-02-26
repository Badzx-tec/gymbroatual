import hashlib
import secrets
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status

from app.core.config import get_settings
from app.core.deps import require_roles
from app.core.http import get_client_ip
from app.core.rate_limit import enforce_rate_limit
from app.core.time import UTC
from app.db.mongo import get_db
from app.models.billing import (
    CheckoutOut,
    InvoiceOut,
    MembershipOut,
    PaymentAttemptOut,
    SubscriptionEventOut,
    SubscriptionStatusOut,
)
from app.services.billing_reconcile import reconcile_subscriptions
from app.services.observability import log_event
from app.services.subscription import (
    compute_grace_until,
    compute_next_period_end,
    now_utc,
    subscription_allows_login,
)

router = APIRouter()

MEMBERSHIP_PLAN_CODE = "owner_monthly"


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


def _month_label(reference: datetime) -> str:
    return reference.strftime("%Y-%m")


def _payment_attempt_status(subscription_status: str) -> str:
    if subscription_status == "active":
        return "succeeded"
    if subscription_status in {"past_due", "canceled", "expired"}:
        return "failed"
    return "pending"


async def _sync_membership(owner_id: str, *, now: datetime | None = None) -> dict:
    db = get_db()
    settings = get_settings()
    current_now = now or now_utc()
    subscription = await db.subscriptions.find_one({"owner_id": owner_id}, {"_id": 0})
    if not subscription:
        raise HTTPException(status_code=404, detail="Assinatura nao encontrada")

    update = {
        "plan_code": MEMBERSHIP_PLAN_CODE,
        "amount": settings.subscription_monthly_amount,
        "currency": "BRL",
        "provider": "mercadopago",
        "status": subscription.get("status", "trialing"),
        "trial_ends_at": subscription.get("trial_ends_at"),
        "current_period_start": subscription.get("last_payment_at"),
        "current_period_end": subscription.get("current_period_end"),
        "canceled_at": current_now if subscription.get("status") == "canceled" else None,
        "updated_at": current_now,
    }
    await db.memberships.update_one(
        {"owner_id": owner_id},
        {
            "$set": update,
            "$setOnInsert": {
                "membership_id": f"mem_{secrets.token_hex(6)}",
                "owner_id": owner_id,
                "started_at": current_now,
            },
        },
        upsert=True,
    )
    membership = await db.memberships.find_one({"owner_id": owner_id}, {"_id": 0})
    if not membership:
        raise HTTPException(status_code=500, detail="Falha ao sincronizar membership")
    return membership


async def _upsert_invoice(
    owner_id: str,
    *,
    status_value: str,
    paid: bool = False,
    provider_reference: str | None = None,
    amount: float | None = None,
    now: datetime | None = None,
) -> dict:
    db = get_db()
    settings = get_settings()
    current_now = now or now_utc()
    period_label = _month_label(current_now)
    invoice_id = f"inv_{owner_id}_{period_label.replace('-', '')}"
    invoice_status = (
        status_value
        if status_value in {"draft", "open", "paid", "past_due", "canceled"}
        else "open"
    )
    normalized_amount = float(
        amount if amount is not None else settings.subscription_monthly_amount
    )

    update = {
        "amount": normalized_amount,
        "currency": "BRL",
        "status": "paid" if paid else invoice_status,
        "due_date": current_now,
        "provider_reference": provider_reference,
        "updated_at": current_now,
    }
    if paid:
        update["paid_at"] = current_now

    await db.invoices.update_one(
        {"owner_id": owner_id, "period_label": period_label},
        {
            "$set": update,
            "$setOnInsert": {
                "invoice_id": invoice_id,
                "owner_id": owner_id,
                "period_label": period_label,
                "created_at": current_now,
            },
        },
        upsert=True,
    )
    invoice = await db.invoices.find_one(
        {"owner_id": owner_id, "period_label": period_label},
        {"_id": 0},
    )
    if not invoice:
        raise HTTPException(status_code=500, detail="Falha ao sincronizar invoice")
    return invoice


async def _record_payment_attempt(
    owner_id: str,
    *,
    subscription_status: str,
    provider_reference: str | None,
    reason: str | None,
    payload: dict | None = None,
    invoice_id: str | None = None,
    amount: float | None = None,
    now: datetime | None = None,
) -> None:
    db = get_db()
    settings = get_settings()
    current_now = now or now_utc()
    await db.payment_attempts.insert_one(
        {
            "attempt_id": f"pay_{secrets.token_hex(8)}",
            "owner_id": owner_id,
            "invoice_id": invoice_id,
            "amount": float(amount if amount is not None else settings.subscription_monthly_amount),
            "currency": "BRL",
            "status": _payment_attempt_status(subscription_status),
            "provider": "mercadopago",
            "provider_reference": provider_reference,
            "reason": reason,
            "payload": payload or {},
            "created_at": current_now,
        }
    )


async def _record_subscription_event(
    owner_id: str,
    *,
    source: str,
    event_type: str,
    status_value: str,
    metadata: dict | None = None,
    now: datetime | None = None,
) -> None:
    db = get_db()
    current_now = now or now_utc()
    await db.subscription_events.insert_one(
        {
            "event_id": f"subevt_{secrets.token_hex(8)}",
            "owner_id": owner_id,
            "source": source,
            "event_type": event_type,
            "status": status_value,
            "metadata": metadata or {},
            "created_at": current_now,
        }
    )


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
async def subscription_status(
    refresh: bool = Query(default=False),
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    if refresh:
        await reconcile_subscriptions(owner_id=actor["owner_id"], limit=1)
    return await _subscription_status(actor["owner_id"])


@router.get("/membership", response_model=MembershipOut)
async def membership(actor: dict = Depends(require_roles("OWNER", "MANAGER"))):
    return await _sync_membership(actor["owner_id"])


@router.get("/invoices", response_model=list[InvoiceOut])
async def invoices(
    limit: int = Query(default=50, ge=1, le=500),
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    return (
        await db.invoices.find({"owner_id": actor["owner_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )


@router.get("/payment-attempts", response_model=list[PaymentAttemptOut])
async def payment_attempts(
    limit: int = Query(default=100, ge=1, le=1000),
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    return (
        await db.payment_attempts.find({"owner_id": actor["owner_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )


@router.get("/events", response_model=list[SubscriptionEventOut])
async def subscription_events(
    limit: int = Query(default=100, ge=1, le=1000),
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    return (
        await db.subscription_events.find({"owner_id": actor["owner_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )


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
            "payer_email": owner["email"],
            "back_url": settings.frontend_base_url,
            "status": "pending",
            "notification_url": f"{settings.app_base_url.rstrip('/')}/api/billing/webhook/mercadopago",
            "external_reference": owner_id,
            "metadata": {"owner_id": owner_id},
        }
        if settings.mp_preapproval_plan_id:
            payload["preapproval_plan_id"] = settings.mp_preapproval_plan_id
        else:
            payload["auto_recurring"] = {
                "frequency": 1,
                "frequency_type": "months",
                "transaction_amount": settings.subscription_monthly_amount,
                "currency_id": "BRL",
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
                preapproval_body = response.text[:300]
                log_event(
                    "billing_checkout_preapproval_failed",
                    owner_id=owner_id,
                    status_code=response.status_code,
                    detail=preapproval_body,
                )

                preference_payload = {
                    "items": [
                        {
                            "title": "Assinatura GymBro",
                            "quantity": 1,
                            "currency_id": "BRL",
                            "unit_price": float(settings.subscription_monthly_amount),
                        }
                    ],
                    "payer": {"email": owner["email"]},
                    "external_reference": owner_id,
                    "notification_url": f"{settings.app_base_url.rstrip('/')}/api/billing/webhook/mercadopago",
                    "back_urls": {
                        "success": f"{settings.frontend_base_url.rstrip('/')}/admin/assinatura?status=success",
                        "failure": f"{settings.frontend_base_url.rstrip('/')}/admin/assinatura?status=failure",
                        "pending": f"{settings.frontend_base_url.rstrip('/')}/admin/assinatura?status=pending",
                    },
                    "auto_return": "approved",
                    "metadata": {"owner_id": owner_id},
                }
                pref_response = await client.post(
                    "https://api.mercadopago.com/checkout/preferences",
                    headers={"Authorization": f"Bearer {settings.mp_access_token}"},
                    json=preference_payload,
                )
                if pref_response.is_success:
                    pref_data = pref_response.json()
                    checkout_url = (
                        pref_data.get("init_point")
                        or pref_data.get("sandbox_init_point")
                        or checkout_url
                    )
                    preapproval_id = pref_data.get("id") or preapproval_id
                else:
                    pref_body = pref_response.text[:300]
                    raise HTTPException(
                        status_code=502,
                        detail=(
                            "Falha ao criar checkout no Mercado Pago "
                            f"(preapproval {response.status_code}: {preapproval_body}; "
                            f"preference {pref_response.status_code}: {pref_body})"
                        ),
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
    current_now = now_utc()
    membership_doc = await _sync_membership(owner_id, now=current_now)
    invoice_doc = await _upsert_invoice(
        owner_id,
        status_value="open",
        paid=False,
        provider_reference=preapproval_id,
        amount=membership_doc.get("amount"),
        now=current_now,
    )
    await _record_payment_attempt(
        owner_id,
        subscription_status=membership_doc.get("status", "trialing"),
        provider_reference=preapproval_id,
        reason="checkout_created",
        payload={"stage": "checkout"},
        invoice_id=invoice_doc.get("invoice_id"),
        amount=membership_doc.get("amount"),
        now=current_now,
    )
    await _record_subscription_event(
        owner_id,
        source="manual",
        event_type="checkout_created",
        status_value=membership_doc.get("status", "trialing"),
        metadata={"preapproval_id": preapproval_id},
        now=current_now,
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
        membership_doc = await _sync_membership(owner_id, now=now)
        invoice_doc = await _upsert_invoice(
            owner_id,
            status_value="paid" if status_value == "active" else "past_due",
            paid=status_value == "active",
            provider_reference=str(payload.get("id") or payload.get("data", {}).get("id") or ""),
            amount=membership_doc.get("amount"),
            now=now,
        )
        await _record_payment_attempt(
            owner_id,
            subscription_status=status_value,
            provider_reference=str(payload.get("id") or payload.get("data", {}).get("id") or ""),
            reason=action or payload.get("type"),
            payload={"type": payload.get("type"), "action": action},
            invoice_id=invoice_doc.get("invoice_id"),
            amount=membership_doc.get("amount"),
            now=now,
        )
        await _record_subscription_event(
            owner_id,
            source="webhook",
            event_type=action or str(payload.get("type") or "unknown"),
            status_value=status_value,
            metadata={"event_id": event_id},
            now=now,
        )

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


@router.post("/subscription/refresh")
async def subscription_refresh(actor: dict = Depends(require_roles("OWNER", "MANAGER"))):
    summary = await reconcile_subscriptions(owner_id=actor["owner_id"], limit=1)
    status_data = await _subscription_status(actor["owner_id"])
    return {
        "owner_id": actor["owner_id"],
        "summary": summary,
        "subscription": status_data.model_dump(),
    }
