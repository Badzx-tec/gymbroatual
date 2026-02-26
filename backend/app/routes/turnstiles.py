import hashlib
import hmac
import secrets
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pymongo.errors import DuplicateKeyError

from app.core.config import get_settings
from app.core.deps import require_roles
from app.core.http import get_client_ip
from app.core.time import UTC
from app.db.mongo import get_db
from app.services.observability import log_event
from app.services.student_contracts import refresh_contract_state
from app.services.subscription import subscription_allows_login

router = APIRouter()

ALLOWED_METHODS = {"rfid", "keypad", "biometry", "passage"}
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


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _signature_payload(method: str, credential: str, timestamp: str, nonce: str) -> bytes:
    return f"{method}:{credential}:{timestamp}:{nonce}".encode("utf-8")


def _normalize_method(method: str) -> str:
    normalized = (method or "").strip().lower()
    if normalized == "biometria":
        return "biometry"
    return normalized


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
        "timestamp": parsed_timestamp,
        "nonce": nonce,
    }


@router.post("/devices")
async def create_device(payload: dict, actor: dict = Depends(require_roles("OWNER", "MANAGER"))):
    db = get_db()
    now = datetime.now(UTC)
    raw_token = secrets.token_urlsafe(32)
    device_id = str(payload.get("device_id") or f"dev_{secrets.token_hex(6)}").strip()
    if not device_id:
        raise HTTPException(status_code=400, detail="device_id invalido")

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

    subscription = await db.subscriptions.find_one({"owner_id": device["owner_id"]}, {"_id": 0})
    if not subscription_allows_login(subscription):
        reason = "academy_subscription_inactive"
        details = {"rule": "owner_subscription", "owner_id": device["owner_id"]}
        await db.access_logs.insert_one(
            {
                "access_id": f"acc_{secrets.token_hex(6)}",
                "gym_id": device["gym_id"],
                "owner_id": device["owner_id"],
                "device_id": normalized["device_id"],
                "method": normalized["method"],
                "credential": normalized["credential"],
                "decision": "deny",
                "reason": reason,
                "reason_detail": details,
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
            "direction": "entry",
            "message": "Assinatura da academia inativa",
            "beep": 2,
            "led": "red",
            "ttl": 3,
        }

    credential_query = {
        "owner_id": device["owner_id"],
        "$or": [
            {"tag_rfid": normalized["credential"]},
            {"biometria_id": normalized["credential"]},
            {"keypad_code": normalized["credential"]},
            {"matricula": normalized["credential"]},
        ],
    }

    student = await db.students.find_one(
        credential_query,
        {"_id": 0},
    )

    employee = None
    allow = False
    reason = "credential_not_found"
    details: dict = {"rule": "credential_match"}
    subject_type = None
    subject_id = None

    if student:
        try:
            student = await _refresh_student_contract_snapshot(student, now)
        except Exception as exc:  # pragma: no cover - resiliencia em runtime
            log_event(
                "turnstile_student_contract_refresh_error",
                owner_id=device.get("owner_id"),
                student_id=student.get("student_id"),
                error=str(exc),
            )
        allow, reason, details = _evaluate_student_access(student, now)
        subject_type = "student"
        subject_id = student.get("student_id")
    else:
        employee = await db.employees.find_one(
            credential_query,
            {"_id": 0, "password_hash": 0},
        )
        if employee:
            allow, reason, details = _evaluate_employee_access(employee, now)
            subject_type = "employee"
            subject_id = employee.get("employee_id")

    await db.access_logs.insert_one(
        {
            "access_id": f"acc_{secrets.token_hex(6)}",
            "gym_id": device["gym_id"],
            "owner_id": device["owner_id"],
            "device_id": normalized["device_id"],
            "method": normalized["method"],
            "credential": normalized["credential"],
            "subject_type": subject_type,
            "subject_id": subject_id,
            "student_id": student.get("student_id") if student else None,
            "employee_id": employee.get("employee_id") if employee else None,
            "decision": "allow" if allow else "deny",
            "reason": reason,
            "reason_detail": details,
            "created_at": now,
        }
    )

    log_event(
        "turnstile_access_decision",
        decision="allow" if allow else "deny",
        reason=reason,
        owner_id=device["owner_id"],
        device_id=device["device_id"],
        subject_type=subject_type,
        subject_id=subject_id,
    )

    return {
        "allow": allow,
        "direction": "entry",
        "message": "Acesso liberado" if allow else "Acesso negado",
        "beep": 1 if allow else 2,
        "led": "green" if allow else "red",
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
        "decision": payload.get("decision"),
        "message": payload.get("message"),
        "raw": payload.get("raw"),
        "created_at": now,
    }
    await db.turnstile_events.insert_one(event)
    return {"message": "Evento recebido"}


@router.get("/access-logs")
async def list_access_logs(
    limit: int = Query(default=100, ge=1, le=500),
    decision: str = "",
    reason: str = "",
    subject_type: str = "",
    device_id: str = "",
    since_minutes: int = Query(default=0, ge=0, le=10080),
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
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
    if normalized_subject_type in {"student", "employee"}:
        query["subject_type"] = normalized_subject_type
    normalized_device_id = str(device_id or "").strip()
    if normalized_device_id:
        query["device_id"] = normalized_device_id
    if since_minutes > 0:
        query["created_at"] = {"$gte": datetime.now(UTC) - timedelta(minutes=since_minutes)}

    return (
        await db.access_logs.find(query, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )


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
