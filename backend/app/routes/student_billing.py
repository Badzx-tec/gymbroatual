import secrets
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.deps import require_roles
from app.core.time import UTC
from app.db.mongo import get_db
from app.models.student_billing import (
    BillingOverviewOut,
    ChargeCleanupIn,
    ChargeCleanupOut,
    ChargeCreateIn,
    ChargeMarkPaidIn,
    ChargeOut,
    ContractCreateIn,
    ContractOut,
)

router = APIRouter()


def _clean_doc(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    sanitized = dict(doc)
    sanitized.pop("_id", None)
    return sanitized


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _coerce_datetime_utc(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            try:
                parsed_date = date.fromisoformat(value)
            except ValueError:
                return None
            parsed = datetime.combine(parsed_date, datetime.min.time())
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    return None


def _period_end(start: datetime, duration_days: int) -> datetime:
    return start + timedelta(days=max(1, int(duration_days)))


async def _record_event(
    owner_id: str, gym_id: str, contract_id: str, event_type: str, payload: dict
):
    db = get_db()
    await db.student_billing_events.insert_one(
        {
            "event_id": f"sbe_{secrets.token_hex(8)}",
            "owner_id": owner_id,
            "gym_id": gym_id,
            "contract_id": contract_id,
            "event_type": event_type,
            "payload": payload,
            "created_at": _utc_now(),
        }
    )


async def _sync_student_plan(
    *,
    owner_id: str,
    student_id: str,
    plan_id: str | None,
    period_end: datetime | None,
):
    db = get_db()
    now = _utc_now()
    updates = {
        "updated_at": now,
        "plan_expires_at": period_end,
        "subscription_end": period_end,
        "data_vencimento": period_end,
    }
    if plan_id:
        updates["plano_id"] = plan_id
    await db.students.update_one(
        {"owner_id": owner_id, "student_id": student_id},
        {"$set": updates},
    )


async def _refresh_contract_status(contract: dict, *, now: datetime | None = None) -> dict:
    db = get_db()
    current_now = now or _utc_now()
    current_status = str(contract.get("status") or "active")
    if current_status in {"canceled", "expired"}:
        return contract

    period_end = _coerce_datetime_utc(contract.get("current_period_end"))
    if period_end and period_end < current_now:
        current_status = "expired"
    else:
        overdue_charge = await db.student_charges.find_one(
            {
                "owner_id": contract["owner_id"],
                "contract_id": contract["contract_id"],
                "status": {"$in": ["open", "overdue"]},
                "due_at": {"$lt": current_now},
            },
            {"_id": 0},
        )
        if overdue_charge:
            current_status = "past_due"
        elif current_status == "past_due":
            current_status = "active"

    if current_status != contract.get("status"):
        await db.student_contracts.update_one(
            {"contract_id": contract["contract_id"], "owner_id": contract["owner_id"]},
            {"$set": {"status": current_status, "updated_at": current_now}},
        )
        contract["status"] = current_status
        contract["updated_at"] = current_now
    return contract


def _build_charge(
    *,
    owner_id: str,
    gym_id: str,
    student_id: str,
    contract_id: str,
    amount: float,
    due_at: datetime,
    notes: str | None,
    period_start: datetime | None,
    period_end: datetime | None,
    now: datetime,
) -> dict:
    return {
        "charge_id": f"chg_{secrets.token_hex(8)}",
        "contract_id": contract_id,
        "owner_id": owner_id,
        "gym_id": gym_id,
        "student_id": student_id,
        "amount": float(amount),
        "currency": "BRL",
        "due_at": due_at,
        "status": "overdue" if due_at < now else "open",
        "paid_at": None,
        "payment_method": None,
        "amount_received": None,
        "external_reference": None,
        "notes": notes,
        "period_start": period_start,
        "period_end": period_end,
        "created_at": now,
        "updated_at": now,
    }


@router.get("/overview", response_model=BillingOverviewOut)
async def overview(actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION"))):
    db = get_db()
    now = _utc_now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    next_7d = now + timedelta(days=7)
    owner_query = {"owner_id": actor["owner_id"]}

    total_contracts = await db.student_contracts.count_documents(owner_query)
    active_contracts = await db.student_contracts.count_documents(
        {**owner_query, "status": "active"}
    )
    past_due_contracts = await db.student_contracts.count_documents(
        {**owner_query, "status": "past_due"}
    )
    expiring_next_7d = await db.student_contracts.count_documents(
        {
            **owner_query,
            "status": "active",
            "current_period_end": {"$gte": now, "$lte": next_7d},
        }
    )
    overdue_charges = await db.student_charges.count_documents(
        {
            **owner_query,
            "$or": [
                {"status": "overdue"},
                {"status": "open", "due_at": {"$lt": now}},
            ],
        }
    )
    open_charges = await db.student_charges.count_documents({**owner_query, "status": "open"})
    paid_charges = await db.student_charges.find(
        {
            **owner_query,
            "status": "paid",
            "paid_at": {"$gte": month_start},
        },
        {"_id": 0, "amount": 1},
    ).to_list(2000)
    month_received_amount = sum(float(item.get("amount") or 0) for item in paid_charges)

    return BillingOverviewOut(
        total_contracts=total_contracts,
        active_contracts=active_contracts,
        past_due_contracts=past_due_contracts,
        expiring_next_7d=expiring_next_7d,
        overdue_charges=overdue_charges,
        open_charges=open_charges,
        month_received_amount=month_received_amount,
    )


@router.get("/contracts", response_model=list[ContractOut])
async def list_contracts(
    status: str = "",
    student_id: str = "",
    limit: int = Query(default=200, ge=1, le=500),
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    query = {"owner_id": actor["owner_id"]}
    if status:
        query["status"] = status
    if student_id:
        query["student_id"] = student_id

    contracts = (
        await db.student_contracts.find(query, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )
    current_now = _utc_now()
    refreshed: list[dict] = []
    for contract in contracts:
        refreshed.append(await _refresh_contract_status(contract, now=current_now))
    return refreshed


@router.post("/contracts")
async def create_contract(
    payload: ContractCreateIn,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    now = _utc_now()
    student = await db.students.find_one(
        {"owner_id": actor["owner_id"], "student_id": payload.student_id},
        {"_id": 0},
    )
    if not student:
        raise HTTPException(status_code=404, detail="Aluno nao encontrado")

    plan_doc = None
    if payload.plan_id:
        plan_doc = await db.plans.find_one(
            {"owner_id": actor["owner_id"], "plan_id": payload.plan_id},
            {"_id": 0},
        )
        if not plan_doc:
            raise HTTPException(status_code=404, detail="Plano nao encontrado")

    amount = payload.amount if payload.amount is not None else (plan_doc or {}).get("valor")
    if amount is None:
        raise HTTPException(
            status_code=400,
            detail="Informe amount ou use um plan_id com valor configurado",
        )
    start_at = _coerce_datetime_utc(payload.start_at) or now
    duration_from_plan = (plan_doc or {}).get("duracao_dias")
    duration_days = (
        int(payload.duration_days)
        if payload.duration_days is not None
        else (int(duration_from_plan) if duration_from_plan is not None else None)
    )
    auto_period_end = _period_end(start_at, duration_days) if duration_days else None
    manual_period_end = _coerce_datetime_utc(payload.end_at)
    period_end = manual_period_end or auto_period_end
    if not period_end:
        raise HTTPException(
            status_code=400,
            detail="Informe end_at manual ou use plano/duration_days com duracao definida",
        )
    if period_end <= start_at:
        raise HTTPException(status_code=400, detail="Vencimento deve ser maior que a data de inicio")

    contract_id = f"ctr_{secrets.token_hex(8)}"
    contract = {
        "contract_id": contract_id,
        "owner_id": actor["owner_id"],
        "gym_id": actor["gym_id"],
        "student_id": student["student_id"],
        "student_name": student.get("nome", "Aluno"),
        "plan_id": payload.plan_id,
        "plan_name": (plan_doc or {}).get("nome"),
        "amount": float(amount),
        "currency": "BRL",
        "duration_days": duration_days,
        "manual_end_override": bool(manual_period_end),
        "current_period_start": start_at,
        "current_period_end": period_end,
        "status": "active",
        "auto_renew": bool(payload.auto_renew),
        "notes": payload.notes,
        "canceled_at": None,
        "last_payment_at": None,
        "last_charge_id": None,
        "created_at": now,
        "updated_at": now,
    }
    await db.student_contracts.insert_one(contract)

    initial_charge = None
    if payload.create_initial_charge:
        initial_charge = _build_charge(
            owner_id=actor["owner_id"],
            gym_id=actor["gym_id"],
            student_id=student["student_id"],
            contract_id=contract_id,
            amount=float(amount),
            due_at=start_at,
            notes="Cobranca inicial do contrato",
            period_start=start_at,
            period_end=period_end,
            now=now,
        )
        await db.student_charges.insert_one(initial_charge)
        await db.student_contracts.update_one(
            {"contract_id": contract_id, "owner_id": actor["owner_id"]},
            {"$set": {"last_charge_id": initial_charge["charge_id"], "updated_at": now}},
        )
        contract["last_charge_id"] = initial_charge["charge_id"]

    await _sync_student_plan(
        owner_id=actor["owner_id"],
        student_id=student["student_id"],
        plan_id=payload.plan_id,
        period_end=period_end,
    )
    await _record_event(
        actor["owner_id"],
        actor["gym_id"],
        contract_id,
        "contract_created",
        {
            "student_id": student["student_id"],
            "plan_id": payload.plan_id,
            "duration_days": duration_days,
            "manual_end_override": bool(manual_period_end),
            "amount": float(amount),
            "initial_charge_id": initial_charge["charge_id"] if initial_charge else None,
        },
    )
    return {"contract": _clean_doc(contract), "initial_charge": _clean_doc(initial_charge)}


@router.post("/contracts/{contract_id}/charges", response_model=ChargeOut)
async def create_charge(
    contract_id: str,
    payload: ChargeCreateIn,
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    now = _utc_now()
    contract = await db.student_contracts.find_one(
        {"contract_id": contract_id, "owner_id": actor["owner_id"]},
        {"_id": 0},
    )
    if not contract:
        raise HTTPException(status_code=404, detail="Contrato nao encontrado")
    if contract.get("status") == "canceled":
        raise HTTPException(status_code=400, detail="Contrato cancelado")

    amount = payload.amount if payload.amount is not None else float(contract.get("amount") or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount invalido")
    due_at = _coerce_datetime_utc(payload.due_at) or now
    charge = _build_charge(
        owner_id=actor["owner_id"],
        gym_id=contract["gym_id"],
        student_id=contract["student_id"],
        contract_id=contract_id,
        amount=float(amount),
        due_at=due_at,
        notes=payload.notes,
        period_start=contract.get("current_period_start"),
        period_end=contract.get("current_period_end"),
        now=now,
    )
    await db.student_charges.insert_one(charge)
    new_status = "past_due" if charge["status"] == "overdue" else contract.get("status", "active")
    await db.student_contracts.update_one(
        {"contract_id": contract_id, "owner_id": actor["owner_id"]},
        {
            "$set": {
                "last_charge_id": charge["charge_id"],
                "status": new_status,
                "updated_at": now,
            }
        },
    )
    await _record_event(
        actor["owner_id"],
        contract["gym_id"],
        contract_id,
        "charge_created",
        {"charge_id": charge["charge_id"], "amount": float(amount), "due_at": due_at.isoformat()},
    )
    return _clean_doc(charge)


@router.get("/contracts/{contract_id}/charges", response_model=list[ChargeOut])
async def list_charges(
    contract_id: str,
    limit: int = Query(default=200, ge=1, le=500),
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    now = _utc_now()
    await db.student_charges.update_many(
        {
            "owner_id": actor["owner_id"],
            "contract_id": contract_id,
            "status": "open",
            "due_at": {"$lt": now},
        },
        {"$set": {"status": "overdue", "updated_at": now}},
    )

    return (
        await db.student_charges.find(
            {"owner_id": actor["owner_id"], "contract_id": contract_id},
            {"_id": 0},
        )
        .sort("due_at", -1)
        .limit(limit)
        .to_list(limit)
    )


@router.post("/contracts/{contract_id}/charges/cleanup", response_model=ChargeCleanupOut)
async def cleanup_contract_charges(
    contract_id: str,
    payload: ChargeCleanupIn | None = None,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    now = _utc_now()
    request_data = payload or ChargeCleanupIn()

    contract = await db.student_contracts.find_one(
        {"contract_id": contract_id, "owner_id": actor["owner_id"]},
        {"_id": 0},
    )
    if not contract:
        raise HTTPException(status_code=404, detail="Contrato nao encontrado")

    due_before = _coerce_datetime_utc(request_data.due_before)
    statuses = ["open", "overdue"] if request_data.status_filter == "pending" else ["overdue"]
    query: dict = {
        "owner_id": actor["owner_id"],
        "contract_id": contract_id,
        "status": {"$in": statuses},
    }
    if due_before:
        query["due_at"] = {"$lte": due_before}

    pending_charges = (
        await db.student_charges.find(query, {"_id": 0, "charge_id": 1}).limit(2000).to_list(2000)
    )
    charge_ids = [item["charge_id"] for item in pending_charges if item.get("charge_id")]
    cleaned_count = 0
    if charge_ids:
        update_payload = {
            "status": "canceled",
            "updated_at": now,
            "canceled_at": now,
        }
        reason = (request_data.reason or "").strip()
        if reason:
            update_payload["cleanup_reason"] = reason
        result = await db.student_charges.update_many(
            {**query, "charge_id": {"$in": charge_ids}},
            {"$set": update_payload},
        )
        cleaned_count = int(getattr(result, "modified_count", 0))

    updated_contract = await db.student_contracts.find_one(
        {"contract_id": contract_id, "owner_id": actor["owner_id"]},
        {"_id": 0},
    )
    if updated_contract:
        updated_contract = await _refresh_contract_status(updated_contract, now=now)
    contract_status = (updated_contract or contract).get("status", "active")

    await _record_event(
        actor["owner_id"],
        contract["gym_id"],
        contract_id,
        "charges_cleaned",
        {
            "status_filter": request_data.status_filter,
            "due_before": due_before.isoformat() if due_before else None,
            "cleaned_count": cleaned_count,
            "charge_ids": charge_ids[:100],
            "reason": request_data.reason,
        },
    )

    return ChargeCleanupOut(
        contract_id=contract_id,
        cleaned_count=cleaned_count,
        status_filter=request_data.status_filter,
        due_before=due_before,
        contract_status=contract_status,
        charge_ids=charge_ids,
    )


@router.post("/charges/{charge_id}/mark-paid", response_model=ChargeOut)
async def mark_charge_paid(
    charge_id: str,
    payload: ChargeMarkPaidIn,
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    now = _utc_now()
    charge = await db.student_charges.find_one(
        {"charge_id": charge_id, "owner_id": actor["owner_id"]},
        {"_id": 0},
    )
    if not charge:
        raise HTTPException(status_code=404, detail="Cobranca nao encontrada")

    if charge.get("status") == "paid":
        return charge

    paid_at = _coerce_datetime_utc(payload.paid_at) or now
    amount_received = (
        float(payload.amount_received)
        if payload.amount_received is not None
        else float(charge.get("amount") or 0)
    )
    await db.student_charges.update_one(
        {"charge_id": charge_id, "owner_id": actor["owner_id"]},
        {
            "$set": {
                "status": "paid",
                "paid_at": paid_at,
                "payment_method": payload.payment_method,
                "amount_received": amount_received,
                "external_reference": payload.external_reference,
                "updated_at": now,
            }
        },
    )

    contract = await db.student_contracts.find_one(
        {"contract_id": charge["contract_id"], "owner_id": actor["owner_id"]},
        {"_id": 0},
    )

    if contract and payload.extend_contract:
        duration_days = int(contract.get("duration_days") or 30)
        current_end = _coerce_datetime_utc(contract.get("current_period_end")) or paid_at
        next_start = current_end if current_end > paid_at else paid_at
        next_end = _period_end(next_start, duration_days)
        await db.student_contracts.update_one(
            {"contract_id": contract["contract_id"], "owner_id": actor["owner_id"]},
            {
                "$set": {
                    "status": "active",
                    "current_period_start": next_start,
                    "current_period_end": next_end,
                    "last_payment_at": paid_at,
                    "last_charge_id": charge_id,
                    "updated_at": now,
                }
            },
        )
        await _sync_student_plan(
            owner_id=actor["owner_id"],
            student_id=contract["student_id"],
            plan_id=contract.get("plan_id"),
            period_end=next_end,
        )

    await _record_event(
        actor["owner_id"],
        charge["gym_id"],
        charge["contract_id"],
        "charge_paid",
        {
            "charge_id": charge_id,
            "payment_method": payload.payment_method,
            "amount_received": amount_received,
            "extend_contract": payload.extend_contract,
        },
    )

    updated = await db.student_charges.find_one(
        {"charge_id": charge_id, "owner_id": actor["owner_id"]},
        {"_id": 0},
    )
    if not updated:
        raise HTTPException(status_code=500, detail="Falha ao atualizar cobranca")
    return updated


@router.post("/contracts/{contract_id}/cancel", response_model=ContractOut)
async def cancel_contract(
    contract_id: str,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    now = _utc_now()
    contract = await db.student_contracts.find_one(
        {"contract_id": contract_id, "owner_id": actor["owner_id"]},
        {"_id": 0},
    )
    if not contract:
        raise HTTPException(status_code=404, detail="Contrato nao encontrado")

    await db.student_contracts.update_one(
        {"contract_id": contract_id, "owner_id": actor["owner_id"]},
        {
            "$set": {
                "status": "canceled",
                "auto_renew": False,
                "canceled_at": now,
                "updated_at": now,
            }
        },
    )
    await _record_event(
        actor["owner_id"],
        contract["gym_id"],
        contract_id,
        "contract_canceled",
        {"student_id": contract["student_id"]},
    )
    updated = await db.student_contracts.find_one(
        {"contract_id": contract_id, "owner_id": actor["owner_id"]},
        {"_id": 0},
    )
    if not updated:
        raise HTTPException(status_code=500, detail="Falha ao cancelar contrato")
    return updated


@router.get("/events")
async def list_events(
    limit: int = Query(default=100, ge=1, le=500),
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    return (
        await db.student_billing_events.find({"owner_id": actor["owner_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )
