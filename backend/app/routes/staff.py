import logging
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from app.core.deps import require_roles
from app.core.security import hash_password
from app.core.time import UTC
from app.db.mongo import get_db
from app.services.internal_codes import (
    ensure_unique_internal_code,
    generate_unique_internal_code,
    normalize_internal_code,
)

router = APIRouter()
logger = logging.getLogger(__name__)

ALLOWED_ROLES = {"OWNER", "MANAGER", "RECEPTION", "TRAINER"}
TURNSTILE_FIELDS = ("tag_rfid", "biometria_id", "keypad_code", "matricula")
EMPLOYEE_MATRICULA_PREFIX = "FUNC"


def _clean_optional(value):
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _extract_turnstile_fields(payload: dict) -> dict:
    fields = {field: _clean_optional(payload.get(field)) for field in TURNSTILE_FIELDS}
    fields["matricula"] = normalize_internal_code(payload.get("matricula"))
    return fields


def _normalize_optional_email(value) -> str | None:
    email = (str(value or "").strip().lower()) or None
    if not email:
        return None
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Email invalido")
    local, domain = email.split("@", 1)
    if not local or not domain or "." not in domain:
        raise HTTPException(status_code=400, detail="Email invalido")
    return email


def _safe_employee(employee: dict) -> dict:
    return {k: v for k, v in employee.items() if k not in {"_id", "password_hash"}}


def _safe_invite(invite: dict) -> dict:
    return {k: v for k, v in invite.items() if k != "_id"}


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


async def _sync_shadow_student_safe(employee: dict) -> tuple[str | None, str | None]:
    try:
        return await _sync_employee_shadow_student(employee), None
    except DuplicateKeyError:
        logger.exception(
            "DuplicateKeyError ao sincronizar aluno tecnico de funcionario",
            extra={"employee_id": employee.get("employee_id"), "owner_id": employee.get("owner_id")},
        )
        return None, "Funcionario criado, mas houve conflito ao sincronizar aluno tecnico"
    except Exception:
        logger.exception(
            "Erro inesperado ao sincronizar aluno tecnico de funcionario",
            extra={"employee_id": employee.get("employee_id"), "owner_id": employee.get("owner_id")},
        )
        return None, "Funcionario criado, mas nao foi possivel sincronizar aluno tecnico"


@router.post("/invites")
async def create_invite(payload: dict, actor: dict = Depends(require_roles("OWNER", "MANAGER"))):
    role = (payload.get("role") or "").upper()
    email = _normalize_optional_email(payload.get("email"))
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
    return _safe_invite(invite)


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
    email = _normalize_optional_email(payload.get("email"))
    role = (payload.get("role") or "").upper()
    name = str(payload.get("name") or "").strip()
    if role not in ALLOWED_ROLES - {"OWNER"}:
        raise HTTPException(status_code=400, detail="Role invalida")
    if not name:
        raise HTTPException(status_code=400, detail="Nome obrigatorio")

    if email and await db.employees.find_one({"email": email, "owner_id": actor["owner_id"]}, {"_id": 0}):
        raise HTTPException(status_code=400, detail="Email ja cadastrado")

    raw_password = payload.get("password") or secrets.token_urlsafe(8)
    turnstile_fields = _extract_turnstile_fields(payload)
    matricula_auto_generated = False
    generated_matricula = None

    if turnstile_fields.get("matricula"):
        try:
            await ensure_unique_internal_code(
                db,
                collection_name="employees",
                owner_id=actor["owner_id"],
                code=turnstile_fields["matricula"],
            )
        except ValueError as exc:
            raise HTTPException(status_code=409, detail="Matricula ja cadastrada") from exc
    else:
        try:
            generated_matricula = await generate_unique_internal_code(
                db,
                owner_id=actor["owner_id"],
                collection_name="employees",
                prefix=EMPLOYEE_MATRICULA_PREFIX,
                counter_key="employee_matricula",
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail="Falha ao gerar matricula") from exc
        turnstile_fields["matricula"] = generated_matricula
        matricula_auto_generated = True

    employee = {
        "employee_id": f"emp_{secrets.token_hex(6)}",
        "gym_id": actor["gym_id"],
        "owner_id": actor["owner_id"],
        "name": name,
        "email": email,
        "password_hash": hash_password(raw_password),
        "role": role,
        "is_active": True,
        **turnstile_fields,
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    try:
        await db.employees.insert_one(employee)
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="Dados de funcionario ja cadastrados") from exc

    result = _safe_employee(employee)
    if bool(payload.get("sync_shadow_student", False)):
        shadow_student_id, shadow_sync_warning = await _sync_shadow_student_safe(employee)
        if shadow_student_id:
            result["shadow_student_id"] = shadow_student_id
        if shadow_sync_warning:
            result["shadow_sync_warning"] = shadow_sync_warning
    if matricula_auto_generated:
        result["matricula_auto_generated"] = True
        result["generated_matricula"] = generated_matricula
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
        email = _normalize_optional_email(payload.get("email"))
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

    if "matricula" in payload and turnstile_fields.get("matricula"):
        try:
            await ensure_unique_internal_code(
                db,
                collection_name="employees",
                owner_id=actor["owner_id"],
                code=turnstile_fields["matricula"],
                exclude_id_field="employee_id",
                exclude_id_value=employee_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=409, detail="Matricula ja cadastrada") from exc

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
        shadow_student_id, shadow_sync_warning = await _sync_shadow_student_safe(employee)
        if shadow_student_id:
            response["shadow_student_id"] = shadow_student_id
        if shadow_sync_warning:
            response["shadow_sync_warning"] = shadow_sync_warning
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
    now = datetime.now(UTC)
    await db.employees.update_one(
        {"employee_id": employee_id, "owner_id": actor["owner_id"]},
        {"$set": {"is_active": False, "session_revoked_at": now, "updated_at": now}},
    )
    return {"message": "Funcionario desativado"}


@router.post("/employees/{employee_id}/reset-password")
async def reset_password(
    employee_id: str,
    payload: dict | None = None,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    now = datetime.now(UTC)
    new_password = (payload or {}).get("new_password") or secrets.token_urlsafe(8)
    result = await db.employees.update_one(
        {"employee_id": employee_id, "owner_id": actor["owner_id"]},
        {
            "$set": {
                "password_hash": hash_password(new_password),
                "session_revoked_at": now,
                "updated_at": now,
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
    matricula = update_fields.get("matricula")
    if matricula:
        try:
            await ensure_unique_internal_code(
                db,
                collection_name="employees",
                owner_id=actor["owner_id"],
                code=matricula,
                exclude_id_field="employee_id",
                exclude_id_value=employee_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=409, detail="Matricula ja cadastrada") from exc
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
        shadow_student_id, shadow_sync_warning = await _sync_shadow_student_safe(employee)
        if shadow_student_id:
            response["shadow_student_id"] = shadow_student_id
        if shadow_sync_warning:
            response["shadow_sync_warning"] = shadow_sync_warning
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

    try:
        shadow_student_id = await _sync_employee_shadow_student(employee)
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="Conflito ao sincronizar aluno tecnico") from exc
    return {
        "message": "Funcionario sincronizado para compatibilidade de catraca",
        "employee_id": employee_id,
        "shadow_student_id": shadow_student_id,
    }
