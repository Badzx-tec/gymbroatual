import secrets
from datetime import date, datetime, time

from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo.errors import DuplicateKeyError

from app.core.deps import require_roles
from app.core.security import hash_password
from app.core.time import UTC
from app.db.mongo import get_db
from app.models.students import AttendanceIn, MeasurementIn, StudentCreateIn, StudentIn, WorkoutPlanIn
from app.services.internal_codes import (
    ensure_unique_internal_code,
    generate_unique_internal_code,
    normalize_internal_code,
)
from app.services.query_safety import safe_contains_regex

router = APIRouter()
STUDENT_MATRICULA_PREFIX = "ALU"
RESTRICTED_UPDATE_FIELDS = {
    "_id",
    "student_id",
    "owner_id",
    "gym_id",
    "password_hash",
    "created_at",
    "updated_at",
}


def _clean_doc(doc: dict, *, include_auth_meta: bool = True) -> dict:
    sanitized = dict(doc)
    sanitized.pop("_id", None)
    sanitized.pop("password_hash", None)
    if not include_auth_meta:
        sanitized.pop("must_change_password", None)
        sanitized.pop("auth_login_enabled", None)
    return sanitized


def _require_gym_id(owner: dict) -> str:
    gym_id = owner.get("gym_id")
    if not gym_id:
        raise HTTPException(status_code=409, detail="Academia nao vinculada ao usuario")
    return gym_id


def _normalize_cpf(value) -> str | None:
    if value is None:
        return None
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    if not digits:
        return None
    if len(digits) != 11:
        raise HTTPException(status_code=400, detail="CPF deve ter 11 digitos")
    return f"{digits[:3]}.{digits[3:6]}.{digits[6:9]}-{digits[9:]}"


def _normalize_student_doc_data(payload: StudentIn) -> dict:
    data = payload.model_dump()
    for field in ("data_nascimento", "data_vencimento"):
        value = data.get(field)
        if isinstance(value, date):
            data[field] = datetime.combine(value, time.min, tzinfo=UTC)
    data["matricula"] = normalize_internal_code(data.get("matricula"))
    return data


def _normalize_student_update_payload(payload: dict) -> dict:
    updates: dict = {}
    for key, value in payload.items():
        if key in RESTRICTED_UPDATE_FIELDS:
            continue
        updates[key] = value

    if "email" in updates:
        email = str(updates.get("email") or "").strip().lower()
        updates["email"] = email or None

    if "telefone" in updates:
        telefone = str(updates.get("telefone") or "").strip()
        updates["telefone"] = telefone or None

    if "cpf" in updates:
        updates["cpf"] = _normalize_cpf(updates.get("cpf"))

    if "matricula" in updates:
        updates["matricula"] = normalize_internal_code(updates.get("matricula"))

    for field in ("data_nascimento", "data_vencimento"):
        if field not in updates:
            continue
        value = updates.get(field)
        if value in (None, ""):
            updates[field] = None
            continue
        if isinstance(value, datetime):
            parsed = value
        elif isinstance(value, date):
            parsed = datetime.combine(value, time.min)
        elif isinstance(value, str):
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=f"{field} invalida") from exc
        else:
            raise HTTPException(status_code=400, detail=f"{field} invalida")

        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        updates[field] = parsed.astimezone(UTC)

    return updates


def _generated_temp_password() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(12))


@router.get("")
async def list_students(
    search: str = "",
    status: str = "",
    owner: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION", "TRAINER")),
):
    db = get_db()
    query = {
        "owner_id": owner["owner_id"],
        "is_employee_shadow": {"$ne": True},
    }
    if status:
        query["status"] = status
    safe_search = safe_contains_regex(search)
    if safe_search:
        query["$or"] = [
            {"nome": {"$regex": safe_search, "$options": "i"}},
            {"email": {"$regex": safe_search, "$options": "i"}},
            {"telefone": {"$regex": safe_search, "$options": "i"}},
            {"matricula": {"$regex": safe_search, "$options": "i"}},
            {"cpf": {"$regex": safe_search, "$options": "i"}},
            {"tag_rfid": {"$regex": safe_search, "$options": "i"}},
        ]

    docs = await db.students.find(query, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(500)
    return docs


@router.post("")
async def create_student(
    payload: StudentCreateIn,
    owner: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    now = datetime.now(UTC)
    student_id = f"std_{secrets.token_hex(6)}"
    gym_id = _require_gym_id(owner)
    payload_data = _normalize_student_doc_data(payload)

    manual_matricula = normalize_internal_code(payload_data.get("matricula"))
    generated_matricula = None
    matricula_auto_generated = False
    if manual_matricula:
        try:
            await ensure_unique_internal_code(
                db,
                collection_name="students",
                owner_id=owner["owner_id"],
                code=manual_matricula,
            )
        except ValueError as exc:
            raise HTTPException(status_code=409, detail="Matricula ja cadastrada") from exc
    else:
        try:
            generated_matricula = await generate_unique_internal_code(
                db,
                owner_id=owner["owner_id"],
                collection_name="students",
                prefix=STUDENT_MATRICULA_PREFIX,
                counter_key="student_matricula",
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail="Falha ao gerar matricula") from exc
        manual_matricula = generated_matricula
        matricula_auto_generated = True

    provided_password = getattr(payload, "password", None)
    temp_password = None
    if getattr(payload, "auto_generate_password", False) or not provided_password:
        provided_password = _generated_temp_password()
        temp_password = provided_password

    doc = {
        "student_id": student_id,
        "owner_id": owner["owner_id"],
        "gym_id": gym_id,
        **payload_data,
        "matricula": manual_matricula,
        "auth_login_enabled": bool(getattr(payload, "auth_login_enabled", True)),
        "must_change_password": bool(getattr(payload, "force_password_reset", False) or temp_password),
        "password_hash": hash_password(provided_password),
        "created_at": now,
        "updated_at": now,
    }
    try:
        await db.students.insert_one(doc)
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="Dados de aluno ja cadastrados") from exc

    response = _clean_doc(doc)
    if matricula_auto_generated:
        response["matricula_auto_generated"] = True
        response["generated_matricula"] = generated_matricula
    if temp_password:
        response["temp_password"] = temp_password
    return response


@router.get("/{student_id}")
async def get_student(
    student_id: str,
    owner: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION", "TRAINER")),
):
    db = get_db()
    student = await db.students.find_one(
        {"student_id": student_id, "owner_id": owner["owner_id"]},
        {"_id": 0, "password_hash": 0},
    )
    if not student:
        raise HTTPException(status_code=404, detail="Aluno nao encontrado")

    student["measurements"] = (
        await db.measurements.find(
            {"student_id": student_id, "owner_id": owner["owner_id"]},
            {"_id": 0},
        )
        .sort("data", -1)
        .to_list(100)
    )
    student["workouts"] = (
        await db.workouts.find(
            {"student_id": student_id, "owner_id": owner["owner_id"]},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .to_list(20)
    )
    student["attendance"] = (
        await db.attendance.find(
            {"student_id": student_id, "owner_id": owner["owner_id"]},
            {"_id": 0},
        )
        .sort("date_time", -1)
        .to_list(100)
    )
    return student


@router.put("/{student_id}")
async def update_student(
    student_id: str,
    payload: dict,
    owner: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    now = datetime.now(UTC)
    update_fields = _normalize_student_update_payload(payload)

    if "matricula" in update_fields and update_fields.get("matricula"):
        try:
            await ensure_unique_internal_code(
                db,
                collection_name="students",
                owner_id=owner["owner_id"],
                code=update_fields["matricula"],
                exclude_id_field="student_id",
                exclude_id_value=student_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=409, detail="Matricula ja cadastrada") from exc

    temp_password = None
    password_changed = False
    password_value = payload.get("password")
    if password_value is not None:
        cleaned_password = str(password_value or "").strip()
        if cleaned_password:
            if len(cleaned_password) < 8:
                raise HTTPException(
                    status_code=400, detail="Senha deve ter pelo menos 8 caracteres"
                )
            update_fields["password_hash"] = hash_password(cleaned_password)
            update_fields["must_change_password"] = bool(payload.get("force_password_reset", False))
            password_changed = True
        elif bool(payload.get("auto_generate_password")):
            temp_password = _generated_temp_password()
            update_fields["password_hash"] = hash_password(temp_password)
            update_fields["must_change_password"] = True
            password_changed = True
    elif bool(payload.get("auto_generate_password")):
        temp_password = _generated_temp_password()
        update_fields["password_hash"] = hash_password(temp_password)
        update_fields["must_change_password"] = True
        password_changed = True

    if password_changed:
        update_fields["session_revoked_at"] = now

    if "auth_login_enabled" in payload:
        update_fields["auth_login_enabled"] = bool(payload.get("auth_login_enabled"))

    update_fields["updated_at"] = now

    try:
        result = await db.students.update_one(
            {"student_id": student_id, "owner_id": owner["owner_id"]},
            {"$set": update_fields},
        )
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="Dados de aluno ja cadastrados") from exc

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Aluno nao encontrado")

    updated = await db.students.find_one(
        {"student_id": student_id, "owner_id": owner["owner_id"]},
        {"_id": 0, "password_hash": 0},
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Aluno nao encontrado")
    if temp_password:
        updated["temp_password"] = temp_password
    return updated


@router.delete("/{student_id}")
async def delete_student(
    student_id: str,
    owner: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    result = await db.students.delete_one({"student_id": student_id, "owner_id": owner["owner_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Aluno nao encontrado")
    return {"message": "Aluno removido"}


@router.post("/{student_id}/measurements")
async def add_measurement(
    student_id: str,
    payload: MeasurementIn,
    owner: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION", "TRAINER")),
):
    db = get_db()
    gym_id = _require_gym_id(owner)
    doc = {
        "measurement_id": f"mea_{secrets.token_hex(6)}",
        "student_id": student_id,
        "owner_id": owner["owner_id"],
        "gym_id": gym_id,
        **payload.model_dump(by_alias=False),
        "created_at": datetime.now(UTC),
    }
    await db.measurements.insert_one(doc)
    return _clean_doc(doc)


@router.get("/{student_id}/measurements")
async def list_measurements(
    student_id: str,
    owner: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION", "TRAINER")),
):
    db = get_db()
    return (
        await db.measurements.find(
            {"student_id": student_id, "owner_id": owner["owner_id"]},
            {"_id": 0},
        )
        .sort("data", -1)
        .to_list(200)
    )


@router.post("/{student_id}/workouts")
async def add_workout(
    student_id: str,
    payload: WorkoutPlanIn,
    owner: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION", "TRAINER")),
):
    db = get_db()
    gym_id = _require_gym_id(owner)
    doc = {
        "workout_id": f"wrk_{secrets.token_hex(6)}",
        "student_id": student_id,
        "owner_id": owner["owner_id"],
        "gym_id": gym_id,
        **payload.model_dump(),
        "created_at": datetime.now(UTC),
    }
    await db.workouts.insert_one(doc)
    return _clean_doc(doc)


@router.get("/{student_id}/workouts")
async def list_workouts(
    student_id: str,
    owner: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION", "TRAINER")),
):
    db = get_db()
    return (
        await db.workouts.find(
            {"student_id": student_id, "owner_id": owner["owner_id"]},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .to_list(100)
    )


@router.post("/{student_id}/attendance")
async def add_attendance(
    student_id: str,
    payload: AttendanceIn,
    owner: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION", "TRAINER")),
):
    db = get_db()
    gym_id = _require_gym_id(owner)
    doc = {
        "attendance_id": f"att_{secrets.token_hex(6)}",
        "student_id": student_id,
        "owner_id": owner["owner_id"],
        "gym_id": gym_id,
        **payload.model_dump(),
        "created_at": datetime.now(UTC),
    }
    await db.attendance.insert_one(doc)
    await db.access_logs.insert_one(
        {
            "log_id": f"log_{secrets.token_hex(6)}",
            "student_id": student_id,
            "student_name": (
                await db.students.find_one({"student_id": student_id}, {"nome": 1, "_id": 0}) or {}
            ).get("nome", "Aluno"),
            "tag_id": student_id,
            "tipo": payload.source,
            "autorizado": True,
            "motivo": "Acesso registrado",
            "timestamp": payload.date_time,
            "owner_id": owner["owner_id"],
            "gym_id": gym_id,
        }
    )
    return _clean_doc(doc)


@router.get("/{student_id}/attendance")
async def list_attendance(
    student_id: str,
    owner: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION", "TRAINER")),
    limit: int = Query(default=100, le=500),
):
    db = get_db()
    return (
        await db.attendance.find(
            {"student_id": student_id, "owner_id": owner["owner_id"]},
            {"_id": 0},
        )
        .sort("date_time", -1)
        .limit(limit)
        .to_list(limit)
    )
