import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from app.core.deps import require_roles
from app.core.security import hash_password
from app.core.time import UTC
from app.db.mongo import get_db

router = APIRouter()

ALLOWED_ROLES = {"OWNER", "MANAGER", "RECEPTION", "TRAINER"}
TURNSTILE_FIELDS = ("tag_rfid", "biometria_id", "keypad_code", "matricula")


def _clean_optional(value):
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _extract_turnstile_fields(payload: dict) -> dict:
    return {field: _clean_optional(payload.get(field)) for field in TURNSTILE_FIELDS}


def _safe_employee(employee: dict) -> dict:
    return {k: v for k, v in employee.items() if k != "password_hash"}


async def _sync_employee_shadow_student(employee: dict) -> str:
    db = get_db()
    now = datetime.now(UTC)
    shadow_student_id = f"empstd_{employee['employee_id']}"
    shadow_doc = {
        "student_id": shadow_student_id,
        "owner_id": employee["owner_id"],
        "gym_id": employee["gym_id"],
        "nome": f"[FUNC] {employee['name']}",
        "email": employee.get("email"),
        "telefone": employee.get("telefone"),
        "status": "ativo",
        "matricula": employee.get("matricula") or employee["employee_id"],
        "tag_rfid": employee.get("tag_rfid"),
        "biometria_id": employee.get("biometria_id"),
        "keypad_code": employee.get("keypad_code"),
        "is_employee_shadow": True,
        "employee_id": employee["employee_id"],
        "updated_at": now,
    }
    await db.students.update_one(
        {"student_id": shadow_student_id, "owner_id": employee["owner_id"]},
        {
            "$set": shadow_doc,
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    return shadow_student_id


@router.post("/invites")
async def create_invite(payload: dict, actor: dict = Depends(require_roles("OWNER", "MANAGER"))):
    role = (payload.get("role") or "").upper()
    email = (payload.get("email") or "").strip().lower() or None
    if role not in ALLOWED_ROLES - {"OWNER"}:
        raise HTTPException(status_code=400, detail="Role invalida")
    if not email:
        raise HTTPException(status_code=400, detail="Email obrigatorio")

    db = get_db()
    invite = {
        "invite_id": f"inv_{secrets.token_hex(6)}",
        "gym_id": actor["gym_id"],
        "owner_id": actor["owner_id"],
        "email": email,
        "role": role,
        "token": secrets.token_urlsafe(24),
        "expires_at": datetime.now(UTC) + timedelta(days=2),
        "used_at": None,
        "canceled_at": None,
        "created_at": datetime.now(UTC),
    }
    await db.employee_invites.insert_one(invite)
    return invite


@router.get("/invites")
async def list_invites(actor: dict = Depends(require_roles("OWNER", "MANAGER"))):
    db = get_db()
    return (
        await db.employee_invites.find(
            {"owner_id": actor["owner_id"], "canceled_at": None},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .to_list(200)
    )


@router.delete("/invites/{invite_id}")
async def cancel_invite(invite_id: str, actor: dict = Depends(require_roles("OWNER", "MANAGER"))):
    db = get_db()
    await db.employee_invites.update_one(
        {"invite_id": invite_id, "owner_id": actor["owner_id"]},
        {"$set": {"canceled_at": datetime.now(UTC)}},
    )
    return {"message": "Convite cancelado"}


@router.get("/employees")
async def list_employees(actor: dict = Depends(require_roles("OWNER", "MANAGER"))):
    db = get_db()
    return await db.employees.find(
        {"owner_id": actor["owner_id"]}, {"_id": 0, "password_hash": 0}
    ).to_list(200)


@router.post("/employees")
async def create_employee(payload: dict, actor: dict = Depends(require_roles("OWNER", "MANAGER"))):
    db = get_db()
    email = (payload.get("email") or "").strip().lower() or None
    role = (payload.get("role") or "").upper()
    if role not in ALLOWED_ROLES - {"OWNER"}:
        raise HTTPException(status_code=400, detail="Role invalida")
    if not payload.get("name"):
        raise HTTPException(status_code=400, detail="Nome obrigatorio")

    if email and await db.employees.find_one({"email": email, "owner_id": actor["owner_id"]}, {"_id": 0}):
        raise HTTPException(status_code=400, detail="Email ja cadastrado")

    raw_password = payload.get("password") or secrets.token_urlsafe(8)
    employee = {
        "employee_id": f"emp_{secrets.token_hex(6)}",
        "gym_id": actor["gym_id"],
        "owner_id": actor["owner_id"],
        "name": payload["name"],
        "email": email,
        "password_hash": hash_password(raw_password),
        "role": role,
        "is_active": True,
        **_extract_turnstile_fields(payload),
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    await db.employees.insert_one(employee)
    result = _safe_employee(employee)
    if bool(payload.get("sync_shadow_student", False)):
        result["shadow_student_id"] = await _sync_employee_shadow_student(employee)
    result["temp_password"] = raw_password
    return result


@router.put("/employees/{employee_id}")
async def update_employee(
    employee_id: str,
    payload: dict,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    now = datetime.now(UTC)
    update_fields: dict = {"updated_at": now}

    if "name" in payload:
        name = str(payload.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Nome invalido")
        update_fields["name"] = name

    if "email" in payload:
        email = str(payload.get("email") or "").strip().lower()
        if not email:
            raise HTTPException(status_code=400, detail="Email invalido")
        update_fields["email"] = email

    if "role" in payload:
        role = (payload.get("role") or "").upper()
        if role not in ALLOWED_ROLES - {"OWNER"}:
            raise HTTPException(status_code=400, detail="Role invalida")
        update_fields["role"] = role

    if "is_active" in payload:
        update_fields["is_active"] = bool(payload.get("is_active"))

    turnstile_fields = _extract_turnstile_fields(payload)
    for field in TURNSTILE_FIELDS:
        if field in payload:
            update_fields[field] = turnstile_fields[field]

    try:
        result = await db.employees.update_one(
            {"employee_id": employee_id, "owner_id": actor["owner_id"]},
            {"$set": update_fields},
        )
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="Email ja cadastrado") from exc

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Funcionario nao encontrado")

    employee = await db.employees.find_one(
        {"employee_id": employee_id, "owner_id": actor["owner_id"]},
        {"_id": 0},
    )
    if not employee:
        raise HTTPException(status_code=404, detail="Funcionario nao encontrado")

    response = _safe_employee(employee)
    if bool(payload.get("sync_shadow_student", False)):
        response["shadow_student_id"] = await _sync_employee_shadow_student(employee)
    return response


@router.delete("/employees/{employee_id}")
async def delete_employee(
    employee_id: str,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    employee = await db.employees.find_one(
        {"employee_id": employee_id, "owner_id": actor["owner_id"]},
        {"_id": 0},
    )
    if not employee:
        raise HTTPException(status_code=404, detail="Funcionario nao encontrado")

    await db.employees.delete_one({"employee_id": employee_id, "owner_id": actor["owner_id"]})
    await db.students.delete_one(
        {
            "owner_id": actor["owner_id"],
            "$or": [
                {"student_id": f"empstd_{employee_id}"},
                {"employee_id": employee_id, "is_employee_shadow": True},
            ],
        }
    )
    await db.biometrics.delete_many(
        {
            "owner_id": actor["owner_id"],
            "$or": [
                {"employee_id": employee_id},
                {"subject_type": "employee", "subject_id": employee_id},
            ],
        }
    )

    return {"message": "Funcionario removido", "employee_id": employee_id}


@router.post("/employees/{employee_id}/deactivate")
async def deactivate_employee(
    employee_id: str, actor: dict = Depends(require_roles("OWNER", "MANAGER"))
):
    db = get_db()
    await db.employees.update_one(
        {"employee_id": employee_id, "owner_id": actor["owner_id"]},
        {"$set": {"is_active": False, "updated_at": datetime.now(UTC)}},
    )
    return {"message": "Funcionario desativado"}


@router.post("/employees/{employee_id}/reset-password")
async def reset_password(
    employee_id: str,
    payload: dict | None = None,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    new_password = (payload or {}).get("new_password") or secrets.token_urlsafe(8)
    result = await db.employees.update_one(
        {"employee_id": employee_id, "owner_id": actor["owner_id"]},
        {
            "$set": {
                "password_hash": hash_password(new_password),
                "updated_at": datetime.now(UTC),
            }
        },
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Funcionario nao encontrado")
    return {"message": "Senha redefinida", "temp_password": new_password}


@router.post("/employees/{employee_id}/credentials")
async def update_employee_credentials(
    employee_id: str,
    payload: dict,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    update_fields = {
        **_extract_turnstile_fields(payload),
        "updated_at": datetime.now(UTC),
    }
    result = await db.employees.update_one(
        {"employee_id": employee_id, "owner_id": actor["owner_id"]},
        {"$set": update_fields},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Funcionario nao encontrado")

    employee = await db.employees.find_one(
        {"employee_id": employee_id, "owner_id": actor["owner_id"]},
        {"_id": 0},
    )
    if not employee:
        raise HTTPException(status_code=404, detail="Funcionario nao encontrado")

    response = _safe_employee(employee)
    if bool(payload.get("sync_shadow_student", False)):
        response["shadow_student_id"] = await _sync_employee_shadow_student(employee)
    return response


@router.post("/employees/{employee_id}/sync-shadow-student")
async def sync_employee_shadow_student(
    employee_id: str,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    employee = await db.employees.find_one(
        {"employee_id": employee_id, "owner_id": actor["owner_id"]},
        {"_id": 0},
    )
    if not employee:
        raise HTTPException(status_code=404, detail="Funcionario nao encontrado")

    shadow_student_id = await _sync_employee_shadow_student(employee)
    return {
        "message": "Funcionario sincronizado para compatibilidade de catraca",
        "employee_id": employee_id,
        "shadow_student_id": shadow_student_id,
    }
