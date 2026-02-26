from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.deps import require_roles
from app.core.time import UTC
from app.db.mongo import get_db
from app.services.subscription import subscription_allows_login

router = APIRouter()


def _as_utc_datetime(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    return None


def _month_floor(value: datetime) -> datetime:
    return value.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _shift_months(value: datetime, months: int) -> datetime:
    year = value.year
    month = value.month + months
    while month <= 0:
        month += 12
        year -= 1
    while month > 12:
        month -= 12
        year += 1
    return value.replace(year=year, month=month)


def _month_label(value: datetime) -> str:
    names = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
    return f"{names[value.month - 1]}/{value.year % 100:02d}"


def _to_float(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _is_access_allowed(log: dict) -> bool:
    if "autorizado" in log:
        return bool(log.get("autorizado"))
    decision = str(log.get("decision") or "").strip().lower()
    if decision:
        return decision == "allow"
    return True


@router.get("/overview")
async def platform_overview(actor: dict = Depends(require_roles("SUPER_ADMIN"))):
    db = get_db()
    now = datetime.now(UTC)
    last_24h = now - timedelta(hours=24)

    total_owners = await db.owners.count_documents({})
    verified_owners = await db.owners.count_documents({"email_verified": True})
    total_gyms = await db.gyms.count_documents({})
    total_students = await db.students.count_documents({})
    total_employees = await db.employees.count_documents({"is_active": True})
    total_turnstile_devices = await db.turnstile_devices.count_documents({})
    subscriptions_active = await db.subscriptions.count_documents(
        {"status": {"$in": ["active", "trialing"]}}
    )
    subscriptions_past_due = await db.subscriptions.count_documents(
        {"status": {"$in": ["past_due", "canceled", "expired"]}}
    )
    accesses_24h = await db.access_logs.count_documents(
        {
            "$or": [
                {"timestamp": {"$gte": last_24h}},
                {"created_at": {"$gte": last_24h}},
            ]
        }
    )
    payment_failures_24h = await db.payment_attempts.count_documents(
        {
            "status": "failed",
            "created_at": {"$gte": last_24h},
        }
    )

    mrr_pipeline = [
        {"$match": {"status": {"$in": ["active", "trialing", "past_due"]}}},
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$amount", 0]}}}},
    ]
    mrr_data = await db.memberships.aggregate(mrr_pipeline).to_list(1)
    estimated_mrr = _to_float((mrr_data[0] if mrr_data else {}).get("total"))

    return {
        "generated_at": now,
        "kpis": {
            "total_owners": total_owners,
            "verified_owners": verified_owners,
            "total_gyms": total_gyms,
            "total_students": total_students,
            "total_employees": total_employees,
            "total_turnstile_devices": total_turnstile_devices,
            "subscriptions_active": subscriptions_active,
            "subscriptions_past_due": subscriptions_past_due,
            "accesses_24h": accesses_24h,
            "payment_failures_24h": payment_failures_24h,
            "estimated_mrr": round(estimated_mrr, 2),
        },
        "actor": {
            "email": actor.get("email"),
            "name": actor.get("name"),
        },
    }


@router.get("/owners")
async def platform_owners(
    limit: int = Query(default=100, ge=1, le=500),
    actor: dict = Depends(require_roles("SUPER_ADMIN")),
):
    db = get_db()
    _ = actor

    owners = (
        await db.owners.find(
            {},
            {
                "_id": 0,
                "owner_id": 1,
                "name": 1,
                "email": 1,
                "email_verified": 1,
                "created_at": 1,
            },
        )
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )
    owner_ids = [owner["owner_id"] for owner in owners]
    if not owner_ids:
        return {"items": [], "count": 0}

    gyms = await db.gyms.find(
        {"owner_id": {"$in": owner_ids}}, {"_id": 0, "owner_id": 1, "gym_id": 1, "name": 1}
    ).to_list(len(owner_ids) * 2)
    gym_by_owner = {item["owner_id"]: item for item in gyms}

    subscriptions = await db.subscriptions.find(
        {"owner_id": {"$in": owner_ids}},
        {"_id": 0, "owner_id": 1, "status": 1, "current_period_end": 1, "grace_until": 1},
    ).to_list(len(owner_ids))
    subs_by_owner = {item["owner_id"]: item for item in subscriptions}

    students_counts_raw = await db.students.aggregate(
        [
            {"$match": {"owner_id": {"$in": owner_ids}}},
            {"$group": {"_id": "$owner_id", "count": {"$sum": 1}}},
        ]
    ).to_list(len(owner_ids))
    students_counts = {item["_id"]: int(item.get("count") or 0) for item in students_counts_raw}

    active_students_counts_raw = await db.students.aggregate(
        [
            {"$match": {"owner_id": {"$in": owner_ids}, "status": "ativo"}},
            {"$group": {"_id": "$owner_id", "count": {"$sum": 1}}},
        ]
    ).to_list(len(owner_ids))
    active_students_counts = {
        item["_id"]: int(item.get("count") or 0) for item in active_students_counts_raw
    }

    employees_counts_raw = await db.employees.aggregate(
        [
            {"$match": {"owner_id": {"$in": owner_ids}, "is_active": True}},
            {"$group": {"_id": "$owner_id", "count": {"$sum": 1}}},
        ]
    ).to_list(len(owner_ids))
    employees_counts = {item["_id"]: int(item.get("count") or 0) for item in employees_counts_raw}

    last_access_raw = await db.access_logs.aggregate(
        [
            {"$match": {"owner_id": {"$in": owner_ids}}},
            {"$project": {"owner_id": 1, "event_at": {"$ifNull": ["$timestamp", "$created_at"]}}},
            {"$group": {"_id": "$owner_id", "last_access_at": {"$max": "$event_at"}}},
        ]
    ).to_list(len(owner_ids))
    last_access_by_owner = {
        item["_id"]: _as_utc_datetime(item.get("last_access_at")) for item in last_access_raw
    }

    items = []
    for owner in owners:
        owner_id = owner["owner_id"]
        subscription = subs_by_owner.get(owner_id)
        gym = gym_by_owner.get(owner_id) or {}
        items.append(
            {
                "owner_id": owner_id,
                "name": owner.get("name"),
                "email": owner.get("email"),
                "email_verified": bool(owner.get("email_verified")),
                "gym_id": gym.get("gym_id"),
                "gym_name": gym.get("name"),
                "subscription_status": (subscription or {}).get("status", "unknown"),
                "subscription_can_login": subscription_allows_login(subscription),
                "subscription_current_period_end": (subscription or {}).get("current_period_end"),
                "subscription_grace_until": (subscription or {}).get("grace_until"),
                "students_total": students_counts.get(owner_id, 0),
                "students_active": active_students_counts.get(owner_id, 0),
                "employees_active": employees_counts.get(owner_id, 0),
                "last_access_at": last_access_by_owner.get(owner_id),
                "created_at": owner.get("created_at"),
            }
        )

    return {"items": items, "count": len(items)}


@router.get("/finance/summary")
async def platform_finance_summary(
    days: int = Query(default=30, ge=1, le=365),
    actor: dict = Depends(require_roles("SUPER_ADMIN")),
):
    db = get_db()
    _ = actor

    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    this_month = _month_floor(now)
    first_month = _month_floor(_shift_months(this_month, -5))

    paid_invoices = await db.invoices.find(
        {
            "status": "paid",
            "paid_at": {"$gte": since},
        },
        {"_id": 0, "owner_id": 1, "amount": 1, "paid_at": 1},
    ).to_list(20000)
    revenue_period = round(sum(_to_float(item.get("amount")) for item in paid_invoices), 2)

    open_invoices = await db.invoices.find(
        {"status": {"$in": ["open", "past_due"]}},
        {"_id": 0, "owner_id": 1, "amount": 1},
    ).to_list(20000)
    outstanding_amount = round(sum(_to_float(item.get("amount")) for item in open_invoices), 2)

    past_due_owners = await db.subscriptions.count_documents({"status": "past_due"})

    mrr_pipeline = [
        {"$match": {"status": {"$in": ["active", "trialing", "past_due"]}}},
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$amount", 0]}}}},
    ]
    mrr_data = await db.memberships.aggregate(mrr_pipeline).to_list(1)
    estimated_mrr = round(_to_float((mrr_data[0] if mrr_data else {}).get("total")), 2)

    monthly_pipeline = [
        {"$match": {"status": "paid", "paid_at": {"$gte": first_month}}},
        {
            "$group": {
                "_id": {
                    "year": {"$year": "$paid_at"},
                    "month": {"$month": "$paid_at"},
                },
                "amount": {"$sum": {"$ifNull": ["$amount", 0]}},
                "count": {"$sum": 1},
            }
        },
    ]
    monthly_raw = await db.invoices.aggregate(monthly_pipeline).to_list(20)
    monthly_map = {
        (int(item["_id"]["year"]), int(item["_id"]["month"])): {
            "amount": round(_to_float(item.get("amount")), 2),
            "count": int(item.get("count") or 0),
        }
        for item in monthly_raw
    }
    monthly = []
    for offset in range(5, -1, -1):
        month_dt = _month_floor(_shift_months(this_month, -offset))
        key = (month_dt.year, month_dt.month)
        values = monthly_map.get(key, {"amount": 0.0, "count": 0})
        monthly.append(
            {
                "month": _month_label(month_dt),
                "amount": values["amount"],
                "paid_invoices": values["count"],
            }
        )

    top_owners_pipeline = [
        {"$match": {"status": "paid", "paid_at": {"$gte": since}}},
        {
            "$group": {
                "_id": "$owner_id",
                "amount": {"$sum": {"$ifNull": ["$amount", 0]}},
                "paid_invoices": {"$sum": 1},
            }
        },
        {"$sort": {"amount": -1}},
        {"$limit": 10},
    ]
    top_owners_raw = await db.invoices.aggregate(top_owners_pipeline).to_list(10)
    top_owner_ids = [item["_id"] for item in top_owners_raw if item.get("_id")]
    owners = await db.owners.find(
        {"owner_id": {"$in": top_owner_ids}},
        {"_id": 0, "owner_id": 1, "name": 1, "email": 1},
    ).to_list(20)
    owner_by_id = {owner["owner_id"]: owner for owner in owners}
    top_owners = []
    for item in top_owners_raw:
        owner_id = item.get("_id")
        if not owner_id:
            continue
        owner = owner_by_id.get(owner_id, {})
        top_owners.append(
            {
                "owner_id": owner_id,
                "name": owner.get("name"),
                "email": owner.get("email"),
                "amount": round(_to_float(item.get("amount")), 2),
                "paid_invoices": int(item.get("paid_invoices") or 0),
            }
        )

    return {
        "generated_at": now,
        "period_days": days,
        "summary": {
            "revenue_in_period": revenue_period,
            "paid_invoices_in_period": len(paid_invoices),
            "outstanding_amount": outstanding_amount,
            "open_or_past_due_invoices": len(open_invoices),
            "past_due_owners": past_due_owners,
            "estimated_mrr": estimated_mrr,
        },
        "monthly_revenue": monthly,
        "top_owners": top_owners,
    }


@router.get("/logs")
async def platform_logs(
    owner_id: str | None = Query(default=None),
    source: str | None = Query(default=None),
    limit: int = Query(default=200, ge=20, le=500),
    actor: dict = Depends(require_roles("SUPER_ADMIN")),
):
    db = get_db()
    _ = actor

    requested_source = (source or "").strip().lower() or None
    allowed_sources = {"access", "billing", "security", "subscription"}
    if requested_source and requested_source not in allowed_sources:
        raise HTTPException(status_code=400, detail="Fonte de log invalida")

    query: dict = {}
    if owner_id:
        query["owner_id"] = owner_id

    per_source_limit = limit if requested_source else min(max(limit, 80), 200)
    events: list[dict] = []

    if requested_source in (None, "access"):
        access_logs = (
            await db.access_logs.find(
                query,
                {
                    "_id": 0,
                    "owner_id": 1,
                    "student_name": 1,
                    "employee_name": 1,
                    "subject_type": 1,
                    "method": 1,
                    "autorizado": 1,
                    "decision": 1,
                    "timestamp": 1,
                    "created_at": 1,
                },
            )
            .sort("created_at", -1)
            .limit(per_source_limit)
            .to_list(per_source_limit)
        )
        for item in access_logs:
            allowed = _is_access_allowed(item)
            subject_name = item.get("student_name") or item.get("employee_name") or "Nao identificado"
            summary = f"{subject_name} - {'allow' if allowed else 'deny'} ({item.get('method') or 'desconhecido'})"
            events.append(
                {
                    "source": "access",
                    "owner_id": item.get("owner_id"),
                    "timestamp": _as_utc_datetime(item.get("timestamp"))
                    or _as_utc_datetime(item.get("created_at")),
                    "summary": summary,
                    "data": item,
                }
            )

    if requested_source in (None, "billing"):
        billing_logs = (
            await db.billing_events.find(
                query,
                {
                    "_id": 0,
                    "owner_id": 1,
                    "action": 1,
                    "status": 1,
                    "event_id": 1,
                    "received_at": 1,
                    "payload": 1,
                },
            )
            .sort("received_at", -1)
            .limit(per_source_limit)
            .to_list(per_source_limit)
        )
        for item in billing_logs:
            action = item.get("action") or "billing_event"
            status = item.get("status") or "unknown"
            summary = f"{action} ({status})"
            events.append(
                {
                    "source": "billing",
                    "owner_id": item.get("owner_id"),
                    "timestamp": _as_utc_datetime(item.get("received_at")),
                    "summary": summary,
                    "data": item,
                }
            )

    if requested_source in (None, "security"):
        security_logs = (
            await db.turnstile_security_events.find(
                query,
                {
                    "_id": 0,
                    "owner_id": 1,
                    "event": 1,
                    "reason": 1,
                    "created_at": 1,
                },
            )
            .sort("created_at", -1)
            .limit(per_source_limit)
            .to_list(per_source_limit)
        )
        for item in security_logs:
            summary = f"{item.get('event') or 'security_event'} ({item.get('reason') or 'n/a'})"
            events.append(
                {
                    "source": "security",
                    "owner_id": item.get("owner_id"),
                    "timestamp": _as_utc_datetime(item.get("created_at")),
                    "summary": summary,
                    "data": item,
                }
            )

    if requested_source in (None, "subscription"):
        subscription_logs = (
            await db.subscription_events.find(
                query,
                {
                    "_id": 0,
                    "owner_id": 1,
                    "event_type": 1,
                    "status": 1,
                    "source": 1,
                    "created_at": 1,
                    "metadata": 1,
                },
            )
            .sort("created_at", -1)
            .limit(per_source_limit)
            .to_list(per_source_limit)
        )
        for item in subscription_logs:
            summary = (
                f"{item.get('event_type') or 'subscription_event'}"
                f" ({item.get('status') or 'unknown'})"
            )
            events.append(
                {
                    "source": "subscription",
                    "owner_id": item.get("owner_id"),
                    "timestamp": _as_utc_datetime(item.get("created_at")),
                    "summary": summary,
                    "data": item,
                }
            )

    events.sort(
        key=lambda item: item.get("timestamp") or datetime.min.replace(tzinfo=UTC),
        reverse=True,
    )
    sliced = events[:limit]
    return {
        "items": sliced,
        "count": len(sliced),
        "filters": {"owner_id": owner_id, "source": requested_source, "limit": limit},
    }
