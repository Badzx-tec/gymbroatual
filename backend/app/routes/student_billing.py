import logging
import re
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.deps import require_roles
from app.db.mongo import get_db
from app.models.student_billing import (
    BillingOverviewOut,
    ChargeCleanupIn,
    ChargeCleanupOut,
    ChargeCreateIn,
    ChargeMarkPaidIn,
    ChargeMarkUnpaidIn,
    ChargeOut,
    ContractAdjustBillingIn,
    ContractAdjustValidityIn,
    ContractCancelIn,
    ContractChangePlanIn,
    ContractCreateIn,
    ContractFreezeIn,
    ContractOut,
    ContractRenewIn,
    ContractResumeIn,
    ContractUpdateIn,
    ReconcileRunOut,
)
from app.services.observability import log_event
from app.services.student_contracts import (
    ACTIVE_LIKE_CONTRACT_STATUSES,
    MANAGEABLE_CONTRACT_STATUSES,
    TERMINAL_CONTRACT_STATUSES,
    append_manual_override,
    billing_cycle_from_duration_fields,
    clean_doc,
    coerce_datetime_utc,
    derive_student_operational_status,
    duration_days_compatibility,
    ensure_transition,
    infer_access_status,
    legacy_status,
    period_end,
    refresh_contract_state,
    resolve_authoritative_contract_for_student,
    resolve_contract_amounts,
    resolve_duration_fields,
    sync_contract_amount_fields,
    utc_now,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _safe_float(value, *, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _contract_amount_snapshot(contract: dict) -> tuple[float, float, float]:
    normalized = sync_contract_amount_fields(contract)
    return (
        _safe_float(normalized.get("original_amount")),
        _safe_float(normalized.get("discount_amount")),
        _safe_float(normalized.get("amount")),
    )


def _resolve_contract_amount_inputs(
    *,
    base_amount,
    discount_amount=0.0,
) -> tuple[float, float, float]:
    try:
        return resolve_contract_amounts(
            base_amount=base_amount,
            discount_amount=discount_amount,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _duration_values_from_doc(doc: dict | None) -> tuple[str | None, int | None, int | None]:
    if not isinstance(doc, dict):
        return None, None, None
    return (
        doc.get("duration_unit"),
        doc.get("duration_value"),
        doc.get("duracao_dias") if "duracao_dias" in doc else doc.get("duration_days"),
    )


def _resolve_duration_selection(
    *,
    payload_unit=None,
    payload_value=None,
    payload_days=None,
    sources: list[dict | None] | None = None,
    default_days: int = 30,
) -> tuple[str, int]:
    candidate_unit = payload_unit
    candidate_value = payload_value
    candidate_days = payload_days

    if candidate_value is not None or candidate_days is not None or candidate_unit is not None:
        return resolve_duration_fields(
            duration_unit=candidate_unit,
            duration_value=candidate_value,
            duration_days=candidate_days,
            default_days=default_days,
        )

    for source in sources or []:
        source_unit, source_value, source_days = _duration_values_from_doc(source)
        if source_value is None and source_days is None and source_unit is None:
            continue
        return resolve_duration_fields(
            duration_unit=source_unit,
            duration_value=source_value,
            duration_days=source_days,
            default_days=default_days,
        )

    return resolve_duration_fields(default_days=default_days)


def _resolve_duration_days_compatibility(
    *,
    start_at: datetime,
    duration_unit: str,
    duration_value: int,
) -> int:
    return duration_days_compatibility(
        start=start_at,
        duration_unit=duration_unit,
        duration_value=duration_value,
    )


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
    period_end_at: datetime | None,
    now: datetime,
    status: str | None = None,
) -> dict:
    normalized_status = str(status or "").strip().lower()
    if normalized_status not in {
        "open",
        "paid",
        "overdue",
        "canceled",
        "failed",
        "refunded",
        "partially_paid",
    }:
        normalized_status = "overdue" if due_at < now else "open"
    return {
        "charge_id": f"chg_{secrets.token_hex(8)}",
        "contract_id": contract_id,
        "owner_id": owner_id,
        "gym_id": gym_id,
        "student_id": student_id,
        "amount": float(amount),
        "currency": "BRL",
        "due_at": due_at,
        "status": normalized_status,
        "paid_at": None,
        "payment_method": None,
        "amount_received": None,
        "external_reference": None,
        "retry_count": 0,
        "last_retry_at": None,
        "failure_reason": None,
        "notes": notes,
        "period_start": period_start,
        "period_end": period_end_at,
        "created_at": now,
        "updated_at": now,
    }


async def _record_event(
    *,
    owner_id: str,
    gym_id: str,
    contract_id: str,
    event_type: str,
    payload: dict,
    actor: dict | None = None,
) -> None:
    db = get_db()
    await db.student_billing_events.insert_one(
        {
            "event_id": f"sbe_{secrets.token_hex(8)}",
            "owner_id": owner_id,
            "gym_id": gym_id,
            "contract_id": contract_id,
            "event_type": event_type,
            "payload": payload,
            "actor_type": actor.get("actor_type") if actor else "system",
            "actor_role": actor.get("role") if actor else "SYSTEM",
            "actor_id": (actor or {}).get("owner_id")
            or (actor or {}).get("employee_id")
            or (actor or {}).get("student_id"),
            "created_at": utc_now(),
        }
    )


async def _sync_student_contract_projection(contract: dict) -> None:
    db = get_db()
    now = utc_now()
    student = await db.students.find_one(
        {"owner_id": contract["owner_id"], "student_id": contract["student_id"]},
        {"_id": 0, "status": 1, "auto_status_source": 1, "_proj_version": 1},
    )
    if not student:
        return

    authoritative_contract = await resolve_authoritative_contract_for_student(
        db,
        owner_id=contract["owner_id"],
        student_id=contract["student_id"],
        now=now,
    )
    if authoritative_contract:
        contract = authoritative_contract

    desired_status, desired_auto_source = derive_student_operational_status(
        current_status=student.get("status"),
        current_auto_source=student.get("auto_status_source"),
        contract_access_status=contract.get("access_status"),
        contract_financial_status=contract.get("financial_status"),
    )

    updates = {
        "updated_at": now,
        "plan_expires_at": coerce_datetime_utc(contract.get("current_period_end")),
        "subscription_end": coerce_datetime_utc(contract.get("current_period_end")),
        "data_vencimento": coerce_datetime_utc(contract.get("current_period_end")),
        "contract_status": contract.get("contract_status"),
        "contract_financial_status": contract.get("financial_status"),
        "contract_access_status": contract.get("access_status"),
        "contract_grace_until": coerce_datetime_utc(contract.get("grace_until")),
        "contract_next_retry_at": coerce_datetime_utc(contract.get("next_retry_at")),
        "contract_dunning_level": int(contract.get("dunning_level") or 0),
    }
    current_status = str(student.get("status") or "ativo").strip().lower()
    if current_status != desired_status:
        updates["status"] = desired_status
    current_auto_source = str(student.get("auto_status_source") or "").strip().lower() or None
    if current_auto_source != desired_auto_source:
        updates["auto_status_source"] = desired_auto_source

    if contract.get("plan_id"):
        updates["plano_id"] = contract.get("plan_id")

    # Optimistic concurrency: only write if _proj_version hasn't changed since we
    # read the student. This prevents two concurrent syncs from trampling each other.
    current_version = int(student.get("_proj_version") or 0)
    result = await db.students.update_one(
        {
            "owner_id": contract["owner_id"],
            "student_id": contract["student_id"],
            "_proj_version": {"$in": [current_version, None]},
        },
        {"$set": updates, "$inc": {"_proj_version": 1}},
    )
    if result.matched_count == 0:
        logging.getLogger("gymbro.student_billing").warning(
            "sync_student_projection skipped: version conflict for student_id=%s",
            contract.get("student_id"),
        )


async def _load_contract_for_owner(
    contract_id: str,
    actor: dict,
    *,
    refresh: bool = True,
) -> dict:
    db = get_db()
    contract = await db.student_contracts.find_one(
        {"owner_id": actor["owner_id"], "contract_id": contract_id},
        {"_id": 0},
    )
    if not contract:
        raise HTTPException(status_code=404, detail="Contrato nao encontrado")
    if refresh:
        contract, events, changed = await refresh_contract_state(db, contract)
        if changed:
            for auto_event in events:
                await _record_event(
                    owner_id=contract["owner_id"],
                    gym_id=contract["gym_id"],
                    contract_id=contract["contract_id"],
                    event_type=auto_event["event_type"],
                    payload=auto_event.get("payload") or {},
                    actor={"actor_type": "system", "role": "SYSTEM"},
                )
            await _sync_student_contract_projection(contract)
    return contract


async def _upsert_contract(contract: dict) -> dict:
    db = get_db()
    contract["updated_at"] = utc_now()
    await db.student_contracts.update_one(
        {"owner_id": contract["owner_id"], "contract_id": contract["contract_id"]},
        {"$set": contract},
    )
    return contract


async def _create_charge_and_link(
    *,
    contract: dict,
    amount: float,
    due_at: datetime,
    notes: str | None,
    now: datetime,
    status: str | None = None,
) -> dict:
    db = get_db()
    charge = _build_charge(
        owner_id=contract["owner_id"],
        gym_id=contract["gym_id"],
        student_id=contract["student_id"],
        contract_id=contract["contract_id"],
        amount=amount,
        due_at=due_at,
        notes=notes,
        period_start=coerce_datetime_utc(contract.get("current_period_start")),
        period_end_at=coerce_datetime_utc(contract.get("current_period_end")),
        now=now,
        status=status,
    )
    await db.student_charges.insert_one(charge)
    contract["last_charge_id"] = charge["charge_id"]
    await _upsert_contract(contract)
    return charge


async def _update_open_charge_amounts_for_contract(
    *,
    contract: dict,
    actor: dict,
    now: datetime,
    reason: str,
) -> tuple[int, list[str]]:
    db = get_db()
    mutable_statuses = ["open", "overdue", "failed", "partially_paid"]
    target_amount = _safe_float(contract.get("amount"))
    updated_count = 0
    charge_ids: list[str] = []
    mutable_charges = (
        await db.student_charges.find(
            {
                "owner_id": contract["owner_id"],
                "contract_id": contract["contract_id"],
                "status": {"$in": mutable_statuses},
            },
            {"_id": 0, "charge_id": 1, "amount": 1},
        )
        .limit(5000)
        .to_list(5000)
    )

    for item in mutable_charges:
        charge_id = str(item.get("charge_id") or "").strip()
        if not charge_id:
            continue
        current_amount = _safe_float(item.get("amount"))
        if current_amount == target_amount:
            continue
        result = await db.student_charges.update_one(
            {
                "owner_id": contract["owner_id"],
                "charge_id": charge_id,
                "status": {"$in": mutable_statuses},
            },
            {
                "$set": {
                    "amount": target_amount,
                    "updated_at": now,
                    "discount_sync_reason": reason,
                }
            },
        )
        if int(getattr(result, "modified_count", 0) or 0) > 0:
            updated_count += 1
            charge_ids.append(charge_id)

    if updated_count > 0:
        await _record_event(
            owner_id=contract["owner_id"],
            gym_id=contract["gym_id"],
            contract_id=contract["contract_id"],
            event_type="contract_charge_amounts_synced",
            payload={
                "reason": reason,
                "updated_count": updated_count,
                "charge_ids": charge_ids[:100],
                "amount": target_amount,
            },
            actor=actor,
        )

    return updated_count, charge_ids


async def _update_financial_due_dates_for_contract(
    *,
    contract: dict,
    due_at: datetime | None,
    now: datetime,
    reason: str,
) -> tuple[int, list[str]]:
    db = get_db()
    if due_at is None:
        return 0, []

    mutable_statuses = ["open", "overdue", "failed", "partially_paid"]
    updated_count = 0
    charge_ids: list[str] = []
    mutable_charges = (
        await db.student_charges.find(
            {
                "owner_id": contract["owner_id"],
                "contract_id": contract["contract_id"],
                "status": {"$in": mutable_statuses},
            },
            {"_id": 0, "charge_id": 1, "due_at": 1},
        )
        .sort("due_at", 1)
        .limit(5000)
        .to_list(5000)
    )

    for item in mutable_charges:
        charge_id = str(item.get("charge_id") or "").strip()
        if not charge_id:
            continue
        current_due_at = coerce_datetime_utc(item.get("due_at"))
        if current_due_at == due_at:
            continue
        current_status = "overdue" if due_at < now else "open"
        result = await db.student_charges.update_one(
            {
                "owner_id": contract["owner_id"],
                "charge_id": charge_id,
                "status": {"$in": mutable_statuses},
            },
            {
                "$set": {
                    "due_at": due_at,
                    "status": current_status,
                    "updated_at": now,
                    "billing_sync_reason": reason,
                }
            },
        )
        if int(getattr(result, "modified_count", 0) or 0) > 0:
            updated_count += 1
            charge_ids.append(charge_id)

    if updated_count > 0:
        await _record_event(
            owner_id=contract["owner_id"],
            gym_id=contract["gym_id"],
            contract_id=contract["contract_id"],
            event_type="contract_charge_due_dates_synced",
            payload={
                "reason": reason,
                "due_at": due_at.isoformat(),
                "updated_count": updated_count,
                "charge_ids": charge_ids,
            },
        )
    return updated_count, charge_ids


def _matches_status_filters(
    contract: dict,
    *,
    status: str,
    contract_status: str,
    financial_status: str,
    access_status: str,
    plan_id: str,
    q: str,
) -> bool:
    if status:
        normalized_legacy = str(status).strip().lower()
        if str(contract.get("status") or "").lower() != normalized_legacy:
            return False
    if contract_status:
        if str(contract.get("contract_status") or "").lower() != str(contract_status).lower():
            return False
    if financial_status:
        if str(contract.get("financial_status") or "").lower() != str(financial_status).lower():
            return False
    if access_status:
        if str(contract.get("access_status") or "").lower() != str(access_status).lower():
            return False
    if plan_id:
        if str(contract.get("plan_id") or "") != str(plan_id):
            return False
    if q:
        term = q.strip().lower()
        if term:
            values = [
                contract.get("contract_id"),
                contract.get("student_name"),
                contract.get("student_id"),
                contract.get("plan_name"),
                contract.get("plan_id"),
            ]
            searchable = " ".join(str(item or "") for item in values).lower()
            if term not in searchable:
                return False
    return True


def _sanitize_contract_for_role(contract: dict, *, role: str) -> dict:
    safe = clean_doc(contract) or {}
    if role not in {"OWNER", "MANAGER"}:
        safe.pop("internal_notes", None)
        safe.pop("manual_overrides", None)
    return safe


def _sanitize_event_for_role(event: dict, *, role: str) -> dict:
    safe = clean_doc(event) or {}
    if role not in {"OWNER", "MANAGER"}:
        safe.pop("actor_id", None)
    return safe


# Endpoints are defined below.


@router.get("/overview", response_model=BillingOverviewOut)
async def overview(actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION"))):
    db = get_db()
    now = utc_now()
    next_7d = now + timedelta(days=7)
    owner_id = actor["owner_id"]
    total_contracts = await db.student_contracts.count_documents({"owner_id": owner_id})
    active_contracts = await db.student_contracts.count_documents(
        {"owner_id": owner_id, "contract_status": {"$in": sorted(ACTIVE_LIKE_CONTRACT_STATUSES)}}
    )
    frozen_contracts = await db.student_contracts.count_documents(
        {"owner_id": owner_id, "contract_status": "frozen"}
    )
    past_due_contracts = await db.student_contracts.count_documents(
        {"owner_id": owner_id, "financial_status": {"$in": ["overdue", "failed"]}}
    )
    expiring_next_7d = await db.student_contracts.count_documents(
        {
            "owner_id": owner_id,
            "contract_status": {"$in": sorted(ACTIVE_LIKE_CONTRACT_STATUSES)},
            "current_period_end": {"$gte": now, "$lte": next_7d},
        }
    )
    scheduled_docs = await db.student_contracts.find(
        {"owner_id": owner_id, "scheduled_actions.status": "pending"},
        {"_id": 0, "scheduled_actions": 1},
    ).to_list(1000)
    scheduled_actions = sum(
        len(
            [
                action
                for action in item.get("scheduled_actions", [])
                if str(action.get("status") or "").lower() == "pending"
            ]
        )
        for item in scheduled_docs
    )

    overdue_charges = await db.student_charges.count_documents(
        {
            "owner_id": owner_id,
            "$or": [
                {"status": "overdue"},
                {"status": "failed"},
                {"status": "open", "due_at": {"$lt": now}},
                {"status": "partially_paid", "due_at": {"$lt": now}},
            ],
        }
    )
    open_charges = await db.student_charges.count_documents(
        {"owner_id": owner_id, "status": {"$in": ["open", "partially_paid"]}}
    )
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    paid_charges = await db.student_charges.find(
        {"owner_id": owner_id, "status": "paid", "paid_at": {"$gte": month_start}},
        {"_id": 0, "amount": 1, "amount_received": 1},
    ).to_list(5000)
    month_received_amount = sum(
        _safe_float(item.get("amount_received"), default=_safe_float(item.get("amount")))
        for item in paid_charges
    )

    return BillingOverviewOut(
        total_contracts=total_contracts,
        active_contracts=active_contracts,
        frozen_contracts=frozen_contracts,
        scheduled_actions=scheduled_actions,
        past_due_contracts=past_due_contracts,
        expiring_next_7d=expiring_next_7d,
        overdue_charges=overdue_charges,
        open_charges=open_charges,
        month_received_amount=month_received_amount,
    )


@router.get("/contracts", response_model=list[ContractOut])
async def list_contracts(
    status: str = "",
    contract_status: str = "",
    financial_status: str = "",
    access_status: str = "",
    student_id: str = "",
    plan_id: str = "",
    q: str = "",
    limit: int = Query(default=200, ge=1, le=800),
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    query: dict = {"owner_id": actor["owner_id"]}
    if student_id:
        query["student_id"] = student_id
    if status:
        query["status"] = str(status).strip().lower()
    if contract_status:
        query["contract_status"] = str(contract_status).strip().lower()
    if financial_status:
        query["financial_status"] = str(financial_status).strip().lower()
    if access_status:
        query["access_status"] = str(access_status).strip().lower()
    if plan_id:
        query["plan_id"] = plan_id
    if q.strip():
        term = re.escape(q.strip())
        query["$or"] = [
            {"contract_id": {"$regex": term, "$options": "i"}},
            {"student_name": {"$regex": term, "$options": "i"}},
            {"student_id": {"$regex": term, "$options": "i"}},
            {"plan_name": {"$regex": term, "$options": "i"}},
            {"plan_id": {"$regex": term, "$options": "i"}},
        ]

    docs = (
        await db.student_contracts.find(query, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )
    output: list[dict] = []
    for item in docs:
        refreshed, events, changed = await refresh_contract_state(db, item)
        if changed:
            for auto_event in events:
                await _record_event(
                    owner_id=refreshed["owner_id"],
                    gym_id=refreshed["gym_id"],
                    contract_id=refreshed["contract_id"],
                    event_type=auto_event["event_type"],
                    payload=auto_event.get("payload") or {},
                    actor={"actor_type": "system", "role": "SYSTEM"},
                )
            await _sync_student_contract_projection(refreshed)
        if _matches_status_filters(
            refreshed,
            status=status,
            contract_status=contract_status,
            financial_status=financial_status,
            access_status=access_status,
            plan_id=plan_id,
            q=q,
        ):
            output.append(refreshed)
        if len(output) >= limit:
            break
    return output


@router.get("/contracts/{contract_id}")
async def get_contract_detail(
    contract_id: str,
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    role = str(actor.get("role") or "").upper()
    contract = await _load_contract_for_owner(contract_id, actor)
    charges = (
        await db.student_charges.find(
            {"owner_id": actor["owner_id"], "contract_id": contract_id},
            {"_id": 0},
        )
        .sort("due_at", -1)
        .limit(300)
        .to_list(300)
    )
    events = (
        await db.student_billing_events.find(
            {"owner_id": actor["owner_id"], "contract_id": contract_id},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(200)
        .to_list(200)
    )
    return {
        "contract": _sanitize_contract_for_role(contract, role=role),
        "charges": charges,
        "events": [_sanitize_event_for_role(item, role=role) for item in events],
    }


@router.post("/contracts")
async def create_contract(
    payload: ContractCreateIn,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    now = utc_now()
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

    active_contracts_raw = (
        await db.student_contracts.find(
            {"owner_id": actor["owner_id"], "student_id": payload.student_id},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(20)
        .to_list(20)
    )
    existing_active = None
    for item in active_contracts_raw:
        refreshed, _, _ = await refresh_contract_state(db, item)
        if str(refreshed.get("contract_status") or "").lower() in MANAGEABLE_CONTRACT_STATUSES:
            existing_active = refreshed
            break
    if existing_active and not payload.replace_active_contract:
        raise HTTPException(
            status_code=409,
            detail="Aluno ja possui contrato ativo. Use replace_active_contract para substituir.",
        )
    if existing_active and payload.replace_active_contract:
        existing_active["contract_status"] = "ended"
        existing_active["ended_at"] = now
        existing_active["auto_renew"] = False
        existing_active["cancel_reason"] = "replaced_by_new_contract"
        existing_active["status"] = legacy_status("ended", existing_active.get("financial_status", "pending"))
        await _upsert_contract(existing_active)
        await _record_event(
            owner_id=existing_active["owner_id"],
            gym_id=existing_active["gym_id"],
            contract_id=existing_active["contract_id"],
            event_type="contract_ended_replaced",
            payload={"replaced_at": now.isoformat()},
            actor=actor,
        )

    base_amount = payload.amount if payload.amount is not None else (plan_doc or {}).get("valor")
    if base_amount is None:
        raise HTTPException(status_code=400, detail="Informe amount ou selecione plano com valor")
    original_amount, discount_amount, amount = _resolve_contract_amount_inputs(
        base_amount=base_amount,
        discount_amount=payload.discount_amount,
    )

    start_at = coerce_datetime_utc(payload.start_at) or now
    duration_unit, duration_value = _resolve_duration_selection(
        payload_unit=payload.duration_unit,
        payload_value=payload.duration_value,
        payload_days=payload.duration_days,
        sources=[plan_doc],
        default_days=30,
    )
    duration_days = _resolve_duration_days_compatibility(
        start_at=start_at,
        duration_unit=duration_unit,
        duration_value=duration_value,
    )
    auto_end = period_end(
        start_at,
        duration_unit=duration_unit,
        duration_value=duration_value,
    )
    manual_end = coerce_datetime_utc(payload.end_at)
    current_period_end = manual_end or auto_end
    if current_period_end <= start_at:
        raise HTTPException(status_code=400, detail="Vencimento deve ser maior que inicio")

    contract_status = "pending_activation" if start_at > now else "active"
    financial_status = "pending" if payload.create_initial_charge else "paid"
    access_status = infer_access_status(contract_status, financial_status, now=now)
    legacy = legacy_status(contract_status, financial_status)

    contract = {
        "contract_id": f"ctr_{secrets.token_hex(8)}",
        "owner_id": actor["owner_id"],
        "gym_id": actor["gym_id"],
        "student_id": student["student_id"],
        "student_name": student.get("nome", "Aluno"),
        "plan_id": payload.plan_id,
        "plan_name": (plan_doc or {}).get("nome"),
        "amount": amount,
        "original_amount": original_amount,
        "discount_amount": discount_amount,
        "currency": "BRL",
        "duration_unit": duration_unit,
        "duration_value": duration_value,
        "duration_days": duration_days,
        "billing_cycle": (
            payload.billing_cycle
            if payload.billing_cycle != "custom_days"
            else billing_cycle_from_duration_fields(
                duration_unit=duration_unit,
                duration_value=duration_value,
            )
        ),
        "billing_day": payload.billing_day or min(max(start_at.day, 1), 28),
        "manual_end_override": bool(manual_end),
        "current_period_start": start_at,
        "current_period_end": current_period_end,
        "next_billing_at": start_at,
        "contract_status": contract_status,
        "financial_status": financial_status,
        "access_status": access_status,
        "status": legacy,
        "auto_renew": bool(payload.auto_renew),
        "payment_method": payload.payment_method,
        "notes": payload.notes,
        "internal_notes": payload.internal_notes,
        "cancel_reason": None,
        "freeze_reason": None,
        "frozen_from": None,
        "frozen_until": None,
        "extend_end_by_frozen_days": True,
        "grace_until": None,
        "dunning_level": 0,
        "next_retry_at": None,
        "canceled_at": None,
        "ended_at": None,
        "last_payment_at": None,
        "last_charge_id": None,
        "migrated_from_contract_id": None,
        "manual_overrides": [],
        "scheduled_actions": [],
        "freeze_periods": [],
        "terms_version": payload.terms_version,
        "terms_accepted_at": now if payload.terms_accepted else None,
        "schema_version": 2,
        "created_at": now,
        "updated_at": now,
    }
    if manual_end:
        append_manual_override(
            contract,
            field="current_period_end",
            before=auto_end,
            after=manual_end,
            reason="manual_end_override_create",
            actor=actor,
            now=now,
        )
    if plan_doc and payload.amount is not None and float(plan_doc.get("valor") or 0) != original_amount:
        append_manual_override(
            contract,
            field="original_amount",
            before=float(plan_doc.get("valor") or 0),
            after=original_amount,
            reason="manual_amount_override_create",
            actor=actor,
            now=now,
        )
    if discount_amount > 0:
        append_manual_override(
            contract,
            field="discount_amount",
            before=0.0,
            after=discount_amount,
            reason="manual_discount_override_create",
            actor=actor,
            now=now,
        )
    await db.student_contracts.insert_one(contract)

    initial_charge = None
    if payload.create_initial_charge:
        initial_charge = await _create_charge_and_link(
            contract=contract,
            amount=amount,
            due_at=start_at,
            notes="Cobranca inicial do contrato",
            now=now,
        )

    contract, events, changed = await refresh_contract_state(db, contract)
    if changed:
        for auto_event in events:
            await _record_event(
                owner_id=contract["owner_id"],
                gym_id=contract["gym_id"],
                contract_id=contract["contract_id"],
                event_type=auto_event["event_type"],
                payload=auto_event.get("payload") or {},
                actor={"actor_type": "system", "role": "SYSTEM"},
            )
    await _sync_student_contract_projection(contract)
    await _record_event(
        owner_id=contract["owner_id"],
        gym_id=contract["gym_id"],
        contract_id=contract["contract_id"],
        event_type="contract_created",
        payload={
            "student_id": contract["student_id"],
            "plan_id": contract.get("plan_id"),
            "amount": contract.get("amount"),
            "original_amount": contract.get("original_amount"),
            "discount_amount": contract.get("discount_amount"),
            "duration_unit": contract.get("duration_unit"),
            "duration_value": contract.get("duration_value"),
            "duration_days": contract.get("duration_days"),
            "manual_end_override": bool(manual_end),
            "initial_charge_id": (initial_charge or {}).get("charge_id"),
        },
        actor=actor,
    )
    log_event(
        "contract.created",
        contract_id=contract["contract_id"],
        student_id=contract["student_id"],
        owner_id=contract["owner_id"],
        plan_id=contract.get("plan_id"),
        amount=contract.get("amount"),
        contract_status=contract.get("contract_status"),
        actor_id=actor.get("user_id") or actor.get("sub"),
        actor_role=actor.get("role"),
    )
    return {"contract": clean_doc(contract), "initial_charge": clean_doc(initial_charge)}


@router.put("/contracts/{contract_id}", response_model=ContractOut)
async def update_contract(
    contract_id: str,
    payload: ContractUpdateIn,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    now = utc_now()
    contract = await _load_contract_for_owner(contract_id, actor)
    try:
        ensure_transition(
            contract,
            allowed_from={"active", "pending_activation", "frozen", "scheduled_cancel", "scheduled_freeze"},
            action="editar contrato",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    data = payload.model_dump(exclude_none=True)
    reason = data.get("manual_override_reason")
    current_original_amount, current_discount_amount, current_amount = _contract_amount_snapshot(contract)
    pending_original_amount = current_original_amount
    pending_discount_amount = current_discount_amount
    amount_fields_changed = False

    if "amount" in data:
        pending_original_amount = float(data["amount"])
        amount_fields_changed = True
        append_manual_override(
            contract,
            field="original_amount",
            before=current_original_amount,
            after=pending_original_amount,
            reason=reason or "manual_amount_override",
            actor=actor,
            now=now,
        )
    if "discount_amount" in data:
        pending_discount_amount = float(data["discount_amount"])
        amount_fields_changed = True
        append_manual_override(
            contract,
            field="discount_amount",
            before=current_discount_amount,
            after=pending_discount_amount,
            reason=reason or "manual_discount_override",
            actor=actor,
            now=now,
        )
    if amount_fields_changed:
        (
            contract["original_amount"],
            contract["discount_amount"],
            contract["amount"],
        ) = _resolve_contract_amount_inputs(
            base_amount=pending_original_amount,
            discount_amount=pending_discount_amount,
        )
    if "end_at" in data:
        end_at = coerce_datetime_utc(data["end_at"])
        start_at = coerce_datetime_utc(contract.get("current_period_start")) or now
        if not end_at or end_at <= start_at:
            raise HTTPException(status_code=400, detail="Vencimento invalido")
        before = coerce_datetime_utc(contract.get("current_period_end"))
        contract["current_period_end"] = end_at
        contract["manual_end_override"] = True
        append_manual_override(
            contract,
            field="current_period_end",
            before=before,
            after=end_at,
            reason=reason or "manual_end_override",
            actor=actor,
            now=now,
        )
    if "auto_renew" in data:
        before = bool(contract.get("auto_renew"))
        after = bool(data["auto_renew"])
        contract["auto_renew"] = after
        append_manual_override(
            contract,
            field="auto_renew",
            before=before,
            after=after,
            reason=reason or "manual_auto_renew_override",
            actor=actor,
            now=now,
        )
    if "billing_day" in data:
        before = contract.get("billing_day")
        after = int(data["billing_day"])
        contract["billing_day"] = after
        append_manual_override(
            contract,
            field="billing_day",
            before=before,
            after=after,
            reason=reason or "manual_billing_day_override",
            actor=actor,
            now=now,
        )
    if "payment_method" in data:
        contract["payment_method"] = data["payment_method"]
    if "notes" in data:
        contract["notes"] = data["notes"]
    if "internal_notes" in data:
        contract["internal_notes"] = data["internal_notes"]

    contract = await _upsert_contract(contract)
    if amount_fields_changed:
        await _update_open_charge_amounts_for_contract(
            contract=contract,
            actor=actor,
            now=now,
            reason=reason or "contract_amount_update",
        )
    contract, events, changed = await refresh_contract_state(get_db(), contract)
    if changed:
        for auto_event in events:
            await _record_event(
                owner_id=contract["owner_id"],
                gym_id=contract["gym_id"],
                contract_id=contract["contract_id"],
                event_type=auto_event["event_type"],
                payload=auto_event.get("payload") or {},
                actor={"actor_type": "system", "role": "SYSTEM"},
            )
    await _sync_student_contract_projection(contract)
    await _record_event(
        owner_id=contract["owner_id"],
        gym_id=contract["gym_id"],
        contract_id=contract["contract_id"],
        event_type="contract_overridden",
        payload={
            "reason": reason,
            "fields": sorted(set(data.keys()) - {"manual_override_reason"}),
            "amount_before": current_amount,
            "amount_after": contract.get("amount"),
            "original_amount": contract.get("original_amount"),
            "discount_amount": contract.get("discount_amount"),
        },
        actor=actor,
    )
    return contract


@router.post("/contracts/{contract_id}/adjust-validity")
async def adjust_contract_validity(
    contract_id: str,
    payload: ContractAdjustValidityIn,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    now = utc_now()
    contract = await _load_contract_for_owner(contract_id, actor)
    try:
        ensure_transition(
            contract,
            allowed_from=MANAGEABLE_CONTRACT_STATUSES | {"expired"},
            action="ajustar validade do contrato",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    end_at = coerce_datetime_utc(payload.end_at)
    start_at = coerce_datetime_utc(contract.get("current_period_start")) or now
    if not end_at or end_at <= start_at:
        raise HTTPException(status_code=400, detail="Validade do contrato invalida")

    before_end = coerce_datetime_utc(contract.get("current_period_end"))
    before_status = str(contract.get("contract_status") or "").lower()
    contract["current_period_end"] = end_at
    contract["manual_end_override"] = True
    reactivated = False
    if before_status == "expired" and end_at > now:
        contract["contract_status"] = "pending_activation" if start_at > now else "active"
        contract["ended_at"] = None
        reactivated = True

    append_manual_override(
        contract,
        field="current_period_end",
        before=before_end,
        after=end_at,
        reason=payload.reason or "manual_contract_validity_adjustment",
        actor=actor,
        now=now,
    )

    contract = await _upsert_contract(contract)
    contract, events, changed = await refresh_contract_state(db, contract)
    if changed:
        for auto_event in events:
            await _record_event(
                owner_id=contract["owner_id"],
                gym_id=contract["gym_id"],
                contract_id=contract["contract_id"],
                event_type=auto_event["event_type"],
                payload=auto_event.get("payload") or {},
                actor={"actor_type": "system", "role": "SYSTEM"},
            )
    await _sync_student_contract_projection(contract)
    await _record_event(
        owner_id=contract["owner_id"],
        gym_id=contract["gym_id"],
        contract_id=contract["contract_id"],
        event_type="contract_validity_adjusted",
        payload={
            "reason": payload.reason,
            "previous_end_at": before_end.isoformat() if before_end else None,
            "current_period_end": end_at.isoformat(),
            "previous_contract_status": before_status or None,
            "contract_status": contract.get("contract_status"),
            "reactivated": reactivated,
        },
        actor=actor,
    )
    return {"contract": clean_doc(contract)}


@router.post("/contracts/{contract_id}/adjust-billing")
async def adjust_contract_billing(
    contract_id: str,
    payload: ContractAdjustBillingIn,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    now = utc_now()
    contract = await _load_contract_for_owner(contract_id, actor)
    try:
        ensure_transition(
            contract,
            allowed_from=MANAGEABLE_CONTRACT_STATUSES | {"expired"},
            action="ajustar cobranca do contrato",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    due_at = coerce_datetime_utc(payload.due_at)
    billing_day_before = contract.get("billing_day")
    updated_fields: list[str] = []
    if payload.billing_day is not None:
        contract["billing_day"] = int(payload.billing_day)
        append_manual_override(
            contract,
            field="billing_day",
            before=billing_day_before,
            after=contract["billing_day"],
            reason=payload.reason or "manual_contract_billing_adjustment",
            actor=actor,
            now=now,
        )
        updated_fields.append("billing_day")

    contract = await _upsert_contract(contract)
    updated_charges = 0
    charge_ids: list[str] = []
    if payload.update_open_charges and due_at is not None:
        updated_charges, charge_ids = await _update_financial_due_dates_for_contract(
            contract=contract,
            due_at=due_at,
            now=now,
            reason=payload.reason or "manual_contract_billing_adjustment",
        )
        if updated_charges > 0:
            updated_fields.append("charges_due_at")

    contract, events, changed = await refresh_contract_state(db, contract)
    if changed:
        for auto_event in events:
            await _record_event(
                owner_id=contract["owner_id"],
                gym_id=contract["gym_id"],
                contract_id=contract["contract_id"],
                event_type=auto_event["event_type"],
                payload=auto_event.get("payload") or {},
                actor={"actor_type": "system", "role": "SYSTEM"},
            )
    await _sync_student_contract_projection(contract)
    await _record_event(
        owner_id=contract["owner_id"],
        gym_id=contract["gym_id"],
        contract_id=contract["contract_id"],
        event_type="contract_billing_adjusted",
        payload={
            "reason": payload.reason,
            "due_at": due_at.isoformat() if due_at else None,
            "billing_day_before": billing_day_before,
            "billing_day": contract.get("billing_day"),
            "update_open_charges": payload.update_open_charges,
            "updated_charges": updated_charges,
            "charge_ids": charge_ids[:100],
            "updated_fields": updated_fields,
        },
        actor=actor,
    )
    return {
        "contract": clean_doc(contract),
        "updated_charges": updated_charges,
        "charge_ids": charge_ids[:100],
    }


@router.post("/contracts/{contract_id}/renew")
async def renew_contract(
    contract_id: str,
    payload: ContractRenewIn,
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    now = utc_now()
    contract = await _load_contract_for_owner(contract_id, actor)
    try:
        ensure_transition(
            contract,
            allowed_from={
                "active",
                "pending_activation",
                "frozen",
                "scheduled_cancel",
                "scheduled_freeze",
                "expired",
            },
            action="renovar",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    duration_unit, duration_value = _resolve_duration_selection(
        payload_unit=payload.duration_unit,
        payload_value=payload.duration_value,
        payload_days=payload.duration_days,
        sources=[contract],
        default_days=30,
    )
    start_at = coerce_datetime_utc(payload.start_at)
    if not start_at:
        current_end = coerce_datetime_utc(contract.get("current_period_end")) or now
        start_at = current_end if current_end > now else now
    duration_days = _resolve_duration_days_compatibility(
        start_at=start_at,
        duration_unit=duration_unit,
        duration_value=duration_value,
    )
    end_at = coerce_datetime_utc(payload.end_at) or period_end(
        start_at,
        duration_unit=duration_unit,
        duration_value=duration_value,
    )
    if end_at <= start_at:
        raise HTTPException(status_code=400, detail="Periodo de renovacao invalido")

    contract["duration_unit"] = duration_unit
    contract["duration_value"] = duration_value
    contract["duration_days"] = duration_days
    contract["current_period_start"] = start_at
    contract["current_period_end"] = end_at
    contract["contract_status"] = "active"
    contract["financial_status"] = "pending"
    contract["access_status"] = infer_access_status("active", "pending", now=now)
    contract["status"] = legacy_status("active", "pending")
    contract["ended_at"] = None
    contract["canceled_at"] = None
    contract["cancel_reason"] = None
    if payload.amount is not None:
        before = _safe_float(contract.get("amount"))
        contract["amount"] = float(payload.amount)
        append_manual_override(
            contract,
            field="amount",
            before=before,
            after=contract["amount"],
            reason=payload.notes or "renew_amount_override",
            actor=actor,
            now=now,
        )
    contract = await _upsert_contract(contract)

    renewal_charge = None
    if payload.create_charge:
        renewal_charge = await _create_charge_and_link(
            contract=contract,
            amount=float(payload.amount if payload.amount is not None else contract.get("amount") or 0),
            due_at=start_at,
            notes=payload.notes or "Cobranca de renovacao",
            now=now,
        )

    contract, events, changed = await refresh_contract_state(db, contract)
    if changed:
        for auto_event in events:
            await _record_event(
                owner_id=contract["owner_id"],
                gym_id=contract["gym_id"],
                contract_id=contract["contract_id"],
                event_type=auto_event["event_type"],
                payload=auto_event.get("payload") or {},
                actor={"actor_type": "system", "role": "SYSTEM"},
            )
    await _sync_student_contract_projection(contract)
    await _record_event(
        owner_id=contract["owner_id"],
        gym_id=contract["gym_id"],
        contract_id=contract["contract_id"],
        event_type="contract_renewed",
        payload={
            "start_at": start_at.isoformat(),
            "end_at": end_at.isoformat(),
            "duration_unit": duration_unit,
            "duration_value": duration_value,
            "duration_days": duration_days,
            "charge_id": (renewal_charge or {}).get("charge_id"),
            "notes": payload.notes,
        },
        actor=actor,
    )
    return {"contract": clean_doc(contract), "renewal_charge": clean_doc(renewal_charge)}


@router.post("/contracts/{contract_id}/freeze", response_model=ContractOut)
async def freeze_contract(
    contract_id: str,
    payload: ContractFreezeIn,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    now = utc_now()
    contract = await _load_contract_for_owner(contract_id, actor)
    try:
        ensure_transition(
            contract,
            allowed_from={"active", "pending_activation", "scheduled_cancel", "scheduled_freeze"},
            action="congelar",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    start_at = coerce_datetime_utc(payload.start_at) or now
    freeze_end_at = coerce_datetime_utc(payload.end_at)
    if not freeze_end_at or freeze_end_at <= start_at:
        raise HTTPException(status_code=400, detail="Periodo de congelamento invalido")

    if start_at > now:
        contract["contract_status"] = "scheduled_freeze"
        contract.setdefault("scheduled_actions", []).append(
            {
                "action_id": f"act_{secrets.token_hex(6)}",
                "action_type": "freeze",
                "status": "pending",
                "effective_at": start_at,
                "freeze_end_at": freeze_end_at,
                "reason": payload.reason,
                "pause_charges": bool(payload.pause_charges),
                "extend_end_by_frozen_days": bool(payload.extend_end_by_frozen_days),
                "created_at": now,
            }
        )
        contract = await _upsert_contract(contract)
        await _record_event(
            owner_id=contract["owner_id"],
            gym_id=contract["gym_id"],
            contract_id=contract["contract_id"],
            event_type="contract_freeze_scheduled",
            payload={
                "effective_at": start_at.isoformat(),
                "freeze_end_at": freeze_end_at.isoformat(),
                "reason": payload.reason,
            },
            actor=actor,
        )
    else:
        contract["contract_status"] = "frozen"
        contract["freeze_reason"] = payload.reason
        contract["frozen_from"] = start_at
        contract["frozen_until"] = freeze_end_at
        contract["extend_end_by_frozen_days"] = bool(payload.extend_end_by_frozen_days)
        contract.setdefault("freeze_periods", []).append(
            {
                "started_at": start_at,
                "resume_expected_at": freeze_end_at,
                "resumed_at": None,
                "reason": payload.reason,
                "source": "manual",
            }
        )
        if payload.pause_charges:
            await db.student_charges.update_many(
                {
                    "owner_id": actor["owner_id"],
                    "contract_id": contract_id,
                    "status": {"$in": ["open", "partially_paid"]},
                    "due_at": {"$gte": start_at, "$lte": freeze_end_at},
                },
                {
                    "$set": {
                        "status": "canceled",
                        "cleanup_reason": "contract_frozen_pause_charges",
                        "updated_at": now,
                        "canceled_at": now,
                    }
                },
            )
        contract = await _upsert_contract(contract)
        await _record_event(
            owner_id=contract["owner_id"],
            gym_id=contract["gym_id"],
            contract_id=contract["contract_id"],
            event_type="contract_frozen",
            payload={
                "started_at": start_at.isoformat(),
                "freeze_end_at": freeze_end_at.isoformat(),
                "reason": payload.reason,
                "pause_charges": payload.pause_charges,
                "extend_end_by_frozen_days": payload.extend_end_by_frozen_days,
            },
            actor=actor,
        )

    contract, events, changed = await refresh_contract_state(db, contract)
    if changed:
        for auto_event in events:
            await _record_event(
                owner_id=contract["owner_id"],
                gym_id=contract["gym_id"],
                contract_id=contract["contract_id"],
                event_type=auto_event["event_type"],
                payload=auto_event.get("payload") or {},
                actor={"actor_type": "system", "role": "SYSTEM"},
            )
    await _sync_student_contract_projection(contract)
    return contract


@router.post("/contracts/{contract_id}/resume", response_model=ContractOut)
async def resume_contract(
    contract_id: str,
    payload: ContractResumeIn | None = None,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    now = utc_now()
    request_data = payload or ContractResumeIn()
    contract = await _load_contract_for_owner(contract_id, actor)
    status_now = str(contract.get("contract_status") or "").lower()

    if status_now == "scheduled_freeze":
        contract["scheduled_actions"] = [
            action
            for action in contract.get("scheduled_actions", [])
            if not (
                str(action.get("action_type") or "").lower() == "freeze"
                and str(action.get("status") or "").lower() == "pending"
            )
        ]
        contract["contract_status"] = "active"
        contract = await _upsert_contract(contract)
        await _record_event(
            owner_id=contract["owner_id"],
            gym_id=contract["gym_id"],
            contract_id=contract["contract_id"],
            event_type="contract_freeze_schedule_canceled",
            payload={"reason": request_data.reason},
            actor=actor,
        )
    elif status_now == "frozen":
        frozen_from = coerce_datetime_utc(contract.get("frozen_from")) or now
        frozen_until = coerce_datetime_utc(contract.get("frozen_until"))
        resume_at = coerce_datetime_utc(request_data.resume_at) or now
        if resume_at < frozen_from:
            raise HTTPException(status_code=400, detail="resume_at nao pode ser anterior ao inicio do congelamento")
        effective_resume = min(resume_at, frozen_until) if frozen_until else resume_at
        if bool(contract.get("extend_end_by_frozen_days", True)):
            frozen_days = max(0, (effective_resume.date() - frozen_from.date()).days)
            contract["current_period_end"] = (
                coerce_datetime_utc(contract.get("current_period_end")) or now
            ) + timedelta(days=frozen_days)

        contract["contract_status"] = "active"
        contract["freeze_reason"] = None
        contract["frozen_from"] = None
        contract["frozen_until"] = None
        for item in reversed(contract.get("freeze_periods", [])):
            if not item.get("resumed_at"):
                item["resumed_at"] = effective_resume
                break
        contract = await _upsert_contract(contract)
        await _record_event(
            owner_id=contract["owner_id"],
            gym_id=contract["gym_id"],
            contract_id=contract["contract_id"],
            event_type="contract_resumed",
            payload={
                "resume_at": effective_resume.isoformat(),
                "reason": request_data.reason,
            },
            actor=actor,
        )
    else:
        raise HTTPException(status_code=400, detail="Contrato nao esta congelado")

    contract, events, changed = await refresh_contract_state(db, contract)
    if changed:
        for auto_event in events:
            await _record_event(
                owner_id=contract["owner_id"],
                gym_id=contract["gym_id"],
                contract_id=contract["contract_id"],
                event_type=auto_event["event_type"],
                payload=auto_event.get("payload") or {},
                actor={"actor_type": "system", "role": "SYSTEM"},
            )
    await _sync_student_contract_projection(contract)
    return contract


@router.post("/contracts/{contract_id}/change-plan")
async def change_plan(
    contract_id: str,
    payload: ContractChangePlanIn,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    now = utc_now()
    contract = await _load_contract_for_owner(contract_id, actor)
    if str(contract.get("contract_status") or "").lower() in TERMINAL_CONTRACT_STATUSES:
        raise HTTPException(status_code=400, detail="Contrato encerrado")

    plan = await db.plans.find_one(
        {"owner_id": actor["owner_id"], "plan_id": payload.new_plan_id},
        {"_id": 0},
    )
    if not plan:
        raise HTTPException(status_code=404, detail="Plano nao encontrado")

    effective_at = coerce_datetime_utc(payload.effective_at) or now
    target_amount = float(payload.amount if payload.amount is not None else plan.get("valor") or contract.get("amount") or 0)
    duration_unit, duration_value = _resolve_duration_selection(
        payload_unit=payload.duration_unit,
        payload_value=payload.duration_value,
        payload_days=payload.duration_days,
        sources=[plan, contract],
        default_days=30,
    )
    target_duration = _resolve_duration_days_compatibility(
        start_at=effective_at,
        duration_unit=duration_unit,
        duration_value=duration_value,
    )

    if payload.mode == "in_place":
        before_plan = contract.get("plan_id")
        before_amount = _safe_float(contract.get("amount"))
        before_discount = _safe_float(contract.get("discount_amount"))
        before_duration = int(contract.get("duration_days") or target_duration)
        before_duration_unit = contract.get("duration_unit") or "days"
        before_duration_value = int(contract.get("duration_value") or before_duration)
        next_original_amount, next_discount_amount, next_amount = _resolve_contract_amount_inputs(
            base_amount=target_amount,
            discount_amount=before_discount,
        )
        contract["plan_id"] = payload.new_plan_id
        contract["plan_name"] = plan.get("nome")
        contract["original_amount"] = next_original_amount
        contract["discount_amount"] = next_discount_amount
        contract["amount"] = next_amount
        contract["duration_unit"] = duration_unit
        contract["duration_value"] = duration_value
        contract["duration_days"] = target_duration
        if not bool(contract.get("manual_end_override")):
            start = coerce_datetime_utc(contract.get("current_period_start")) or now
            contract["current_period_end"] = period_end(
                start,
                duration_unit=duration_unit,
                duration_value=duration_value,
            )
        append_manual_override(
            contract,
            field="plan_id",
            before=before_plan,
            after=payload.new_plan_id,
            reason=payload.notes or "manual_plan_change",
            actor=actor,
            now=now,
        )
        append_manual_override(
            contract,
            field="amount",
            before=before_amount,
            after=next_amount,
            reason=payload.notes or "manual_plan_change",
            actor=actor,
            now=now,
        )
        if before_discount != next_discount_amount:
            append_manual_override(
                contract,
                field="discount_amount",
                before=before_discount,
                after=next_discount_amount,
            reason=payload.notes or "manual_plan_change",
            actor=actor,
            now=now,
        )
        if before_duration_unit != duration_unit:
            append_manual_override(
                contract,
                field="duration_unit",
                before=before_duration_unit,
                after=duration_unit,
                reason=payload.notes or "manual_plan_change",
                actor=actor,
                now=now,
            )
        if before_duration_value != duration_value:
            append_manual_override(
                contract,
                field="duration_value",
                before=before_duration_value,
                after=duration_value,
                reason=payload.notes or "manual_plan_change",
                actor=actor,
                now=now,
            )
        append_manual_override(
            contract,
            field="duration_days",
            before=before_duration,
            after=target_duration,
            reason=payload.notes or "manual_plan_change",
            actor=actor,
            now=now,
        )
        contract = await _upsert_contract(contract)
        await _update_open_charge_amounts_for_contract(
            contract=contract,
            actor=actor,
            now=now,
            reason=payload.notes or "plan_change_in_place",
        )
        contract, events, changed = await refresh_contract_state(db, contract)
        if changed:
            for auto_event in events:
                await _record_event(
                    owner_id=contract["owner_id"],
                    gym_id=contract["gym_id"],
                    contract_id=contract["contract_id"],
                    event_type=auto_event["event_type"],
                    payload=auto_event.get("payload") or {},
                    actor={"actor_type": "system", "role": "SYSTEM"},
                )
        await _sync_student_contract_projection(contract)
        await _record_event(
            owner_id=contract["owner_id"],
            gym_id=contract["gym_id"],
            contract_id=contract["contract_id"],
            event_type="contract_plan_changed",
            payload={
                "mode": "in_place",
                "new_plan_id": payload.new_plan_id,
                "effective_at": effective_at.isoformat(),
                "notes": payload.notes,
            },
            actor=actor,
        )
        return {"contract": clean_doc(contract), "new_contract": None, "initial_charge": None}

    # mode = new_contract
    if effective_at <= now:
        contract["contract_status"] = "ended"
        contract["ended_at"] = now
        contract["auto_renew"] = False
        contract["status"] = legacy_status("ended", contract.get("financial_status", "pending"))
        await _upsert_contract(contract)
        await _record_event(
            owner_id=contract["owner_id"],
            gym_id=contract["gym_id"],
            contract_id=contract["contract_id"],
            event_type="contract_ended_plan_transition",
            payload={"effective_at": now.isoformat(), "new_plan_id": payload.new_plan_id},
            actor=actor,
        )
    else:
        contract["contract_status"] = "scheduled_cancel"
        contract["auto_renew"] = False
        contract.setdefault("scheduled_actions", []).append(
            {
                "action_id": f"act_{secrets.token_hex(6)}",
                "action_type": "cancel",
                "status": "pending",
                "effective_at": effective_at,
                "reason": "plan_transition",
                "created_at": now,
            }
        )
        await _upsert_contract(contract)

    new_contract_status = "pending_activation" if effective_at > now else "active"
    new_financial_status = "pending" if payload.create_initial_charge else "paid"
    next_original_amount, next_discount_amount, next_amount = _resolve_contract_amount_inputs(
        base_amount=target_amount,
        discount_amount=_safe_float(contract.get("discount_amount")),
    )
    new_contract = {
        "contract_id": f"ctr_{secrets.token_hex(8)}",
        "owner_id": contract["owner_id"],
        "gym_id": contract["gym_id"],
        "student_id": contract["student_id"],
        "student_name": contract["student_name"],
        "plan_id": payload.new_plan_id,
        "plan_name": plan.get("nome"),
        "amount": next_amount,
        "original_amount": next_original_amount,
        "discount_amount": next_discount_amount,
        "currency": "BRL",
        "duration_unit": duration_unit,
        "duration_value": duration_value,
        "duration_days": target_duration,
        "billing_cycle": contract.get("billing_cycle") or "custom_days",
        "billing_day": contract.get("billing_day") or min(max(effective_at.day, 1), 28),
        "manual_end_override": False,
        "current_period_start": effective_at,
        "current_period_end": period_end(
            effective_at,
            duration_unit=duration_unit,
            duration_value=duration_value,
        ),
        "next_billing_at": effective_at,
        "contract_status": new_contract_status,
        "financial_status": new_financial_status,
        "access_status": infer_access_status(new_contract_status, new_financial_status, now=now),
        "status": legacy_status(new_contract_status, new_financial_status),
        "auto_renew": contract.get("auto_renew", False),
        "payment_method": contract.get("payment_method"),
        "notes": contract.get("notes"),
        "internal_notes": contract.get("internal_notes"),
        "cancel_reason": None,
        "freeze_reason": None,
        "frozen_from": None,
        "frozen_until": None,
        "extend_end_by_frozen_days": True,
        "grace_until": None,
        "dunning_level": 0,
        "next_retry_at": None,
        "canceled_at": None,
        "ended_at": None,
        "last_payment_at": None,
        "last_charge_id": None,
        "migrated_from_contract_id": contract["contract_id"],
        "manual_overrides": [],
        "scheduled_actions": [],
        "freeze_periods": [],
        "terms_version": contract.get("terms_version"),
        "terms_accepted_at": contract.get("terms_accepted_at"),
        "schema_version": 2,
        "created_at": now,
        "updated_at": now,
    }
    await db.student_contracts.insert_one(new_contract)

    initial_charge = None
    if payload.create_initial_charge:
        initial_charge = await _create_charge_and_link(
            contract=new_contract,
            amount=target_amount,
            due_at=effective_at,
            notes=payload.notes or "Cobranca inicial apos troca de plano",
            now=now,
        )
    new_contract, events, changed = await refresh_contract_state(db, new_contract)
    if changed:
        for auto_event in events:
            await _record_event(
                owner_id=new_contract["owner_id"],
                gym_id=new_contract["gym_id"],
                contract_id=new_contract["contract_id"],
                event_type=auto_event["event_type"],
                payload=auto_event.get("payload") or {},
                actor={"actor_type": "system", "role": "SYSTEM"},
            )
    if effective_at <= now:
        await _sync_student_contract_projection(new_contract)
    await _record_event(
        owner_id=new_contract["owner_id"],
        gym_id=new_contract["gym_id"],
        contract_id=new_contract["contract_id"],
        event_type="contract_created_plan_transition",
        payload={
            "mode": "new_contract",
            "from_contract_id": contract["contract_id"],
            "effective_at": effective_at.isoformat(),
            "new_plan_id": payload.new_plan_id,
            "notes": payload.notes,
        },
        actor=actor,
    )
    return {
        "contract": clean_doc(contract),
        "new_contract": clean_doc(new_contract),
        "initial_charge": clean_doc(initial_charge),
    }


@router.post("/contracts/{contract_id}/charges", response_model=ChargeOut)
async def create_charge(
    contract_id: str,
    payload: ChargeCreateIn,
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    now = utc_now()
    contract = await _load_contract_for_owner(contract_id, actor)
    if str(contract.get("contract_status") or "").lower() in TERMINAL_CONTRACT_STATUSES:
        raise HTTPException(status_code=400, detail="Contrato encerrado")

    amount = float(payload.amount if payload.amount is not None else contract.get("amount") or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount invalido")
    due_at = coerce_datetime_utc(payload.due_at) or coerce_datetime_utc(contract.get("next_billing_at")) or now

    charge = await _create_charge_and_link(
        contract=contract,
        amount=amount,
        due_at=due_at,
        notes=payload.notes,
        now=now,
        status=payload.status,
    )
    await _record_event(
        owner_id=contract["owner_id"],
        gym_id=contract["gym_id"],
        contract_id=contract["contract_id"],
        event_type="charge_created",
        payload={"charge_id": charge["charge_id"], "amount": amount, "due_at": due_at.isoformat()},
        actor=actor,
    )
    refreshed, events, changed = await refresh_contract_state(db, contract)
    if changed:
        for auto_event in events:
            await _record_event(
                owner_id=refreshed["owner_id"],
                gym_id=refreshed["gym_id"],
                contract_id=refreshed["contract_id"],
                event_type=auto_event["event_type"],
                payload=auto_event.get("payload") or {},
                actor={"actor_type": "system", "role": "SYSTEM"},
            )
    await _sync_student_contract_projection(refreshed)
    return charge


@router.get("/contracts/{contract_id}/charges", response_model=list[ChargeOut])
async def list_charges(
    contract_id: str,
    limit: int = Query(default=200, ge=1, le=500),
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    now = utc_now()
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
    now = utc_now()
    request_data = payload or ChargeCleanupIn()
    contract = await _load_contract_for_owner(contract_id, actor)

    statuses = ["open", "overdue", "partially_paid"] if request_data.status_filter == "pending" else ["overdue", "failed"]
    query: dict = {
        "owner_id": actor["owner_id"],
        "contract_id": contract_id,
        "status": {"$in": statuses},
    }
    due_before = coerce_datetime_utc(request_data.due_before)
    if due_before:
        query["due_at"] = {"$lte": due_before}

    pending = await db.student_charges.find(query, {"_id": 0, "charge_id": 1}).limit(2000).to_list(2000)
    charge_ids = [item.get("charge_id") for item in pending if item.get("charge_id")]
    cleaned_count = 0
    if charge_ids:
        update_payload = {
            "status": "canceled",
            "updated_at": now,
            "canceled_at": now,
        }
        if request_data.reason:
            update_payload["cleanup_reason"] = request_data.reason
        result = await db.student_charges.update_many(
            {**query, "charge_id": {"$in": charge_ids}},
            {"$set": update_payload},
        )
        cleaned_count = int(getattr(result, "modified_count", 0))

    refreshed, events, changed = await refresh_contract_state(db, contract)
    if changed:
        for auto_event in events:
            await _record_event(
                owner_id=refreshed["owner_id"],
                gym_id=refreshed["gym_id"],
                contract_id=refreshed["contract_id"],
                event_type=auto_event["event_type"],
                payload=auto_event.get("payload") or {},
                actor={"actor_type": "system", "role": "SYSTEM"},
            )
    await _sync_student_contract_projection(refreshed)
    await _record_event(
        owner_id=refreshed["owner_id"],
        gym_id=refreshed["gym_id"],
        contract_id=refreshed["contract_id"],
        event_type="charges_cleaned",
        payload={
            "status_filter": request_data.status_filter,
            "due_before": due_before.isoformat() if due_before else None,
            "cleaned_count": cleaned_count,
            "charge_ids": charge_ids[:100],
            "reason": request_data.reason,
        },
        actor=actor,
    )

    return ChargeCleanupOut(
        contract_id=contract_id,
        cleaned_count=cleaned_count,
        status_filter=request_data.status_filter,
        due_before=due_before,
        contract_status=str(refreshed.get("contract_status") or "active"),
        charge_ids=charge_ids,
    )


@router.post("/charges/{charge_id}/mark-paid", response_model=ChargeOut)
async def mark_charge_paid(
    charge_id: str,
    payload: ChargeMarkPaidIn,
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    now = utc_now()
    charge = await db.student_charges.find_one(
        {"owner_id": actor["owner_id"], "charge_id": charge_id},
        {"_id": 0},
    )
    if not charge:
        raise HTTPException(status_code=404, detail="Cobranca nao encontrada")
    if str(charge.get("status") or "").lower() == "paid":
        return charge

    paid_at = coerce_datetime_utc(payload.paid_at) or now
    amount_received = (
        float(payload.amount_received)
        if payload.amount_received is not None
        else _safe_float(charge.get("amount"))
    )
    await db.student_charges.update_one(
        {"owner_id": actor["owner_id"], "charge_id": charge_id},
        {
            "$set": {
                "status": "paid",
                "paid_at": paid_at,
                "payment_method": payload.payment_method,
                "amount_received": amount_received,
                "external_reference": payload.external_reference,
                "failure_reason": None,
                "updated_at": now,
            }
        },
    )

    contract = await _load_contract_for_owner(charge["contract_id"], actor, refresh=False)
    contract["last_payment_at"] = paid_at
    contract["last_charge_id"] = charge_id
    contract["financial_status"] = "paid"
    if payload.extend_contract:
        duration_days = int(contract.get("duration_days") or 30)
        current_end = coerce_datetime_utc(contract.get("current_period_end")) or paid_at
        next_start = current_end if current_end > paid_at else paid_at
        next_end = period_end(next_start, duration_days)
        contract["current_period_start"] = next_start
        contract["current_period_end"] = next_end
        contract["contract_status"] = "active"
    contract["status"] = legacy_status(
        contract.get("contract_status") or "active",
        contract.get("financial_status") or "paid",
    )
    await _upsert_contract(contract)
    refreshed, events, changed = await refresh_contract_state(db, contract)
    if changed:
        for auto_event in events:
            await _record_event(
                owner_id=refreshed["owner_id"],
                gym_id=refreshed["gym_id"],
                contract_id=refreshed["contract_id"],
                event_type=auto_event["event_type"],
                payload=auto_event.get("payload") or {},
                actor={"actor_type": "system", "role": "SYSTEM"},
            )
    await _sync_student_contract_projection(refreshed)
    await _record_event(
        owner_id=refreshed["owner_id"],
        gym_id=refreshed["gym_id"],
        contract_id=refreshed["contract_id"],
        event_type="charge_paid",
        payload={
            "charge_id": charge_id,
            "payment_method": payload.payment_method,
            "amount_received": amount_received,
            "extend_contract": payload.extend_contract,
        },
        actor=actor,
    )
    updated = await db.student_charges.find_one(
        {"owner_id": actor["owner_id"], "charge_id": charge_id},
        {"_id": 0},
    )
    if not updated:
        raise HTTPException(status_code=500, detail="Falha ao atualizar cobranca")
    return updated


@router.post("/charges/{charge_id}/mark-unpaid", response_model=ChargeOut)
async def mark_charge_unpaid(
    charge_id: str,
    payload: ChargeMarkUnpaidIn | None = None,
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    now = utc_now()
    request_data = payload or ChargeMarkUnpaidIn()
    charge = await db.student_charges.find_one(
        {"owner_id": actor["owner_id"], "charge_id": charge_id},
        {"_id": 0},
    )
    if not charge:
        raise HTTPException(status_code=404, detail="Cobranca nao encontrada")

    current_status = str(charge.get("status") or "").lower()
    if current_status in {"canceled", "refunded"}:
        raise HTTPException(status_code=409, detail="Nao e possivel desfazer pagamento desta cobranca")
    if current_status != "paid":
        return charge

    due_at = coerce_datetime_utc(charge.get("due_at"))
    next_status = "overdue" if due_at and due_at < now else "open"
    await db.student_charges.update_one(
        {"owner_id": actor["owner_id"], "charge_id": charge_id},
        {
            "$set": {
                "status": next_status,
                "paid_at": None,
                "payment_method": None,
                "amount_received": None,
                "external_reference": None,
                "updated_at": now,
            }
        },
    )

    contract = await _load_contract_for_owner(charge["contract_id"], actor, refresh=False)
    refreshed, events, changed = await refresh_contract_state(db, contract)
    if changed:
        for auto_event in events:
            await _record_event(
                owner_id=refreshed["owner_id"],
                gym_id=refreshed["gym_id"],
                contract_id=refreshed["contract_id"],
                event_type=auto_event["event_type"],
                payload=auto_event.get("payload") or {},
                actor={"actor_type": "system", "role": "SYSTEM"},
            )
    await _sync_student_contract_projection(refreshed)
    await _record_event(
        owner_id=refreshed["owner_id"],
        gym_id=refreshed["gym_id"],
        contract_id=refreshed["contract_id"],
        event_type="charge_payment_reverted",
        payload={
            "charge_id": charge_id,
            "status_before": current_status,
            "status_after": next_status,
            "reason": request_data.reason,
        },
        actor=actor,
    )
    updated = await db.student_charges.find_one(
        {"owner_id": actor["owner_id"], "charge_id": charge_id},
        {"_id": 0},
    )
    if not updated:
        raise HTTPException(status_code=500, detail="Falha ao atualizar cobranca")
    return updated


@router.post("/contracts/{contract_id}/cancel", response_model=ContractOut)
async def cancel_contract(
    contract_id: str,
    payload: ContractCancelIn | None = None,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    now = utc_now()
    request_data = payload or ContractCancelIn()
    contract = await _load_contract_for_owner(contract_id, actor)
    current_status = str(contract.get("contract_status") or "").lower()
    if current_status in TERMINAL_CONTRACT_STATUSES:
        return contract

    if request_data.cancel_recurrence_only:
        contract["auto_renew"] = False
        await _upsert_contract(contract)
        await _record_event(
            owner_id=contract["owner_id"],
            gym_id=contract["gym_id"],
            contract_id=contract["contract_id"],
            event_type="contract_recurrence_disabled",
            payload={"reason": request_data.reason},
            actor=actor,
        )
    elif request_data.mode == "immediate":
        contract["contract_status"] = "canceled"
        contract["auto_renew"] = False
        contract["cancel_reason"] = request_data.reason
        contract["canceled_at"] = now
        contract["ended_at"] = now
        contract["status"] = legacy_status("canceled", contract.get("financial_status") or "pending")
        await _upsert_contract(contract)
        await _record_event(
            owner_id=contract["owner_id"],
            gym_id=contract["gym_id"],
            contract_id=contract["contract_id"],
            event_type="contract_canceled",
            payload={"mode": "immediate", "reason": request_data.reason},
            actor=actor,
        )
    else:
        effective_at = (
            coerce_datetime_utc(request_data.effective_at)
            if request_data.mode == "scheduled"
            else coerce_datetime_utc(contract.get("current_period_end"))
        )
        if not effective_at:
            raise HTTPException(status_code=400, detail="effective_at invalido")
        if effective_at <= now:
            raise HTTPException(status_code=400, detail="effective_at deve estar no futuro")
        contract["contract_status"] = "scheduled_cancel"
        contract["auto_renew"] = False
        contract.setdefault("scheduled_actions", []).append(
            {
                "action_id": f"act_{secrets.token_hex(6)}",
                "action_type": "cancel",
                "status": "pending",
                "effective_at": effective_at,
                "reason": request_data.reason,
                "created_at": now,
            }
        )
        await _upsert_contract(contract)
        await _record_event(
            owner_id=contract["owner_id"],
            gym_id=contract["gym_id"],
            contract_id=contract["contract_id"],
            event_type="contract_cancel_scheduled",
            payload={"mode": request_data.mode, "effective_at": effective_at.isoformat(), "reason": request_data.reason},
            actor=actor,
        )

    refreshed, events, changed = await refresh_contract_state(db, contract)
    if changed:
        for auto_event in events:
            await _record_event(
                owner_id=refreshed["owner_id"],
                gym_id=refreshed["gym_id"],
                contract_id=refreshed["contract_id"],
                event_type=auto_event["event_type"],
                payload=auto_event.get("payload") or {},
                actor={"actor_type": "system", "role": "SYSTEM"},
            )
    await _sync_student_contract_projection(refreshed)
    # Emit structured audit event when a definitive cancellation is recorded.
    final_status = str(refreshed.get("contract_status") or "").lower()
    if final_status in {"canceled", "ended"} and not (payload and payload.cancel_recurrence_only):
        log_event(
            "contract.canceled",
            contract_id=refreshed["contract_id"],
            student_id=refreshed.get("student_id"),
            owner_id=refreshed.get("owner_id"),
            contract_status=final_status,
            cancel_reason=refreshed.get("cancel_reason"),
            mode=getattr(payload, "mode", "end_of_period") if payload else "end_of_period",
            actor_id=actor.get("user_id") or actor.get("sub"),
            actor_role=actor.get("role"),
        )
    return refreshed


@router.get("/events")
async def list_events(
    contract_id: str = "",
    limit: int = Query(default=100, ge=1, le=500),
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    query = {"owner_id": actor["owner_id"]}
    if contract_id:
        query["contract_id"] = contract_id
    return (
        await db.student_billing_events.find(query, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )


@router.get("/reconcile/runs", response_model=list[ReconcileRunOut])
async def list_reconcile_runs(
    limit: int = Query(default=30, ge=1, le=200),
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    return (
        await db.student_billing_reconcile_runs.find(
            {"owner_id": actor["owner_id"]},
            {"_id": 0},
        )
        .sort("started_at", -1)
        .limit(limit)
        .to_list(limit)
    )


@router.post("/reconcile/run")
async def run_reconcile(
    limit: int = Query(default=500, ge=1, le=5000),
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    started_at = utc_now()
    now = started_at
    owner_id = actor["owner_id"]

    overdue_candidates = (
        await db.student_charges.find(
            {
                "owner_id": owner_id,
                "status": "open",
                "due_at": {"$lt": now},
            },
            {"_id": 0},
        )
        .sort("due_at", 1)
        .limit(limit)
        .to_list(limit)
    )

    touched_contract_ids: set[str] = set()
    overdue_marked = 0
    for charge in overdue_candidates:
        charge_id = charge.get("charge_id")
        if not charge_id:
            continue
        update_result = await db.student_charges.update_one(
            {"owner_id": owner_id, "charge_id": charge_id, "status": "open"},
            {"$set": {"status": "overdue", "updated_at": now}},
        )
        if int(getattr(update_result, "modified_count", 0) or 0) <= 0:
            continue

        overdue_marked += 1
        contract_id = str(charge.get("contract_id") or "")
        if contract_id:
            touched_contract_ids.add(contract_id)
            await _record_event(
                owner_id=owner_id,
                gym_id=str(charge.get("gym_id") or actor.get("gym_id") or ""),
                contract_id=contract_id,
                event_type="charge_overdue_marked",
                payload={
                    "charge_id": charge_id,
                    "due_at": coerce_datetime_utc(charge.get("due_at")).isoformat()
                    if coerce_datetime_utc(charge.get("due_at"))
                    else None,
                },
                actor=actor,
            )

    contract_filters: list[dict] = [
        {"financial_status": {"$in": ["overdue", "failed"]}},
        {"access_status": "grace_period"},
        {"grace_until": {"$lte": now}},
        {"next_retry_at": {"$lte": now}},
    ]
    if touched_contract_ids:
        contract_filters.append({"contract_id": {"$in": sorted(touched_contract_ids)}})

    contracts = (
        await db.student_contracts.find(
            {"owner_id": owner_id, "$or": contract_filters},
            {"_id": 0},
        )
        .sort("updated_at", 1)
        .limit(limit)
        .to_list(limit)
    )

    processed_contracts = 0
    updated_contracts = 0
    dunning_advanced = 0
    grace_started = 0
    grace_expired_blocked = 0

    for contract in contracts:
        processed_contracts += 1
        before_access = str(contract.get("access_status") or "").lower()
        before_financial = str(contract.get("financial_status") or "").lower()
        before_dunning_level = int(contract.get("dunning_level") or 0)
        before_grace_until = coerce_datetime_utc(contract.get("grace_until"))
        before_next_retry_at = coerce_datetime_utc(contract.get("next_retry_at"))

        refreshed, events, changed = await refresh_contract_state(db, contract, now=now)
        if changed:
            updated_contracts += 1
            await _sync_student_contract_projection(refreshed)
            for auto_event in events:
                await _record_event(
                    owner_id=refreshed["owner_id"],
                    gym_id=refreshed["gym_id"],
                    contract_id=refreshed["contract_id"],
                    event_type=auto_event["event_type"],
                    payload=auto_event.get("payload") or {},
                    actor={"actor_type": "system", "role": "SYSTEM"},
                )

        after_access = str(refreshed.get("access_status") or "").lower()
        after_financial = str(refreshed.get("financial_status") or "").lower()
        after_dunning_level = int(refreshed.get("dunning_level") or 0)
        after_grace_until = coerce_datetime_utc(refreshed.get("grace_until"))
        after_next_retry_at = coerce_datetime_utc(refreshed.get("next_retry_at"))

        if before_access != "grace_period" and after_access == "grace_period":
            grace_started += 1
            await _record_event(
                owner_id=refreshed["owner_id"],
                gym_id=refreshed["gym_id"],
                contract_id=refreshed["contract_id"],
                event_type="grace_started",
                payload={
                    "financial_status": after_financial,
                    "grace_until": after_grace_until.isoformat() if after_grace_until else None,
                },
                actor=actor,
            )

        grace_expired = before_access == "grace_period" and after_access == "blocked"
        grace_expired = grace_expired and bool(before_grace_until and before_grace_until < now)
        if grace_expired:
            grace_expired_blocked += 1
            await _record_event(
                owner_id=refreshed["owner_id"],
                gym_id=refreshed["gym_id"],
                contract_id=refreshed["contract_id"],
                event_type="grace_expired_access_blocked",
                payload={
                    "grace_until": before_grace_until.isoformat() if before_grace_until else None,
                    "financial_status": after_financial,
                },
                actor=actor,
            )

        dunning_step_changed = after_dunning_level > before_dunning_level
        dunning_contract = after_financial in {"overdue", "failed"} or before_financial in {"overdue", "failed"}
        if dunning_contract and dunning_step_changed:
            dunning_advanced += 1
            await _record_event(
                owner_id=refreshed["owner_id"],
                gym_id=refreshed["gym_id"],
                contract_id=refreshed["contract_id"],
                event_type="dunning_step_advanced",
                payload={
                    "from_level": before_dunning_level,
                    "to_level": after_dunning_level,
                    "next_retry_at": after_next_retry_at.isoformat() if after_next_retry_at else None,
                    "previous_next_retry_at": before_next_retry_at.isoformat()
                    if before_next_retry_at
                    else None,
                },
                actor=actor,
            )

    summary = {
        "limit": limit,
        "open_charges_scanned": len(overdue_candidates),
        "charge_overdue_marked": overdue_marked,
        "contracts_processed": processed_contracts,
        "contracts_updated": updated_contracts,
        "dunning_step_advanced": dunning_advanced,
        "grace_started": grace_started,
        "grace_expired_access_blocked": grace_expired_blocked,
    }
    finished_at = utc_now()
    duration_ms = max(0, int((finished_at - started_at).total_seconds() * 1000))
    run_id = f"sbr_{secrets.token_hex(8)}"
    actor_id = (
        actor.get("owner_id")
        or actor.get("employee_id")
        or actor.get("student_id")
    )
    run_doc = {
        "run_id": run_id,
        "owner_id": owner_id,
        "gym_id": actor.get("gym_id"),
        "actor_type": actor.get("actor_type") or "employee",
        "actor_role": actor.get("role") or "MANAGER",
        "actor_id": actor_id,
        "limit": limit,
        "summary": summary,
        "history_persisted": True,
        "started_at": started_at,
        "finished_at": finished_at,
        "duration_ms": duration_ms,
    }
    history_persisted = True
    try:
        await db.student_billing_reconcile_runs.insert_one(run_doc)
    except Exception:
        history_persisted = False
        logger.exception(
            "student_billing_reconcile_run_persist_failed",
            extra={"owner_id": owner_id, "run_id": run_id},
        )

    return {
        "run_id": run_id,
        "history_persisted": history_persisted,
        "started_at": started_at,
        "finished_at": finished_at,
        "duration_ms": duration_ms,
        "summary": summary,
    }
