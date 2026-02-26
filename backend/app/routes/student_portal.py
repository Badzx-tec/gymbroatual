from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.deps import require_student_actor
from app.core.time import UTC
from app.db.mongo import get_db

router = APIRouter()


def _clean_doc(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    cleaned = dict(doc)
    cleaned.pop("_id", None)
    cleaned.pop("password_hash", None)
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
    if contract and str(contract.get("status") or "").lower() in {"past_due", "expired", "canceled"}:
        return str(contract.get("status")).lower()
    plan_end = student.get("plan_expires_at") or student.get("data_vencimento")
    if isinstance(plan_end, datetime):
        compare = plan_end.astimezone(UTC) if plan_end.tzinfo else plan_end.replace(tzinfo=UTC)
        if compare < now:
            return "expired"
    return "active"


@router.get("/dashboard")
async def student_dashboard(actor: dict = Depends(require_student_actor)):
    db = get_db()
    now = datetime.now(UTC)
    student = await _load_student(actor)

    contract = (
        await db.student_contracts.find(
            {"owner_id": actor["owner_id"], "student_id": actor["student_id"]},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(1)
        .to_list(1)
    )
    active_contract = contract[0] if contract else None

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
        "contract": _clean_doc(active_contract),
        "access_status": status,
        "recent_access_logs": access_logs,
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
    return (
        await db.student_contracts.find(
            {"owner_id": actor["owner_id"], "student_id": actor["student_id"]},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )


@router.get("/access-logs")
async def student_access_logs(
    limit: int = Query(default=50, ge=1, le=200),
    actor: dict = Depends(require_student_actor),
):
    db = get_db()
    return (
        await db.access_logs.find(
            {"owner_id": actor["owner_id"], "student_id": actor["student_id"]},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )
