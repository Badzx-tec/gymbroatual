from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.deps import require_student_actor
from app.core.time import UTC
from app.db.mongo import get_db
from app.services.student_contracts import (
    clean_doc,
    refresh_contract_state,
    resolve_authoritative_contract_for_student,
)

router = APIRouter()


def _sanitize_doc(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    cleaned = clean_doc(doc) or {}
    cleaned.pop("password_hash", None)
    return cleaned


def _sanitize_contract_for_student(contract: dict | None) -> dict | None:
    cleaned = _sanitize_doc(contract)
    if cleaned is None:
        return None
    cleaned.pop("internal_notes", None)
    cleaned.pop("manual_overrides", None)
    return cleaned


def _sanitize_charge_for_student(charge: dict) -> dict:
    cleaned = _sanitize_doc(charge) or {}
    # Campos internos/operacionais que nao sao necessarios no portal do aluno.
    cleaned.pop("failure_reason", None)
    return cleaned


def _sanitize_event_for_student(event: dict) -> dict:
    cleaned = _sanitize_doc(event) or {}
    # Remove metadados internos de actor para reduzir exposicao desnecessaria.
    cleaned.pop("actor_id", None)
    return cleaned


def _status_totals(items: list[dict], field: str, *, expected: list[str] | None = None) -> dict:
    totals: dict[str, int] = {}
    for item in items:
        key = str(item.get(field) or "").strip().lower()
        if not key:
            continue
        totals[key] = totals.get(key, 0) + 1
    for key in expected or []:
        totals.setdefault(key, 0)
    return totals


def _mask_credential(raw_value: str | None) -> str | None:
    value = str(raw_value or "").strip()
    if not value:
        return None
    if len(value) <= 4:
        return "*" * len(value)
    return f"{'*' * max(0, len(value) - 4)}{value[-4:]}"


def _sanitize_access_log_for_student(log: dict) -> dict:
    cleaned = _sanitize_doc(log) or {}
    cleaned.pop("owner_id", None)
    cleaned.pop("gym_id", None)
    cleaned.pop("credential", None)
    cleaned["credential_masked"] = _mask_credential(log.get("credential"))
    return cleaned


async def _load_student(actor: dict) -> dict:
    db = get_db()
    student = await db.students.find_one(
        {
            "owner_id": actor["owner_id"],
            "student_id": actor["student_id"],
            "is_employee_shadow": {"$ne": True},
        },
        {"_id": 0, "password_hash": 0},
    )
    if not student:
        raise HTTPException(status_code=404, detail="Aluno nao encontrado")
    return student


def _access_status(student: dict, contract: dict | None, now: datetime) -> str:
    if str(student.get("status") or "").lower() != "ativo":
        return "blocked"
    if bool(student.get("access_blocked", False)):
        return "blocked"
    contract_access = str(
        (contract or {}).get("access_status") or student.get("contract_access_status") or ""
    ).lower()
    if contract_access in {"allowed", "blocked", "grace_period", "suspended"}:
        return contract_access
    if contract is None:
        return "blocked"
    contract_status = str(
        (contract or {}).get("contract_status") or student.get("contract_status") or ""
    ).lower()
    if contract_status in {"canceled", "expired", "ended"}:
        return "blocked"
    if contract and str(contract.get("status") or "").lower() in {"past_due", "expired", "canceled"}:
        return str(contract.get("status")).lower()
    plan_end = student.get("plan_expires_at") or student.get("data_vencimento")
    if isinstance(plan_end, datetime):
        compare = plan_end.astimezone(UTC) if plan_end.tzinfo else plan_end.replace(tzinfo=UTC)
        if compare < now:
            return "expired"
    return "active"


def _access_context(student: dict, contract: dict | None, access_status: str) -> dict:
    contract_doc = contract or {
        "contract_status": student.get("contract_status"),
        "financial_status": student.get("contract_financial_status"),
        "grace_until": student.get("contract_grace_until"),
        "next_retry_at": student.get("contract_next_retry_at"),
        "dunning_level": student.get("contract_dunning_level"),
    }
    grace_until = contract_doc.get("grace_until")
    next_retry_at = contract_doc.get("next_retry_at")
    dunning_level = int(contract_doc.get("dunning_level") or 0)
    blocked_reason = None
    if bool(student.get("access_blocked", False)):
        blocked_reason = "manual_block"
    elif access_status in {"blocked", "suspended"}:
        contract_status = str(contract_doc.get("contract_status") or "").lower()
        financial_status = str(contract_doc.get("financial_status") or "").lower()
        if financial_status in {"overdue", "failed"}:
            blocked_reason = "financial_default_after_grace"
        elif contract_status in {"frozen"}:
            blocked_reason = "contract_frozen"
        elif contract_status in {"canceled", "expired", "ended"}:
            blocked_reason = "contract_ended"
        else:
            blocked_reason = "policy_restriction"
    return {
        "grace_until": grace_until,
        "next_retry_at": next_retry_at,
        "dunning_level": dunning_level,
        "blocked_reason": blocked_reason,
    }


@router.get("/dashboard")
async def student_dashboard(actor: dict = Depends(require_student_actor)):
    db = get_db()
    now = datetime.now(UTC)
    student = await _load_student(actor)
    active_contract = await resolve_authoritative_contract_for_student(
        db,
        owner_id=actor["owner_id"],
        student_id=actor["student_id"],
        now=now,
    )

    upcoming_charges = (
        await db.student_charges.find(
            {
                "owner_id": actor["owner_id"],
                "student_id": actor["student_id"],
                "status": {"$in": ["open", "overdue", "partially_paid"]},
            },
            {"_id": 0},
        )
        .sort("due_at", 1)
        .limit(8)
        .to_list(8)
    )

    access_logs = (
        await db.access_logs.find(
            {"owner_id": actor["owner_id"], "student_id": actor["student_id"]},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(20)
        .to_list(20)
    )

    notifications = (
        await db.notifications.find(
            {"owner_id": actor["owner_id"], "student_id": actor["student_id"]},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(10)
        .to_list(10)
    )

    status = _access_status(student, active_contract, now)
    access_context = _access_context(student, active_contract, status)
    return {
        "student": {
            "student_id": student["student_id"],
            "name": student.get("nome"),
            "email": student.get("email"),
            "phone": student.get("telefone"),
            "matricula": student.get("matricula"),
            "status": student.get("status"),
            "plan_id": student.get("plano_id"),
            "plan_expires_at": student.get("plan_expires_at") or student.get("data_vencimento"),
        },
        "contract": _sanitize_contract_for_student(active_contract),
        "access_status": status,
        "access_context": access_context,
        "upcoming_charges": [_sanitize_charge_for_student(item) for item in upcoming_charges],
        "recent_access_logs": [_sanitize_access_log_for_student(item) for item in access_logs],
        "notifications": notifications,
    }


@router.get("/profile")
async def student_profile(actor: dict = Depends(require_student_actor)):
    student = await _load_student(actor)
    return {
        "student_id": student["student_id"],
        "name": student.get("nome"),
        "email": student.get("email"),
        "phone": student.get("telefone"),
        "cpf": student.get("cpf"),
        "matricula": student.get("matricula"),
        "status": student.get("status"),
        "plan_id": student.get("plano_id"),
        "plan_expires_at": student.get("plan_expires_at") or student.get("data_vencimento"),
    }


@router.put("/profile")
async def update_student_profile(payload: dict, actor: dict = Depends(require_student_actor)):
    db = get_db()
    now = datetime.now(UTC)
    student = await _load_student(actor)

    updates = {"updated_at": now}
    if "name" in payload:
        name = str(payload.get("name") or "").strip()
        if len(name) < 2:
            raise HTTPException(status_code=400, detail="Nome invalido")
        updates["nome"] = name
    if "email" in payload:
        email = str(payload.get("email") or "").strip().lower()
        updates["email"] = email or None
    if "phone" in payload:
        phone = str(payload.get("phone") or "").strip()
        updates["telefone"] = phone or None

    await db.students.update_one(
        {"owner_id": actor["owner_id"], "student_id": student["student_id"]},
        {"$set": updates},
    )
    updated = await _load_student(actor)
    return {
        "student_id": updated["student_id"],
        "name": updated.get("nome"),
        "email": updated.get("email"),
        "phone": updated.get("telefone"),
        "matricula": updated.get("matricula"),
    }


@router.get("/contracts")
async def student_contracts(
    limit: int = Query(default=20, ge=1, le=100),
    actor: dict = Depends(require_student_actor),
):
    db = get_db()
    docs = (
        await db.student_contracts.find(
            {
                "owner_id": actor["owner_id"],
                "student_id": actor["student_id"],
                "is_archived": {"$ne": True},
            },
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )
    refreshed: list[dict] = []
    for item in docs:
        contract, _, _ = await refresh_contract_state(db, item)
        sanitized = _sanitize_contract_for_student(contract)
        if sanitized:
            refreshed.append(sanitized)
    return refreshed


@router.get("/access-logs")
async def student_access_logs(
    limit: int = Query(default=50, ge=1, le=200),
    actor: dict = Depends(require_student_actor),
):
    db = get_db()
    logs = (
        await db.access_logs.find(
            {"owner_id": actor["owner_id"], "student_id": actor["student_id"]},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )
    return [_sanitize_access_log_for_student(item) for item in logs]


@router.get("/billing")
async def student_billing(
    limit_contracts: int = Query(default=20, ge=1, le=100),
    limit_charges: int = Query(default=100, ge=1, le=300),
    limit_events: int = Query(default=120, ge=1, le=300),
    actor: dict = Depends(require_student_actor),
):
    db = get_db()
    now = datetime.now(UTC)
    student = await _load_student(actor)
    contracts_raw = (
        await db.student_contracts.find(
            {
                "owner_id": actor["owner_id"],
                "student_id": actor["student_id"],
                "is_archived": {"$ne": True},
            },
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(limit_contracts)
        .to_list(limit_contracts)
    )

    contracts: list[dict] = []
    for item in contracts_raw:
        refreshed, _, _ = await refresh_contract_state(db, item)
        contracts.append(refreshed)
    contract_ids = [item.get("contract_id") for item in contracts if item.get("contract_id")]

    charges_query: dict = {
        "owner_id": actor["owner_id"],
        "student_id": actor["student_id"],
    }
    if contract_ids:
        charges_query["contract_id"] = {"$in": contract_ids}
    charges = (
        await db.student_charges.find(charges_query, {"_id": 0})
        .sort("due_at", -1)
        .limit(limit_charges)
        .to_list(limit_charges)
    )

    events: list[dict] = []
    if contract_ids:
        events = (
            await db.student_billing_events.find(
                {"owner_id": actor["owner_id"], "contract_id": {"$in": contract_ids}},
                {"_id": 0},
            )
            .sort("created_at", -1)
            .limit(limit_events)
            .to_list(limit_events)
        )

    open_statuses = {"open", "overdue", "partially_paid", "failed"}
    open_charges = [item for item in charges if str(item.get("status") or "").lower() in open_statuses]
    paid_charges = [item for item in charges if str(item.get("status") or "").lower() == "paid"]
    next_due = None
    for charge in sorted(
        open_charges,
        key=lambda item: item.get("due_at") or datetime.max.replace(tzinfo=UTC),
    ):
        next_due = charge.get("due_at")
        if next_due:
            break

    sanitized_contracts: list[dict] = []
    for item in contracts:
        sanitized = _sanitize_contract_for_student(item)
        if sanitized:
            sanitized_contracts.append(sanitized)

    current_contract = await resolve_authoritative_contract_for_student(
        db,
        owner_id=actor["owner_id"],
        student_id=actor["student_id"],
        now=now,
    )
    current_access_status = _access_status(student, current_contract, now)
    current_access_context = _access_context(student, current_contract, current_access_status)

    return {
        "contracts": sanitized_contracts,
        "charges": [_sanitize_charge_for_student(item) for item in charges],
        "events": [_sanitize_event_for_student(item) for item in events],
        "summary": {
            "total_contracts": len(contracts),
            "open_charges": len(open_charges),
            "paid_charges": len(paid_charges),
            "overdue_charges": len(
                [item for item in charges if str(item.get("status") or "").lower() in {"overdue", "failed"}]
            ),
            "next_due_at": next_due,
            "charge_status_totals": _status_totals(
                charges,
                "status",
                expected=["open", "overdue", "paid", "failed", "partially_paid", "canceled", "refunded"],
            ),
            "contract_financial_totals": _status_totals(
                contracts,
                "financial_status",
                expected=["paid", "pending", "overdue", "failed", "partially_paid", "refunded"],
            ),
            "contract_access_totals": _status_totals(
                contracts,
                "access_status",
                expected=["allowed", "grace_period", "blocked", "suspended"],
            ),
            "current_contract_id": current_contract.get("contract_id") if current_contract else None,
            "current_contract_status": (
                current_contract.get("contract_status") or current_contract.get("status")
            ) if current_contract else None,
            "current_financial_status": current_contract.get("financial_status") if current_contract else None,
            "current_access_status": current_access_status,
            "blocked_reason": current_access_context.get("blocked_reason"),
            "grace_until": current_access_context.get("grace_until"),
            "next_retry_at": current_access_context.get("next_retry_at"),
            "dunning_level": int(current_access_context.get("dunning_level") or 0),
        },
    }
