import asyncio
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
    BillingOverviewOut,
    BillingOverviewSummaryOut,
    CheckoutOut,
    InvoiceOut,
    MembershipOut,
    PaymentAttemptOut,
    SubscriptionEventOut,
    SubscriptionStatusOut,
)
from app.services.mp_payments import (
    fetch_payment,
    payment_approved_at,
    payment_owner_id,
    payment_status_to_subscription_status,
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


def _extract_payment_id(payload: dict) -> str | None:
    details = payload.get("data") or {}
    payment_id = str(details.get("id") or "").strip()
    if payment_id:
        return payment_id
    return None


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


async def _build_billing_overview(
    owner_id: str,
    *,
    invoice_limit: int = 12,
    attempt_limit: int = 12,
    event_limit: int = 16,
) -> BillingOverviewOut:
    db = get_db()

    subscription_task = _subscription_status(owner_id)
    membership_task = _sync_membership(owner_id)
    invoices_task = (
        db.invoices.find({"owner_id": owner_id}, {"_id": 0})
        .sort("created_at", -1)
        .limit(invoice_limit)
        .to_list(invoice_limit)
    )
    attempts_task = (
        db.payment_attempts.find({"owner_id": owner_id}, {"_id": 0})
        .sort("created_at", -1)
        .limit(attempt_limit)
        .to_list(attempt_limit)
    )
    events_task = (
        db.subscription_events.find({"owner_id": owner_id}, {"_id": 0})
        .sort("created_at", -1)
        .limit(event_limit)
        .to_list(event_limit)
    )
    invoice_status_totals_task = db.invoices.aggregate(
        [
            {"$match": {"owner_id": owner_id}},
            {
                "$group": {
                    "_id": "$status",
                    "count": {"$sum": 1},
                    "amount_total": {"$sum": {"$ifNull": ["$amount", 0]}},
                }
            },
        ]
    ).to_list(None)
    failed_attempt_count_task = db.payment_attempts.count_documents(
        {"owner_id": owner_id, "status": "failed"}
    )
    next_due_task = (
        db.invoices.find(
            {"owner_id": owner_id, "status": {"$in": ["open", "past_due"]}},
            {"_id": 0, "due_date": 1},
        )
        .sort("due_date", 1)
        .limit(1)
        .to_list(1)
    )

    (
        subscription,
        membership,
        invoices,
        attempts,
        events,
        invoice_status_totals,
        failed_attempt_count,
        next_due,
    ) = await asyncio.gather(
        subscription_task,
        membership_task,
        invoices_task,
        attempts_task,
        events_task,
        invoice_status_totals_task,
        failed_attempt_count_task,
        next_due_task,
    )

    counts: dict[str, int] = {}
    recognized_revenue = 0.0
    outstanding_amount = 0.0
    for row in invoice_status_totals:
        status_key = str(row.get("_id") or "").lower()
        counts[status_key] = int(row.get("count") or 0)
        amount_total = float(row.get("amount_total") or 0)
        if status_key == "paid":
            recognized_revenue = amount_total
        if status_key in {"open", "past_due"}:
            outstanding_amount += amount_total

    summary = BillingOverviewSummaryOut(
        recognized_revenue=recognized_revenue,
        outstanding_amount=outstanding_amount,
        paid_invoice_count=counts.get("paid", 0),
        open_invoice_count=counts.get("open", 0),
        past_due_invoice_count=counts.get("past_due", 0),
        failed_attempt_count=int(failed_attempt_count or 0),
        next_invoice_due_at=(next_due[0] or {}).get("due_date") if next_due else None,
        last_event_at=(events[0] or {}).get("created_at") if events else None,
        action_required=(
            not subscription.can_login
            or counts.get("past_due", 0) > 0
            or int(failed_attempt_count or 0) > 0
        ),
    )

    return BillingOverviewOut(
        subscription=subscription,
        membership=membership,
        invoices=invoices,
        attempts=attempts,
        events=events,
        summary=summary,
    )


@router.get("/subscription/status", response_model=SubscriptionStatusOut)
async def subscription_status(
    refresh: bool = Query(default=False),
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    if refresh:
        await reconcile_subscriptions(owner_id=actor["owner_id"], limit=1)
    return await _subscription_status(actor["owner_id"])


@router.get("/overview", response_model=BillingOverviewOut)
async def billing_overview(
    invoice_limit: int = Query(default=12, ge=1, le=100),
    attempt_limit: int = Query(default=12, ge=1, le=100),
    event_limit: int = Query(default=16, ge=1, le=100),
    refresh: bool = Query(default=False),
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    if refresh:
        await reconcile_subscriptions(owner_id=actor["owner_id"], limit=1)
    return await _build_billing_overview(
        actor["owner_id"],
        invoice_limit=invoice_limit,
        attempt_limit=attempt_limit,
        event_limit=event_limit,
    )


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
    preapproval_id: str | None = None
    provider_reference: str | None = None
    checkout_mode = "mock"

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
                preapproval_id = str(data.get("id") or "").strip() or None
                provider_reference = preapproval_id
                checkout_mode = "preapproval"
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
                    provider_reference = str(pref_data.get("id") or "").strip() or None
                    checkout_mode = "preference"
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
    else:
        preapproval_id = f"mock_pre_{owner_id}"
        provider_reference = preapproval_id

    current_now = now_utc()
    subscription_update = {
        "updated_at": current_now,
        "provider": "mercadopago",
        "meta.last_checkout": {
            "at": current_now,
            "mode": checkout_mode,
            "preapproval_id": preapproval_id,
            "provider_reference": provider_reference,
        },
    }
    if preapproval_id is not None:
        subscription_update["mp_preapproval_id"] = preapproval_id
    await db.subscriptions.update_one(
        {"owner_id": owner_id},
        {"$set": subscription_update},
    )
    membership_doc = await _sync_membership(owner_id, now=current_now)
    invoice_doc = await _upsert_invoice(
        owner_id,
        status_value="open",
        paid=False,
        provider_reference=provider_reference,
        amount=membership_doc.get("amount"),
        now=current_now,
    )
    await _record_payment_attempt(
        owner_id,
        subscription_status=membership_doc.get("status", "trialing"),
        provider_reference=provider_reference,
        reason="checkout_created",
        payload={"stage": "checkout", "mode": checkout_mode},
        invoice_id=invoice_doc.get("invoice_id"),
        amount=membership_doc.get("amount"),
        now=current_now,
    )
    await _record_subscription_event(
        owner_id,
        source="manual",
        event_type="checkout_created",
        status_value=membership_doc.get("status", "trialing"),
        metadata={
            "preapproval_id": preapproval_id,
            "provider_reference": provider_reference,
            "mode": checkout_mode,
        },
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
    payload_type = str(payload.get("type") or "").lower()
    payment_details = None
    payment_id = _extract_payment_id(payload)
    if settings.mp_access_token and payment_id and "payment" in payload_type:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                payment_details = await fetch_payment(client, payment_id, settings.mp_access_token)
        except Exception as exc:  # pragma: no cover - network dependent
            log_event(
                "billing_webhook_payment_fetch_failed",
                payment_id=payment_id,
                error=str(exc),
            )

    owner_id = (
        payload.get("external_reference")
        or payload.get("metadata", {}).get("owner_id")
        or payment_owner_id(payment_details)
    )
    if not owner_id:
        pre_id = payload.get("data", {}).get("id") or payload.get("id")
        sub = await db.subscriptions.find_one({"mp_preapproval_id": pre_id}, {"_id": 0})
        owner_id = sub.get("owner_id") if sub else None

    if payment_details and payment_details.get("status"):
        status_value = payment_status_to_subscription_status(payment_details.get("status"))
    else:
        status_value = status_from_payload(payload)

    if owner_id:
        reference_now = payment_approved_at(payment_details) or now
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
            update["current_period_end"] = compute_next_period_end(reference_now)
            update["last_payment_at"] = reference_now
            update["grace_until"] = None
        elif status_value == "past_due":
            update["grace_until"] = compute_grace_until(now)

        await db.subscriptions.update_one({"owner_id": owner_id}, {"$set": update})
        membership_doc = await _sync_membership(owner_id, now=now)
        invoice_doc = await _upsert_invoice(
            owner_id,
            status_value="paid" if status_value == "active" else "past_due",
            paid=status_value == "active",
            provider_reference=str(
                (payment_details or {}).get("id")
                or payload.get("id")
                or payload.get("data", {}).get("id")
                or ""
            ),
            amount=membership_doc.get("amount"),
            now=reference_now,
        )
        await _record_payment_attempt(
            owner_id,
            subscription_status=status_value,
            provider_reference=str(
                (payment_details or {}).get("id")
                or payload.get("id")
                or payload.get("data", {}).get("id")
                or ""
            ),
            reason=action or payload.get("type"),
            payload={
                "type": payload.get("type"),
                "action": action,
                "payment_status": (payment_details or {}).get("status"),
            },
            invoice_id=invoice_doc.get("invoice_id"),
            amount=membership_doc.get("amount"),
            now=reference_now,
        )
        await _record_subscription_event(
            owner_id,
            source="webhook",
            event_type=action or str(payload.get("type") or "unknown"),
            status_value=status_value,
            metadata={
                "event_id": event_id,
                "payment_id": (payment_details or {}).get("id"),
            },
            now=reference_now,
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
