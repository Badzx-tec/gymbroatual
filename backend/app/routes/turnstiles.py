import hashlib
import hmac
import secrets
from datetime import UTC, date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from app.core.config import get_settings
from app.core.deps import require_roles
from app.db.mongo import get_db
from app.services.subscription import subscription_allows_login

router = APIRouter()

ALLOWED_METHODS = {"rfid", "keypad", "biometry", "passage"}


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


async def _register_nonce(device_id: str, nonce: str, now: datetime) -> None:
    db = get_db()
    settings = get_settings()
    expires_at = now + timedelta(seconds=settings.gateway_nonce_ttl_seconds)
    try:
        await db.turnstile_nonces.insert_one(
            {
                "device_id": device_id,
                "nonce": nonce,
                "created_at": now,
                "expires_at": expires_at,
            }
        )
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=401, detail="Nonce reutilizado") from exc


async def _authenticate_gateway_request(payload: dict) -> tuple[dict, dict]:
    db = get_db()
    settings = get_settings()

    device_id = str(payload.get("device_id") or "").strip()
    method = _normalize_method(payload.get("method", ""))
    credential = str(payload.get("credential", ""))
    timestamp = str(payload.get("timestamp", ""))
    nonce = str(payload.get("nonce", ""))
    signature = str(payload.get("signature", ""))
    token = str(payload.get("device_token", ""))

    if not device_id or not method or not timestamp or not nonce or not signature or not token:
        raise HTTPException(status_code=401, detail="Payload do gateway incompleto")
    if method not in ALLOWED_METHODS:
        raise HTTPException(status_code=401, detail="Metodo invalido")

    device = await db.turnstile_devices.find_one(
        {"device_id": device_id, "is_active": True},
        {"_id": 0},
    )
    if not device:
        raise HTTPException(status_code=401, detail="Dispositivo invalido")
    if _hash_token(token) != device.get("token_hash"):
        raise HTTPException(status_code=401, detail="Token invalido")

    parsed_timestamp = _parse_timestamp_utc(timestamp)
    now = datetime.now(UTC)
    skew = abs((now - parsed_timestamp).total_seconds())
    if skew > settings.gateway_max_skew_seconds:
        raise HTTPException(status_code=401, detail="Timestamp fora da janela permitida")

    expected = hmac.new(
        token.encode("utf-8"),
        _signature_payload(method, credential, timestamp, nonce),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Assinatura invalida")

    await _register_nonce(device_id=device_id, nonce=nonce, now=now)
    await db.turnstile_devices.update_one(
        {"device_id": device_id},
        {"$set": {"last_seen_at": now, "updated_at": now}},
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
        "last_seen_at": None,
        "created_at": now,
        "updated_at": now,
    }
    try:
        await db.turnstile_devices.insert_one(device)
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="device_id ja cadastrado") from exc
    return {
        "device_id": device["device_id"],
        "token": raw_token,
        "name": device["name"],
    }


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
async def turnstile_decision(payload: dict):
    db = get_db()
    device, normalized = await _authenticate_gateway_request(payload)
    now = datetime.now(UTC)

    subscription = await db.subscriptions.find_one({"owner_id": device["owner_id"]}, {"_id": 0})
    if not subscription_allows_login(subscription):
        await db.access_logs.insert_one(
            {
                "access_id": f"acc_{secrets.token_hex(6)}",
                "gym_id": device["gym_id"],
                "owner_id": device["owner_id"],
                "device_id": normalized["device_id"],
                "method": normalized["method"],
                "credential": normalized["credential"],
                "decision": "deny",
                "reason": "academy_subscription_inactive",
                "created_at": now,
            }
        )
        return {
            "allow": False,
            "direction": "entry",
            "message": "Assinatura da academia inativa",
            "beep": 2,
            "led": "red",
            "ttl": 3,
        }

    student = await db.students.find_one(
        {
            "owner_id": device["owner_id"],
            "$or": [
                {"tag_rfid": normalized["credential"]},
                {"biometria_id": normalized["credential"]},
                {"keypad_code": normalized["credential"]},
                {"matricula": normalized["credential"]},
            ],
        },
        {"_id": 0},
    )

    allow = False
    reason = "student_not_found"
    if student:
        if student.get("status", "ativo") != "ativo":
            reason = "student_inactive"
        else:
            plan_until = _coerce_datetime_utc(
                student.get("plano_validade")
                or student.get("plan_expires_at")
                or student.get("subscription_end")
            )
            if plan_until and plan_until < now:
                reason = "plan_expired"
            else:
                allow = True
                reason = "ok"

    await db.access_logs.insert_one(
        {
            "access_id": f"acc_{secrets.token_hex(6)}",
            "gym_id": device["gym_id"],
            "owner_id": device["owner_id"],
            "device_id": normalized["device_id"],
            "method": normalized["method"],
            "credential": normalized["credential"],
            "decision": "allow" if allow else "deny",
            "reason": reason,
            "created_at": now,
        }
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
async def turnstile_event(payload: dict):
    db = get_db()
    device, normalized = await _authenticate_gateway_request(payload)
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
    limit: int = 100,
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    return (
        await db.access_logs.find({"owner_id": actor["owner_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )
