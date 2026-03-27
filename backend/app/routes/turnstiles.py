import hashlib
import hmac
import secrets
from datetime import date, datetime, time, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from app.core.config import get_settings
from app.core.deps import require_roles
from app.core.http import get_client_ip
from app.core.time import SAO_PAULO_TZ, UTC, sao_paulo_day_bounds, to_sao_paulo
from app.db.mongo import get_db
from app.services.internal_codes import normalize_internal_code
from app.services.observability import log_event
from app.services.student_contracts import derive_student_operational_status, refresh_contract_state
from app.services.subscription import subscription_allows_login
from app.services.student_usage import touch_student_usage

router = APIRouter()

ALLOWED_METHODS = {"rfid", "barcode", "keypad", "biometry", "passage"}
DIRECTION_ENTRY = "entry"
DIRECTION_EXIT = "exit"
DIRECTION_BOTH = "both"
DIRECTION_UNKNOWN = "unknown"
SUBJECT_TYPES = ("student", "employee", "owner")
CONTROL_ACTIONS = {
    "lock_entry",
    "lock_exit",
    "lock_both",
    "unlock_entry",
    "unlock_exit",
    "unlock_both",
    # aliases legados da rota /catraca/command
    "block",
    "release_entry",
    "release_exit",
}
WEEKDAY_NAMES = {
    "monday": 0,
    "mon": 0,
    "segunda": 0,
    "tuesday": 1,
    "tue": 1,
    "terca": 1,
    "terça": 1,
    "wednesday": 2,
    "wed": 2,
    "quarta": 2,
    "thursday": 3,
    "thu": 3,
    "quinta": 3,
    "friday": 4,
    "fri": 4,
    "sexta": 4,
    "saturday": 5,
    "sat": 5,
    "sabado": 5,
    "sábado": 5,
    "sunday": 6,
    "sun": 6,
    "domingo": 6,
}
MANUAL_RELEASE_DIRECTION_VALUES = {"entry", "exit"}
MANUAL_RELEASE_STATUSES = {"pending", "claimed", "executed", "failed", "expired"}
RELEASE_COMMAND_TYPES = {"manual_turnstile_release", "quick_turnstile_release"}


class ManualReleaseCreateIn(BaseModel):
    student_id: str
    direction: Literal["entry", "exit"]
    reason: str = Field(min_length=3, max_length=240)
    device_id: str | None = Field(default=None, max_length=120)
    source: str | None = Field(default=None, max_length=120)


class QuickReleaseCreateIn(BaseModel):
    direction: Literal["entry", "exit"]
    device_id: str | None = Field(default=None, max_length=120)
    source: str | None = Field(default=None, max_length=120)


def _normalize_direction(value) -> str:
    if isinstance(value, int):
        if value == 1:
            return DIRECTION_ENTRY
        if value == 2:
            return DIRECTION_EXIT
        if value == 3:
            return DIRECTION_BOTH
        return DIRECTION_UNKNOWN

    raw = str(value or "").strip().lower()
    if raw in {"entry", "entrada", "in", "inside", "1"}:
        return DIRECTION_ENTRY
    if raw in {"exit", "saida", "out", "outside", "2"}:
        return DIRECTION_EXIT
    if raw in {"both", "bidir", "bidirectional", "bidirecional", "3"}:
        return DIRECTION_BOTH
    return DIRECTION_UNKNOWN


def _normalize_control_scope(value) -> str:
    raw = str(value or "").strip().lower()
    if raw in {"students", "student", "alunos", "aluno"}:
        return "students"
    if raw in {"employees", "employee", "funcionarios", "funcionario"}:
        return "employees"
    if raw in {"owners", "owner", "donos", "dono"}:
        return "owners"
    return "all"


def _subjects_for_scope(scope: str) -> set[str]:
    normalized = _normalize_control_scope(scope)
    if normalized == "students":
        return {"student"}
    if normalized == "employees":
        return {"employee"}
    if normalized == "owners":
        return {"owner"}
    return {"student", "employee", "owner"}


def _empty_subject_controls() -> dict:
    return {
        subject: {"entry_locked": False, "exit_locked": False}
        for subject in SUBJECT_TYPES
    }


def _normalize_subject_controls(raw) -> dict:
    controls = _empty_subject_controls()
    if not isinstance(raw, dict):
        return controls
    for subject in SUBJECT_TYPES:
        current = raw.get(subject)
        if not isinstance(current, dict):
            continue
        controls[subject] = {
            "entry_locked": bool(current.get("entry_locked", False)),
            "exit_locked": bool(current.get("exit_locked", False)),
        }
    return controls


def _sanitize_turnstile_control_state(doc: dict | None) -> dict:
    current = doc or {}
    return {
        "owner_id": current.get("owner_id"),
        "gym_id": current.get("gym_id"),
        "subject_controls": _normalize_subject_controls(current.get("subject_controls")),
        "last_action": current.get("last_action"),
        "last_scope": current.get("last_scope"),
        "updated_at": current.get("updated_at"),
        "updated_by": current.get("updated_by"),
        "updated_role": current.get("updated_role"),
    }


def _resolve_directional_allowance(direction: str, allow_entry: bool, allow_exit: bool) -> bool:
    normalized = _normalize_direction(direction)
    if normalized == DIRECTION_ENTRY:
        return allow_entry
    if normalized == DIRECTION_EXIT:
        return allow_exit
    return allow_entry or allow_exit


def _default_control_state(*, owner_id: str, gym_id: str | None) -> dict:
    return {
        "owner_id": owner_id,
        "gym_id": gym_id,
        "subject_controls": _empty_subject_controls(),
        "last_action": None,
        "last_scope": "all",
        "updated_at": None,
        "updated_by": None,
        "updated_role": None,
    }


async def get_turnstile_control_state(*, owner_id: str, gym_id: str | None = None) -> dict:
    db = get_db()
    stored = await db.catraca_control_state.find_one({"owner_id": owner_id}, {"_id": 0})
    if not stored:
        return _default_control_state(owner_id=owner_id, gym_id=gym_id)
    sanitized = _sanitize_turnstile_control_state(stored)
    if not sanitized.get("gym_id") and gym_id:
        sanitized["gym_id"] = gym_id
    return sanitized


def _normalize_control_action(value: str) -> str:
    action = str(value or "").strip().lower()
    alias = {
        "block": "lock_both",
        "release_entry": "unlock_entry",
        "release_exit": "unlock_exit",
    }
    return alias.get(action, action)


async def apply_turnstile_control_action(
    *,
    owner_id: str,
    gym_id: str | None,
    action: str,
    scope: str,
    actor_id: str | None,
    actor_role: str | None,
) -> dict:
    normalized_action = _normalize_control_action(action)
    if normalized_action not in CONTROL_ACTIONS:
        raise HTTPException(status_code=400, detail="Acao de catraca invalida")

    normalized_scope = _normalize_control_scope(scope)
    target_subjects = _subjects_for_scope(normalized_scope)
    db = get_db()
    now = datetime.now(UTC)
    current = await get_turnstile_control_state(owner_id=owner_id, gym_id=gym_id)
    controls = _normalize_subject_controls(current.get("subject_controls"))

    for subject in target_subjects:
        item = controls.get(subject) or {"entry_locked": False, "exit_locked": False}
        if normalized_action == "lock_entry":
            item["entry_locked"] = True
        elif normalized_action == "lock_exit":
            item["exit_locked"] = True
        elif normalized_action == "lock_both":
            item["entry_locked"] = True
            item["exit_locked"] = True
        elif normalized_action == "unlock_entry":
            item["entry_locked"] = False
        elif normalized_action == "unlock_exit":
            item["exit_locked"] = False
        elif normalized_action == "unlock_both":
            item["entry_locked"] = False
            item["exit_locked"] = False
        controls[subject] = item

    payload = {
        "owner_id": owner_id,
        "gym_id": gym_id,
        "subject_controls": controls,
        "last_action": normalized_action,
        "last_scope": normalized_scope,
        "updated_at": now,
        "updated_by": actor_id,
        "updated_role": actor_role,
    }
    await db.catraca_control_state.update_one(
        {"owner_id": owner_id},
        {
            "$set": payload,
            "$setOnInsert": {
                "created_at": now,
            },
        },
        upsert=True,
    )
    return _sanitize_turnstile_control_state(payload)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _signature_payload(method: str, credential: str, timestamp: str, nonce: str) -> bytes:
    return f"{method}:{credential}:{timestamp}:{nonce}".encode("utf-8")


def _normalize_method(method: str) -> str:
    normalized = (method or "").strip().lower()
    if normalized == "biometria":
        return "biometry"
    return normalized


def _coerce_optional_bool(value) -> bool | None:
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    raw = str(value).strip().lower()
    if raw in {"1", "true", "t", "yes", "y", "on", "allow", "allowed"}:
        return True
    if raw in {"0", "false", "f", "no", "n", "off", "deny", "denied"}:
        return False
    return None


def _parse_timestamp_utc(value: str) -> datetime:
    raw = (value or "").strip()
    if not raw:
        raise HTTPException(status_code=401, detail="Timestamp ausente")
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Timestamp invalido") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _coerce_datetime_utc(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    if isinstance(value, date):
        return datetime.combine(value, time.min, tzinfo=UTC)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    return None


def _parse_hhmm(value: str | None) -> time | None:
    if not value:
        return None
    raw = str(value).strip()
    parts = raw.split(":")
    if len(parts) != 2:
        return None
    try:
        hour = int(parts[0])
        minute = int(parts[1])
    except ValueError:
        return None
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return None
    return time(hour=hour, minute=minute)


def _normalize_weekdays(values) -> set[int]:
    normalized: set[int] = set()
    if not values:
        return normalized
    for item in values:
        if isinstance(item, int) and 0 <= item <= 6:
            normalized.add(item)
            continue
        key = str(item).strip().lower()
        if key.isdigit():
            as_int = int(key)
            if 0 <= as_int <= 6:
                normalized.add(as_int)
            continue
        if key in WEEKDAY_NAMES:
            normalized.add(WEEKDAY_NAMES[key])
    return normalized


def _is_inside_time_window(current: time, start: time, end: time) -> bool:
    if start <= end:
        return start <= current <= end
    return current >= start or current <= end


def _mask_credential(raw_value: str | None) -> str | None:
    value = str(raw_value or "").strip()
    if not value:
        return None
    if len(value) <= 4:
        return "*" * len(value)
    visible = value[-4:]
    return f"{'*' * max(0, len(value) - 4)}{visible}"


def _sanitize_access_log_output(entry: dict) -> dict:
    safe = dict(entry)
    safe.pop("_id", None)
    safe["credential_masked"] = _mask_credential(safe.get("credential"))
    safe.pop("credential", None)
    return safe


def _credential_query_for_method(*, owner_id: str, method: str, credential: str) -> dict | None:
    normalized_method = _normalize_method(method)
    cleaned_credential = str(credential or "").strip()
    if not cleaned_credential:
        return None

    if normalized_method == "biometry":
        return {
            "owner_id": owner_id,
            "biometria_id": cleaned_credential,
        }

    if normalized_method == "rfid":
        return {
            "owner_id": owner_id,
            "tag_rfid": cleaned_credential,
        }

    if normalized_method == "barcode":
        normalized_code = normalize_internal_code(cleaned_credential)
        if not normalized_code:
            return None
        return {
            "owner_id": owner_id,
            "matricula": normalized_code,
        }

    if normalized_method == "keypad":
        normalized_code = normalize_internal_code(cleaned_credential)
        keypad_clauses = [{"keypad_code": cleaned_credential}]
        if normalized_code:
            keypad_clauses.append({"matricula": normalized_code})
        return {
            "owner_id": owner_id,
            "$or": keypad_clauses,
        }

    return None


def _evaluate_student_access(student: dict | None, now: datetime) -> tuple[bool, str, dict]:
    if not student:
        return False, "student_not_found", {"rule": "student_exists"}

    if student.get("status", "ativo") != "ativo":
        return False, "student_inactive", {"student_status": student.get("status")}

    if bool(student.get("access_blocked", False)):
        return False, "student_manual_block", {"rule": "access_blocked"}

    contract_access_status = str(student.get("contract_access_status") or "").lower()
    contract_grace_until = _coerce_datetime_utc(student.get("contract_grace_until"))
    if contract_access_status in {"blocked", "suspended"}:
        return (
            False,
            "contract_access_blocked",
            {
                "contract_access_status": contract_access_status,
                "contract_status": student.get("contract_status"),
                "contract_financial_status": student.get("contract_financial_status"),
            },
        )
    contract_access_allowed = contract_access_status in {"allowed", "grace_period"}

    blocked_until = _coerce_datetime_utc(
        student.get("blocked_until") or student.get("bloqueado_ate")
    )
    if blocked_until and blocked_until > now:
        return (
            False,
            "student_blocked_until",
            {"blocked_until": blocked_until.isoformat(), "reason": student.get("block_reason")},
        )

    allowed_weekdays = _normalize_weekdays(
        student.get("allowed_weekdays") or student.get("dias_permitidos")
    )
    if allowed_weekdays and now.weekday() not in allowed_weekdays:
        return (
            False,
            "outside_allowed_weekday",
            {"allowed_weekdays": sorted(allowed_weekdays), "current_weekday": now.weekday()},
        )

    start = _parse_hhmm(student.get("allowed_time_start") or student.get("horario_inicio"))
    end = _parse_hhmm(student.get("allowed_time_end") or student.get("horario_fim"))
    if start and end and not _is_inside_time_window(now.time(), start, end):
        return (
            False,
            "outside_allowed_time",
            {
                "allowed_time_start": start.strftime("%H:%M"),
                "allowed_time_end": end.strftime("%H:%M"),
                "current_time": now.strftime("%H:%M"),
            },
        )

    if not contract_access_allowed:
        plan_until = _coerce_datetime_utc(
            student.get("plano_validade")
            or student.get("plan_expires_at")
            or student.get("subscription_end")
        )
        if plan_until and plan_until < now:
            return False, "plan_expired", {"plan_expires_at": plan_until.isoformat()}

    if contract_access_status == "grace_period":
        return (
            True,
            "ok",
            {
                "rule": "grace_period",
                "contract_access_status": "grace_period",
                "grace_until": contract_grace_until.isoformat() if contract_grace_until else None,
            },
        )
    return True, "ok", {"rule": "all_checks_passed"}


def _evaluate_employee_access(employee: dict | None, now: datetime) -> tuple[bool, str, dict]:
    if not employee:
        return False, "employee_not_found", {"rule": "employee_exists"}

    if not bool(employee.get("is_active", True)):
        return False, "employee_inactive", {"is_active": employee.get("is_active")}

    if bool(employee.get("access_blocked", False)):
        return False, "employee_manual_block", {"rule": "access_blocked"}

    blocked_until = _coerce_datetime_utc(employee.get("blocked_until"))
    if blocked_until and blocked_until > now:
        return (
            False,
            "employee_blocked_until",
            {"blocked_until": blocked_until.isoformat()},
        )

    allowed_weekdays = _normalize_weekdays(
        employee.get("allowed_weekdays") or employee.get("dias_permitidos")
    )
    if allowed_weekdays and now.weekday() not in allowed_weekdays:
        return (
            False,
            "employee_outside_allowed_weekday",
            {"allowed_weekdays": sorted(allowed_weekdays), "current_weekday": now.weekday()},
        )

    start = _parse_hhmm(employee.get("allowed_time_start") or employee.get("horario_inicio"))
    end = _parse_hhmm(employee.get("allowed_time_end") or employee.get("horario_fim"))
    if start and end and not _is_inside_time_window(now.time(), start, end):
        return (
            False,
            "employee_outside_allowed_time",
            {
                "allowed_time_start": start.strftime("%H:%M"),
                "allowed_time_end": end.strftime("%H:%M"),
                "current_time": now.strftime("%H:%M"),
            },
        )

    return True, "ok", {"rule": "employee_checks_passed"}


def _evaluate_owner_access(owner: dict | None, now: datetime) -> tuple[bool, str, dict]:
    if not owner:
        return False, "owner_not_found", {"rule": "owner_exists"}

    if owner.get("is_active") is False:
        return False, "owner_inactive", {"is_active": owner.get("is_active")}

    if bool(owner.get("access_blocked", False)):
        return False, "owner_manual_block", {"rule": "access_blocked"}

    blocked_until = _coerce_datetime_utc(owner.get("blocked_until"))
    if blocked_until and blocked_until > now:
        return (
            False,
            "owner_blocked_until",
            {"blocked_until": blocked_until.isoformat()},
        )

    allowed_weekdays = _normalize_weekdays(
        owner.get("allowed_weekdays") or owner.get("dias_permitidos")
    )
    if allowed_weekdays and now.weekday() not in allowed_weekdays:
        return (
            False,
            "owner_outside_allowed_weekday",
            {"allowed_weekdays": sorted(allowed_weekdays), "current_weekday": now.weekday()},
        )

    start = _parse_hhmm(owner.get("allowed_time_start") or owner.get("horario_inicio"))
    end = _parse_hhmm(owner.get("allowed_time_end") or owner.get("horario_fim"))
    if start and end and not _is_inside_time_window(now.time(), start, end):
        return (
            False,
            "owner_outside_allowed_time",
            {
                "allowed_time_start": start.strftime("%H:%M"),
                "allowed_time_end": end.strftime("%H:%M"),
                "current_time": now.strftime("%H:%M"),
            },
        )

    return True, "ok", {"rule": "owner_checks_passed"}


async def _refresh_student_contract_snapshot(student: dict, now: datetime) -> dict:
    db = get_db()
    latest = (
        await db.student_contracts.find(
            {"owner_id": student.get("owner_id"), "student_id": student.get("student_id")},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(1)
        .to_list(1)
    )
    if not latest:
        return student

    contract, _, _ = await refresh_contract_state(db, latest[0])
    updates = {
        "contract_status": contract.get("contract_status"),
        "contract_financial_status": contract.get("financial_status"),
        "contract_access_status": contract.get("access_status"),
        "contract_grace_until": contract.get("grace_until"),
        "contract_next_retry_at": contract.get("next_retry_at"),
        "contract_dunning_level": int(contract.get("dunning_level") or 0),
        "plan_expires_at": contract.get("current_period_end"),
        "subscription_end": contract.get("current_period_end"),
        "data_vencimento": contract.get("current_period_end"),
    }
    desired_status, desired_auto_source = derive_student_operational_status(
        current_status=student.get("status"),
        current_auto_source=student.get("auto_status_source"),
        contract_access_status=contract.get("access_status"),
        contract_financial_status=contract.get("financial_status"),
    )
    current_status = str(student.get("status") or "ativo").strip().lower()
    if current_status != desired_status:
        updates["status"] = desired_status
    current_auto_source = str(student.get("auto_status_source") or "").strip().lower() or None
    if current_auto_source != desired_auto_source:
        updates["auto_status_source"] = desired_auto_source

    should_update = any(student.get(key) != value for key, value in updates.items())
    if should_update:
        await db.students.update_one(
            {"owner_id": student.get("owner_id"), "student_id": student.get("student_id")},
            {"$set": {**updates, "updated_at": now}},
        )
    return {**student, **updates}


async def _log_security_event(
    *,
    device_id: str,
    owner_id: str | None,
    gym_id: str | None,
    event: str,
    reason: str,
    ip: str,
    metadata: dict | None = None,
) -> None:
    db = get_db()
    await db.turnstile_security_events.insert_one(
        {
            "event_id": f"sec_{secrets.token_hex(8)}",
            "device_id": device_id,
            "owner_id": owner_id,
            "gym_id": gym_id,
            "event": event,
            "reason": reason,
            "ip": ip,
            "metadata": metadata or {},
            "created_at": datetime.now(UTC),
        }
    )


async def _register_auth_failure(
    device: dict, *, reason: str, ip: str, metadata: dict | None = None
) -> None:
    settings = get_settings()
    db = get_db()
    now = datetime.now(UTC)

    current_attempts = int(device.get("invalid_auth_attempts", 0)) + 1
    update: dict = {"invalid_auth_attempts": current_attempts, "updated_at": now}
    blocked_until = None
    if current_attempts >= settings.gateway_invalid_attempt_threshold:
        blocked_until = now + timedelta(seconds=settings.gateway_block_seconds)
        update["blocked_until"] = blocked_until

    await db.turnstile_devices.update_one({"device_id": device["device_id"]}, {"$set": update})
    await _log_security_event(
        device_id=device["device_id"],
        owner_id=device.get("owner_id"),
        gym_id=device.get("gym_id"),
        event="auth_failure",
        reason=reason,
        ip=ip,
        metadata={
            "attempts": current_attempts,
            "blocked_until": blocked_until.isoformat() if blocked_until else None,
            **(metadata or {}),
        },
    )
    log_event(
        "turnstile_auth_failure",
        device_id=device["device_id"],
        owner_id=device.get("owner_id"),
        reason=reason,
        attempts=current_attempts,
        blocked_until=blocked_until.isoformat() if blocked_until else None,
    )


async def _register_nonce(device_id: str, nonce: str, now: datetime) -> None:
    db = get_db()
    settings = get_settings()
    expires_at = now + timedelta(seconds=settings.gateway_nonce_ttl_seconds)
    await db.turnstile_nonces.insert_one(
        {
            "device_id": device_id,
            "nonce": nonce,
            "created_at": now,
            "expires_at": expires_at,
        }
    )


async def _authenticate_gateway_request(
    payload: dict,
    *,
    device_token_header: str | None,
    source_ip: str,
) -> tuple[dict, dict]:
    db = get_db()
    settings = get_settings()
    now = datetime.now(UTC)

    device_id = str(payload.get("device_id") or "").strip()
    method = _normalize_method(payload.get("method", ""))
    credential = str(payload.get("credential", ""))
    direction = _normalize_direction(payload.get("direction"))
    timestamp = str(payload.get("timestamp", ""))
    nonce = str(payload.get("nonce", ""))
    signature = str(payload.get("signature", ""))
    token = str(device_token_header or "").strip()

    if not device_id or not method or not timestamp or not nonce or not signature or not token:
        await _log_security_event(
            device_id=device_id or "unknown",
            owner_id=None,
            gym_id=None,
            event="auth_failure",
            reason="incomplete_payload_or_missing_token_header",
            ip=source_ip,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Payload incompleto ou token ausente no header X-Device-Token",
        )

    if method not in ALLOWED_METHODS:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Metodo invalido")

    device = await db.turnstile_devices.find_one({"device_id": device_id}, {"_id": 0})
    if not device:
        await _log_security_event(
            device_id=device_id,
            owner_id=None,
            gym_id=None,
            event="auth_failure",
            reason="unknown_device",
            ip=source_ip,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Dispositivo invalido")

    if not device.get("is_active", True):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Dispositivo inativo")

    blocked_until = _coerce_datetime_utc(device.get("blocked_until"))
    if blocked_until and blocked_until > now:
        await _log_security_event(
            device_id=device_id,
            owner_id=device.get("owner_id"),
            gym_id=device.get("gym_id"),
            event="auth_blocked",
            reason="device_temporarily_blocked",
            ip=source_ip,
            metadata={"blocked_until": blocked_until.isoformat()},
        )
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=f"Dispositivo bloqueado ate {blocked_until.isoformat()}",
        )

    if _hash_token(token) != device.get("token_hash"):
        await _register_auth_failure(device, reason="invalid_token", ip=source_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalido")

    try:
        parsed_timestamp = _parse_timestamp_utc(timestamp)
    except HTTPException:
        await _register_auth_failure(device, reason="invalid_timestamp", ip=source_ip)
        raise

    skew = abs((now - parsed_timestamp).total_seconds())
    if skew > settings.gateway_max_skew_seconds:
        await _register_auth_failure(
            device,
            reason="timestamp_outside_allowed_window",
            ip=source_ip,
            metadata={"skew_seconds": skew},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Timestamp fora da janela permitida",
        )

    expected = hmac.new(
        token.encode("utf-8"),
        _signature_payload(method, credential, timestamp, nonce),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        await _register_auth_failure(device, reason="invalid_signature", ip=source_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Assinatura invalida")

    try:
        await _register_nonce(device_id=device_id, nonce=nonce, now=now)
    except DuplicateKeyError:
        await _register_auth_failure(device, reason="nonce_replay_detected", ip=source_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Nonce reutilizado")

    await db.turnstile_devices.update_one(
        {"device_id": device_id},
        {
            "$set": {
                "last_seen_at": now,
                "updated_at": now,
                "invalid_auth_attempts": 0,
                "blocked_until": None,
            }
        },
    )

    return device, {
        "device_id": device_id,
        "method": method,
        "credential": credential,
        "direction": direction,
        "timestamp": parsed_timestamp,
        "nonce": nonce,
    }


async def _authenticate_gateway_device_channel(
    *,
    device_id: str,
    device_token_header: str | None,
    source_ip: str,
) -> dict:
    db = get_db()
    now = datetime.now(UTC)
    normalized_device_id = str(device_id or "").strip()
    token = str(device_token_header or "").strip()
    if not normalized_device_id or not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Canal do dispositivo invalido")

    device = await db.turnstile_devices.find_one({"device_id": normalized_device_id}, {"_id": 0})
    if not device:
        await _log_security_event(
            device_id=normalized_device_id,
            owner_id=None,
            gym_id=None,
            event="auth_failure",
            reason="unknown_device_channel",
            ip=source_ip,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Dispositivo invalido")

    if _hash_token(token) != device.get("token_hash"):
        await _register_auth_failure(device, reason="invalid_device_channel_token", ip=source_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalido")

    await db.turnstile_devices.update_one(
        {"device_id": normalized_device_id},
        {
            "$set": {
                "last_seen_at": now,
                "updated_at": now,
                "invalid_auth_attempts": 0,
                "blocked_until": None,
            }
        },
    )
    return device


def _manual_release_message(student_name: str | None, direction: str) -> str:
    normalized_direction = _normalize_direction(direction)
    if normalized_direction == DIRECTION_EXIT:
        return f"SAIDA {str(student_name or 'ALUNO').strip()[:9].upper()}"
    return f"ENTRADA {str(student_name or 'ALUNO').strip()[:7].upper()}"


def _quick_release_message(direction: str) -> str:
    normalized_direction = _normalize_direction(direction)
    if normalized_direction == DIRECTION_EXIT:
        return "SAIDA LIVRE"
    return "ENTRADA LIVRE"


def _normalize_release_source(value, *, default: str) -> str:
    normalized = str(value or "").strip()
    return normalized[:120] if normalized else default


async def _expire_manual_release_commands(*, owner_id: str | None = None, now: datetime | None = None) -> int:
    db = get_db()
    current_now = now or datetime.now(UTC)
    query: dict = {
        "command_type": {"$in": sorted(RELEASE_COMMAND_TYPES)},
        "status": {"$in": ["pending", "claimed"]},
        "expires_at": {"$lte": current_now},
    }
    if owner_id:
        query["owner_id"] = owner_id

    stale = (
        await db.catraca_commands.find(query, {"_id": 0, "cmd_id": 1})
        .limit(500)
        .to_list(500)
    )
    expired_count = 0
    for item in stale:
        cmd_id = str(item.get("cmd_id") or "").strip()
        if not cmd_id:
            continue
        result = await db.catraca_commands.update_one(
            {
                "cmd_id": cmd_id,
                "command_type": {"$in": sorted(RELEASE_COMMAND_TYPES)},
                "status": {"$in": ["pending", "claimed"]},
            },
            {
                "$set": {
                    "status": "expired",
                    "expired_at": current_now,
                    "updated_at": current_now,
                }
            },
        )
        if int(getattr(result, "modified_count", 0) or 0) > 0:
            expired_count += 1
    return expired_count


async def _load_latest_student_contract(*, owner_id: str, student_id: str) -> dict | None:
    db = get_db()
    docs = (
        await db.student_contracts.find(
            {"owner_id": owner_id, "student_id": student_id},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(20)
        .to_list(20)
    )
    if not docs:
        return None
    for item in docs:
        refreshed, _, _ = await refresh_contract_state(db, item)
        status_value = str(refreshed.get("contract_status") or "").lower()
        if status_value in {"active", "pending_activation", "frozen", "scheduled_cancel", "scheduled_freeze"}:
            return refreshed
    refreshed, _, _ = await refresh_contract_state(db, docs[0])
    return refreshed


def _is_daily_contract_eligible(contract: dict | None, *, now: datetime) -> tuple[bool, str]:
    if not contract:
        return False, "daily_contract_missing"
    if int(contract.get("duration_days") or 0) != 1:
        return False, "daily_contract_duration_invalid"
    contract_status = str(contract.get("contract_status") or "").lower()
    financial_status = str(contract.get("financial_status") or "").lower()
    access_status = str(contract.get("access_status") or "").lower()
    if contract_status not in {"active", "pending_activation", "scheduled_cancel"}:
        return False, "daily_contract_inactive"
    if financial_status != "paid":
        return False, "daily_contract_unpaid"
    if access_status not in {"allowed", "grace_period"}:
        return False, "daily_contract_access_blocked"

    start = _coerce_datetime_utc(contract.get("current_period_start"))
    end = _coerce_datetime_utc(contract.get("current_period_end"))
    if not start or not end:
        return False, "daily_contract_period_invalid"

    _, now_day_end = sao_paulo_day_bounds((to_sao_paulo(now) or now.astimezone(SAO_PAULO_TZ)).date())
    now_day_start, _ = sao_paulo_day_bounds((to_sao_paulo(now) or now.astimezone(SAO_PAULO_TZ)).date())
    if end < now_day_start or start > now_day_end:
        return False, "daily_contract_outside_current_day"
    return True, "ok"


async def _claim_next_manual_release(
    *,
    device: dict,
    now: datetime,
) -> dict | None:
    db = get_db()
    await _expire_manual_release_commands(owner_id=device.get("owner_id"), now=now)
    pending = (
        await db.catraca_commands.find(
            {
                "owner_id": device["owner_id"],
                "command_type": {"$in": sorted(RELEASE_COMMAND_TYPES)},
                "status": "pending",
                "expires_at": {"$gt": now},
                "$or": [
                    {"device_id": None},
                    {"device_id": ""},
                    {"device_id": device["device_id"]},
                ],
            },
            {"_id": 0},
        )
        .sort("created_at", 1)
        .limit(5)
        .to_list(5)
    )
    for item in pending:
        cmd_id = str(item.get("cmd_id") or "").strip()
        if not cmd_id:
            continue
        result = await db.catraca_commands.update_one(
            {
                "cmd_id": cmd_id,
                "status": "pending",
                "command_type": {"$in": sorted(RELEASE_COMMAND_TYPES)},
            },
            {
                "$set": {
                    "status": "claimed",
                    "claimed_at": now,
                    "claimed_by_device_id": device["device_id"],
                    "updated_at": now,
                }
            },
        )
        if int(getattr(result, "modified_count", 0) or 0) > 0:
            claimed = await db.catraca_commands.find_one({"cmd_id": cmd_id}, {"_id": 0})
            return claimed
    return None


@router.post("/devices")
async def create_device(payload: dict, actor: dict = Depends(require_roles("OWNER", "MANAGER"))):
    db = get_db()
    now = datetime.now(UTC)
    raw_token = secrets.token_urlsafe(32)
    device_id = str(payload.get("device_id") or f"dev_{secrets.token_hex(6)}").strip()
    if not device_id:
        raise HTTPException(status_code=400, detail="device_id invalido")
    if await db.turnstile_devices.find_one({"device_id": device_id}, {"_id": 0, "device_id": 1}):
        raise HTTPException(status_code=409, detail="device_id ja cadastrado")

    device = {
        "device_id": device_id,
        "gym_id": actor["gym_id"],
        "owner_id": actor["owner_id"],
        "name": (payload.get("name") or "Gateway Toletus").strip()[:120],
        "token_hash": _hash_token(raw_token),
        "is_active": True,
        "invalid_auth_attempts": 0,
        "blocked_until": None,
        "last_seen_at": None,
        "created_at": now,
        "updated_at": now,
    }
    try:
        await db.turnstile_devices.insert_one(device)
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="device_id ja cadastrado") from exc
    return {"device_id": device["device_id"], "token": raw_token, "name": device["name"]}


@router.post("/devices/{device_id}/rotate-token")
async def rotate_device_token(
    device_id: str,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    now = datetime.now(UTC)
    new_token = secrets.token_urlsafe(32)
    result = await db.turnstile_devices.update_one(
        {"device_id": device_id, "owner_id": actor["owner_id"]},
        {
            "$set": {
                "token_hash": _hash_token(new_token),
                "invalid_auth_attempts": 0,
                "blocked_until": None,
                "updated_at": now,
            }
        },
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Dispositivo nao encontrado")
    return {"device_id": device_id, "token": new_token}


@router.get("/devices")
async def list_devices(actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION"))):
    db = get_db()
    return (
        await db.turnstile_devices.find(
            {"owner_id": actor["owner_id"]},
            {"_id": 0, "token_hash": 0},
        )
        .sort("created_at", -1)
        .to_list(200)
    )


@router.get("/control-state")
async def turnstile_control_state(
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    return await get_turnstile_control_state(
        owner_id=actor["owner_id"],
        gym_id=actor.get("gym_id"),
    )


@router.post("/control-state/action")
async def turnstile_control_action(
    payload: dict,
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    action = str(payload.get("action") or "").strip().lower()
    scope = payload.get("scope") or payload.get("target_scope") or "all"
    return await apply_turnstile_control_action(
        owner_id=actor["owner_id"],
        gym_id=actor.get("gym_id"),
        action=action,
        scope=scope,
        actor_id=actor.get("employee_id") or actor.get("owner_id"),
        actor_role=str(actor.get("role") or "").upper() or None,
    )


@router.post("/manual-releases")
async def create_manual_turnstile_release(
    payload: ManualReleaseCreateIn,
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    now = datetime.now(UTC)
    student = await db.students.find_one(
        {
            "owner_id": actor["owner_id"],
            "student_id": payload.student_id,
            "is_employee_shadow": {"$ne": True},
        },
        {"_id": 0},
    )
    if not student:
        raise HTTPException(status_code=404, detail="Aluno nao encontrado")

    try:
        student = await _refresh_student_contract_snapshot(student, now)
    except Exception as exc:  # pragma: no cover - resiliencia runtime
        log_event(
            "manual_release_contract_refresh_error",
            owner_id=actor.get("owner_id"),
            student_id=payload.student_id,
            error=str(exc),
        )

    allow_base, reason, details = _evaluate_student_access(student, now)
    if not allow_base:
        raise HTTPException(
            status_code=409,
            detail=f"Aluno nao esta apto para liberacao manual: {reason}",
        )

    latest_contract = await _load_latest_student_contract(
        owner_id=actor["owner_id"],
        student_id=payload.student_id,
    )
    daily_ok, daily_reason = _is_daily_contract_eligible(latest_contract, now=now)
    if not daily_ok:
        raise HTTPException(
            status_code=409,
            detail=f"Aluno nao se enquadra como diario elegivel: {daily_reason}",
        )

    release_direction = _normalize_direction(payload.direction)
    if release_direction not in MANUAL_RELEASE_DIRECTION_VALUES:
        raise HTTPException(status_code=400, detail="direction invalida")

    expires_at = now + timedelta(seconds=45)
    message = _manual_release_message(student.get("nome"), release_direction)
    source = _normalize_release_source(
        payload.source,
        default="frontend_operational_manual_release",
    )
    doc = {
        "cmd_id": f"cmd_{secrets.token_hex(6)}",
        "owner_id": actor["owner_id"],
        "gym_id": actor.get("gym_id"),
        "device_id": str(payload.device_id or "").strip() or None,
        "action": f"manual_release_{release_direction}",
        "target_scope": "students",
        "message": message,
        "status": "pending",
        "command_type": "manual_turnstile_release",
        "release_direction": release_direction,
        "source": source,
        "student_id": student["student_id"],
        "student_name": student.get("nome"),
        "contract_id": (latest_contract or {}).get("contract_id"),
        "reason": payload.reason,
        "actor_type": actor.get("actor_type", "owner"),
        "actor_role": str(actor.get("role") or "").upper() or None,
        "actor_id": actor.get("employee_id") or actor.get("owner_id"),
        "expires_at": expires_at,
        "eligibility_reason": daily_reason,
        "eligibility_snapshot": {
            "contract_status": (latest_contract or {}).get("contract_status"),
            "financial_status": (latest_contract or {}).get("financial_status"),
            "access_status": (latest_contract or {}).get("access_status"),
            "duration_unit": (latest_contract or {}).get("duration_unit"),
            "duration_value": (latest_contract or {}).get("duration_value"),
            "duration_days": (latest_contract or {}).get("duration_days"),
            "student_access_reason": reason,
            "student_access_detail": details,
        },
        "created_at": now,
        "updated_at": now,
    }
    await db.catraca_commands.insert_one(doc)
    await db.audit_logs.insert_one(
        {
            "owner_id": actor["owner_id"],
            "event": "turnstile.manual_release.created",
            "student_id": student["student_id"],
            "contract_id": (latest_contract or {}).get("contract_id"),
            "direction": release_direction,
            "reason": payload.reason,
            "device_id": str(payload.device_id or "").strip() or None,
            "source": source,
            "actor_id": actor.get("employee_id") or actor.get("owner_id"),
            "actor_role": str(actor.get("role") or "").upper() or None,
            "created_at": now,
        }
    )
    return {
        "cmd_id": doc["cmd_id"],
        "status": doc["status"],
        "direction": release_direction,
        "student_id": student["student_id"],
        "student_name": student.get("nome"),
        "contract_id": (latest_contract or {}).get("contract_id"),
        "expires_at": expires_at,
        "message": message,
        "source": source,
    }


@router.post("/quick-releases")
async def create_quick_turnstile_release(
    payload: QuickReleaseCreateIn,
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    now = datetime.now(UTC)
    release_direction = _normalize_direction(payload.direction)
    if release_direction not in MANUAL_RELEASE_DIRECTION_VALUES:
        raise HTTPException(status_code=400, detail="direction invalida")

    db = get_db()
    expires_at = now + timedelta(seconds=45)
    message = _quick_release_message(release_direction)
    source = _normalize_release_source(
        payload.source,
        default="frontend_operational_quick_release",
    )
    doc = {
        "cmd_id": f"cmd_{secrets.token_hex(6)}",
        "owner_id": actor["owner_id"],
        "gym_id": actor.get("gym_id"),
        "device_id": str(payload.device_id or "").strip() or None,
        "action": f"quick_release_{release_direction}",
        "target_scope": "operational",
        "message": message,
        "status": "pending",
        "command_type": "quick_turnstile_release",
        "release_direction": release_direction,
        "source": source,
        "student_id": None,
        "student_name": None,
        "contract_id": None,
        "reason": None,
        "actor_type": actor.get("actor_type", "owner"),
        "actor_role": str(actor.get("role") or "").upper() or None,
        "actor_id": actor.get("employee_id") or actor.get("owner_id"),
        "expires_at": expires_at,
        "created_at": now,
        "updated_at": now,
    }
    await db.catraca_commands.insert_one(doc)
    await db.audit_logs.insert_one(
        {
            "owner_id": actor["owner_id"],
            "gym_id": actor.get("gym_id"),
            "event": "turnstile.quick_release.created",
            "direction": release_direction,
            "device_id": str(payload.device_id or "").strip() or None,
            "source": source,
            "actor_type": actor.get("actor_type", "owner"),
            "actor_id": actor.get("employee_id") or actor.get("owner_id"),
            "actor_role": str(actor.get("role") or "").upper() or None,
            "created_at": now,
        }
    )
    return {
        "cmd_id": doc["cmd_id"],
        "status": doc["status"],
        "direction": release_direction,
        "expires_at": expires_at,
        "message": message,
        "source": source,
    }


@router.post("/devices/{device_id}/manual-releases/pull")
async def pull_manual_turnstile_release(
    device_id: str,
    request: Request,
    x_device_token: str | None = Header(default=None),
):
    source_ip = get_client_ip(request)
    now = datetime.now(UTC)
    device = await _authenticate_gateway_device_channel(
        device_id=device_id,
        device_token_header=x_device_token,
        source_ip=source_ip,
    )
    command = await _claim_next_manual_release(device=device, now=now)
    if not command:
        return Response(status_code=204)
    return {
        "release_id": command["cmd_id"],
        "direction": command.get("release_direction"),
        "message": command.get("message") or "LIBERADO",
        "reason": command.get("reason"),
        "student_id": command.get("student_id"),
        "student_name": command.get("student_name"),
        "expires_at": command.get("expires_at"),
        "source": command.get("source"),
        "command_type": command.get("command_type"),
    }


@router.post("/devices/{device_id}/manual-releases/{release_id}/ack")
async def acknowledge_manual_turnstile_release(
    device_id: str,
    release_id: str,
    payload: dict,
    request: Request,
    x_device_token: str | None = Header(default=None),
):
    db = get_db()
    source_ip = get_client_ip(request)
    now = datetime.now(UTC)
    await _authenticate_gateway_device_channel(
        device_id=device_id,
        device_token_header=x_device_token,
        source_ip=source_ip,
    )
    current = await db.catraca_commands.find_one(
        {"cmd_id": release_id, "command_type": {"$in": sorted(RELEASE_COMMAND_TYPES)}},
        {"_id": 0},
    )
    if not current:
        raise HTTPException(status_code=404, detail="Liberacao nao encontrada")
    if str(current.get("claimed_by_device_id") or "") not in {"", device_id}:
        raise HTTPException(status_code=409, detail="Liberacao vinculada a outro dispositivo")

    next_status = str(payload.get("status") or "").strip().lower()
    if next_status not in {"executed", "failed", "expired"}:
        next_status = "executed" if bool(payload.get("success", True)) else "failed"

    await db.catraca_commands.update_one(
        {"cmd_id": release_id, "command_type": {"$in": sorted(RELEASE_COMMAND_TYPES)}},
        {
            "$set": {
                "status": next_status,
                "acknowledged_at": now,
                "executed_at": now if next_status == "executed" else None,
                "failed_at": now if next_status == "failed" else None,
                "expired_at": now if next_status == "expired" else current.get("expired_at"),
                "acknowledged_by_device_id": device_id,
                "error": str(payload.get("error") or "").strip() or None,
                "updated_at": now,
            }
        },
    )
    return {"release_id": release_id, "status": next_status}


@router.post("/decision")
async def turnstile_decision(
    payload: dict,
    request: Request,
    x_device_token: str | None = Header(default=None),
):
    db = get_db()
    source_ip = get_client_ip(request)
    device, normalized = await _authenticate_gateway_request(
        payload,
        device_token_header=x_device_token,
        source_ip=source_ip,
    )
    now = datetime.now(UTC)
    event_direction = _normalize_direction(payload.get("direction") or normalized.get("direction"))
    control_state = await get_turnstile_control_state(
        owner_id=device["owner_id"],
        gym_id=device.get("gym_id"),
    )

    subscription = await db.subscriptions.find_one({"owner_id": device["owner_id"]}, {"_id": 0})
    if not subscription_allows_login(subscription):
        reason = "academy_subscription_inactive"
        details = {
            "rule": "owner_subscription",
            "owner_id": device["owner_id"],
            "requested_direction": event_direction,
        }
        await db.access_logs.insert_one(
            {
                "access_id": f"acc_{secrets.token_hex(6)}",
                "gym_id": device["gym_id"],
                "owner_id": device["owner_id"],
                "device_id": normalized["device_id"],
                "method": normalized["method"],
                "credential": normalized["credential"],
                "direction": event_direction,
                "decision": "deny",
                "autorizado": False,
                "motivo": reason,
                "reason": reason,
                "reason_detail": details,
                "allow_entry": False,
                "allow_exit": False,
                "timestamp": now,
                "created_at": now,
            }
        )
        log_event(
            "turnstile_access_decision",
            decision="deny",
            reason=reason,
            owner_id=device["owner_id"],
            device_id=device["device_id"],
        )
        return {
            "allow": False,
            "allow_entry": False,
            "allow_exit": False,
            "direction": event_direction if event_direction != DIRECTION_UNKNOWN else DIRECTION_ENTRY,
            "command_direction": event_direction if event_direction != DIRECTION_UNKNOWN else None,
            "message": "Assinatura da academia inativa",
            "beep": 2,
            "led": "red",
            "ttl": 3,
        }

    credential_query = _credential_query_for_method(
        owner_id=device["owner_id"],
        method=normalized["method"],
        credential=normalized["credential"],
    )

    student = None
    if credential_query:
        student = await db.students.find_one(
            credential_query,
            {"_id": 0},
        )

    employee = None
    owner_account = None
    allow_base = False
    allow_now = False
    allow_entry = False
    allow_exit = False
    reason = "credential_not_found"
    details: dict = {"rule": "credential_match"}
    subject_type = None
    subject_id = None
    subject_name = None
    subject_role = None

    if not str(normalized["credential"] or "").strip():
        reason = "credential_required"
        details = {
            "rule": "credential_required",
            "expected_methods": ["biometry", "rfid", "barcode", "keypad"],
            "received_method": normalized["method"],
            "requested_direction": event_direction,
        }
    elif credential_query is None:
        reason = "credential_required"
        details = {
            "rule": "credential_required",
            "expected_methods": ["biometry", "rfid", "barcode", "keypad"],
            "received_method": normalized["method"],
            "requested_direction": event_direction,
        }
    elif student:
        try:
            student = await _refresh_student_contract_snapshot(student, now)
        except Exception as exc:  # pragma: no cover - resiliencia em runtime
            log_event(
                "turnstile_student_contract_refresh_error",
                owner_id=device.get("owner_id"),
                student_id=student.get("student_id"),
                error=str(exc),
            )
        allow_base, reason, details = _evaluate_student_access(student, now)
        subject_type = "student"
        subject_id = student.get("student_id")
        subject_name = student.get("nome") or student.get("name")
        subject_role = "STUDENT"
    else:
        employee = await db.employees.find_one(
            credential_query,
            {"_id": 0, "password_hash": 0},
        )
        if employee:
            allow_base, reason, details = _evaluate_employee_access(employee, now)
            subject_type = "employee"
            subject_id = employee.get("employee_id")
            subject_name = employee.get("name")
            subject_role = (employee.get("role") or "").upper() or None
        else:
            owner_account = await db.owners.find_one(
                credential_query,
                {"_id": 0, "password_hash": 0},
            )
            if owner_account:
                allow_base, reason, details = _evaluate_owner_access(owner_account, now)
                subject_type = "owner"
                subject_id = owner_account.get("owner_id")
                subject_name = owner_account.get("name")
                subject_role = "OWNER"

    if allow_base:
        subject_controls = _normalize_subject_controls(control_state.get("subject_controls"))
        subject_control = subject_controls.get(subject_type or "")
        if isinstance(subject_control, dict):
            allow_entry = not bool(subject_control.get("entry_locked", False))
            allow_exit = not bool(subject_control.get("exit_locked", False))
        else:
            allow_entry = True
            allow_exit = True

        allow_now = _resolve_directional_allowance(event_direction, allow_entry, allow_exit)
        if not allow_now:
            reason = "turnstile_direction_locked"
            details = {
                "rule": "turnstile_control_state",
                "requested_direction": event_direction,
                "entry_locked": not allow_entry,
                "exit_locked": not allow_exit,
                "scope_subject_type": subject_type,
                "updated_at": (
                    control_state.get("updated_at").isoformat()
                    if isinstance(control_state.get("updated_at"), datetime)
                    else control_state.get("updated_at")
                ),
                "updated_role": control_state.get("updated_role"),
            }
    else:
        allow_entry = False
        allow_exit = False
        allow_now = False

    student_name = student.get("nome") if student else None
    employee_name = employee.get("name") if employee else None
    owner_name = owner_account.get("name") if owner_account else None

    await db.access_logs.insert_one(
        {
            "access_id": f"acc_{secrets.token_hex(6)}",
            "gym_id": device["gym_id"],
            "owner_id": device["owner_id"],
            "device_id": normalized["device_id"],
            "method": normalized["method"],
            "credential": normalized["credential"],
            "direction": event_direction,
            "subject_type": subject_type,
            "subject_id": subject_id,
            "subject_name": subject_name,
            "subject_role": subject_role,
            "student_id": student.get("student_id") if student else None,
            "student_name": student_name,
            "employee_id": employee.get("employee_id") if employee else None,
            "employee_name": employee_name,
            "owner_name": owner_name,
            "decision": "allow" if allow_now else "deny",
            "autorizado": bool(allow_now),
            "tipo": subject_type or normalized["method"],
            "motivo": reason,
            "reason": reason,
            "reason_detail": details,
            "allow_entry": allow_entry,
            "allow_exit": allow_exit,
            "timestamp": now,
            "created_at": now,
        }
    )
    if allow_now and student and subject_type == "student":
        await touch_student_usage(
            db,
            owner_id=device["owner_id"],
            student_id=student["student_id"],
            usage_at=now,
            source="catraca",
            updated_at=now,
        )

    log_event(
        "turnstile_access_decision",
        decision="allow" if allow_now else "deny",
        reason=reason,
        owner_id=device["owner_id"],
        device_id=device["device_id"],
        subject_type=subject_type,
        subject_id=subject_id,
        direction=event_direction,
        allow_entry=allow_entry,
        allow_exit=allow_exit,
    )

    if allow_now:
        message = "Acesso liberado"
    elif reason == "credential_required":
        message = "Use uma credencial valida para entrar e sair"
    elif reason == "turnstile_direction_locked":
        message = "Fluxo travado para esta direcao"
    else:
        message = "Acesso negado"

    return {
        "allow": allow_now,
        "allow_entry": allow_entry,
        "allow_exit": allow_exit,
        "direction": event_direction if event_direction != DIRECTION_UNKNOWN else DIRECTION_ENTRY,
        "command_direction": event_direction if event_direction != DIRECTION_UNKNOWN else None,
        "message": message,
        "beep": 1 if allow_now else 2,
        "led": "green" if allow_now else "red",
        "ttl": 3,
    }


@router.post("/events")
async def turnstile_event(
    payload: dict,
    request: Request,
    x_device_token: str | None = Header(default=None),
):
    db = get_db()
    source_ip = get_client_ip(request)
    device, normalized = await _authenticate_gateway_request(
        payload,
        device_token_header=x_device_token,
        source_ip=source_ip,
    )
    now = datetime.now(UTC)

    event = {
        "event_id": payload.get("event_id") or f"evt_{secrets.token_hex(6)}",
        "owner_id": device["owner_id"],
        "gym_id": device["gym_id"],
        "device_id": normalized["device_id"],
        "method": normalized["method"],
        "credential": normalized["credential"],
        "direction": _normalize_direction(payload.get("direction") or normalized.get("direction")),
        "decision": payload.get("decision"),
        "message": payload.get("message"),
        "reason": str(payload.get("reason") or "").strip().lower() or None,
        "reason_detail": payload.get("reason_detail"),
        "allow_entry": payload.get("allow_entry"),
        "allow_exit": payload.get("allow_exit"),
        "release_direction": payload.get("release_direction"),
        "event_kind": payload.get("event_kind"),
        "event_type": payload.get("event_type"),
        "raw": payload.get("raw"),
        "created_at": now,
    }
    await db.turnstile_events.insert_one(event)

    if str(event.get("event_type") or "").strip().lower() == "passage":
        decision = _coerce_optional_bool(payload.get("decision"))
        if decision is False:
            reason = event.get("reason") or "passage_without_authorization"
            details = event.get("reason_detail")
            if not isinstance(details, dict):
                details = {
                    "rule": "passage_without_authorization",
                    "requested_direction": event.get("direction"),
                    "message": event.get("message"),
                }
            await db.access_logs.insert_one(
                {
                    "access_id": f"acc_{secrets.token_hex(6)}",
                    "gym_id": device["gym_id"],
                    "owner_id": device["owner_id"],
                    "device_id": normalized["device_id"],
                    "method": normalized["method"],
                    "credential": normalized["credential"],
                    "direction": event.get("direction"),
                    "subject_type": None,
                    "subject_id": None,
                    "subject_name": None,
                    "subject_role": None,
                    "student_id": None,
                    "student_name": None,
                    "employee_id": None,
                    "employee_name": None,
                    "owner_name": None,
                    "decision": "deny",
                    "autorizado": False,
                    "tipo": "passage",
                    "motivo": reason,
                    "reason": reason,
                    "reason_detail": details,
                    "allow_entry": False,
                    "allow_exit": False,
                    "timestamp": now,
                    "created_at": now,
                }
            )
            log_event(
                "turnstile_passage_without_authorization",
                owner_id=device["owner_id"],
                device_id=normalized["device_id"],
                direction=event.get("direction"),
                reason=reason,
            )
    return {"message": "Evento recebido"}


@router.get("/access-logs")
async def list_access_logs(
    limit: int = Query(default=100, ge=1, le=500),
    decision: str = "",
    reason: str = "",
    subject_type: str = "",
    device_id: str = "",
    since_minutes: int = Query(default=0, ge=0, le=10080),
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION", "TRAINER")),
):
    db = get_db()
    query: dict = {"owner_id": actor["owner_id"]}
    normalized_decision = str(decision or "").strip().lower()
    if normalized_decision in {"allow", "deny"}:
        query["decision"] = normalized_decision
    normalized_reason = str(reason or "").strip().lower()
    if normalized_reason:
        query["reason"] = normalized_reason
    normalized_subject_type = str(subject_type or "").strip().lower()
    if normalized_subject_type in {"student", "employee", "owner"}:
        query["subject_type"] = normalized_subject_type
    normalized_device_id = str(device_id or "").strip()
    if normalized_device_id:
        query["device_id"] = normalized_device_id
    if since_minutes > 0:
        query["created_at"] = {"$gte": datetime.now(UTC) - timedelta(minutes=since_minutes)}

    rows = (
        await db.access_logs.find(query, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )
    return [_sanitize_access_log_output(item) for item in rows]


@router.get("/access-summary")
async def get_access_summary(
    window_minutes: int = Query(default=60, ge=5, le=1440),
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    owner_id = actor["owner_id"]
    now = datetime.now(UTC)
    window_start = now - timedelta(minutes=window_minutes)
    day_start = now - timedelta(hours=24)
    online_cutoff = now - timedelta(minutes=5)

    async def _count_window(start: datetime) -> dict:
        base = {"owner_id": owner_id, "created_at": {"$gte": start}}
        total = await db.access_logs.count_documents(base)
        allowed = await db.access_logs.count_documents({**base, "decision": "allow"})
        denied = await db.access_logs.count_documents({**base, "decision": "deny"})
        return {"total": int(total), "allow": int(allowed), "deny": int(denied)}

    window_stats = await _count_window(window_start)
    day_stats = await _count_window(day_start)

    deny_reasons_raw = (
        await db.access_logs.aggregate(
            [
                {
                    "$match": {
                        "owner_id": owner_id,
                        "created_at": {"$gte": day_start},
                        "decision": "deny",
                    }
                },
                {"$group": {"_id": "$reason", "count": {"$sum": 1}}},
                {"$sort": {"count": -1}},
                {"$limit": 5},
            ]
        ).to_list(5)
    )
    deny_reasons = [
        {"reason": str(item.get("_id") or "unknown"), "count": int(item.get("count") or 0)}
        for item in deny_reasons_raw
    ]

    devices = (
        await db.turnstile_devices.find(
            {"owner_id": owner_id},
            {"_id": 0, "device_id": 1, "last_seen_at": 1, "blocked_until": 1},
        ).to_list(300)
    )
    devices_online_5m = sum(
        1
        for item in devices
        if (
            (last_seen := _coerce_datetime_utc(item.get("last_seen_at")))
            and last_seen >= online_cutoff
        )
    )
    devices_blocked = sum(
        1
        for item in devices
        if (
            (blocked_until := _coerce_datetime_utc(item.get("blocked_until")))
            and blocked_until > now
        )
    )

    grace_students = await db.students.count_documents(
        {
            "owner_id": owner_id,
            "status": "ativo",
            "access_blocked": {"$ne": True},
            "contract_access_status": "grace_period",
        }
    )
    blocked_students = await db.students.count_documents(
        {
            "owner_id": owner_id,
            "$or": [
                {"access_blocked": True},
                {"status": {"$ne": "ativo"}},
                {"contract_access_status": {"$in": ["blocked", "suspended"]}},
            ],
        }
    )
    gateway_auth_failures_1h = await db.turnstile_security_events.count_documents(
        {
            "owner_id": owner_id,
            "event": "auth_failure",
            "created_at": {"$gte": now - timedelta(hours=1)},
        }
    )

    return {
        "generated_at": now,
        "window_minutes": window_minutes,
        "window": window_stats,
        "last_24h": day_stats,
        "deny_reasons": deny_reasons,
        "grace_students": int(grace_students),
        "blocked_students": int(blocked_students),
        "gateway_auth_failures_1h": int(gateway_auth_failures_1h),
        "devices": {
            "total": len(devices),
            "online_5m": int(devices_online_5m),
            "blocked": int(devices_blocked),
        },
    }
