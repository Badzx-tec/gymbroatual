from collections.abc import Callable
from datetime import datetime

from fastapi import Depends, Header, HTTPException, Request, status

from app.core.config import get_settings
from app.core.security import safe_jwt_decode
from app.core.time import UTC
from app.db.mongo import get_db
from app.services.subscription import subscription_allows_login


async def _resolve_owner_gym_id(db, owner: dict) -> str | None:
    gym_id = owner.get("gym_id")
    if gym_id:
        return gym_id

    gym = await db.gyms.find_one({"owner_id": owner["owner_id"]}, {"_id": 0, "gym_id": 1})
    resolved = (gym or {}).get("gym_id")
    if not resolved:
        return None

    owner["gym_id"] = resolved
    await db.owners.update_one(
        {"owner_id": owner["owner_id"]},
        {"$set": {"gym_id": resolved}},
    )
    return resolved


def _coerce_datetime_utc(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    return None


def _ensure_session_not_revoked(payload: dict, actor: dict) -> None:
    revoked_at = _coerce_datetime_utc(actor.get("session_revoked_at"))
    if revoked_at is None:
        return
    iat = payload.get("iat")
    if not isinstance(iat, (int, float)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalido")
    issued_at = datetime.fromtimestamp(float(iat), tz=UTC)
    if issued_at <= revoked_at:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sessao expirada. Faca login novamente.",
        )
async def get_current_actor(
    request: Request,
    authorization: str | None = Header(default=None),
) -> dict:
    settings = get_settings()
    if not isinstance(authorization, str):
        authorization = None
    token: str | None = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
    else:
        cookie_token = request.cookies.get(settings.session_cookie_name)
        if cookie_token:
            if request.method.upper() not in {"GET", "HEAD", "OPTIONS"} and request.url.path != (
                f"{settings.api_prefix}/auth/logout"
            ):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Sessao precisa ser renovada. Atualize a pagina.",
                    headers={"X-Error-Code": "AUTH_COOKIE_RENEWAL_REQUIRED"},
                )
            token = cookie_token

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Nao autenticado")

    payload = safe_jwt_decode(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalido",
            headers={"X-Error-Code": "AUTH_INVALID_TOKEN"},
        )

    db = get_db()
    actor_type = payload.get("actor_type", "owner")

    if actor_type == "super_admin":
        settings = get_settings()
        configured_email = (settings.super_admin_email or "").strip().lower()
        token_email = str(payload.get("email") or payload.get("sub") or "").strip().lower()
        if not configured_email or token_email != configured_email:
            raise HTTPException(status_code=401, detail="Super admin invalido")
        return {
            "actor_type": "super_admin",
            "role": "SUPER_ADMIN",
            "super_admin_email": configured_email,
            "name": settings.super_admin_name,
            "email": configured_email,
        }

    if actor_type == "employee":
        actor = await db.employees.find_one(
            {"employee_id": payload.get("sub"), "is_active": True}, {"_id": 0}
        )
        if not actor:
            raise HTTPException(status_code=401, detail="Funcionario nao encontrado")
        _ensure_session_not_revoked(payload, actor)
        actor["actor_type"] = "employee"
        actor["owner_id"] = actor.get("owner_id") or payload.get("owner_id")
        actor["gym_id"] = actor.get("gym_id") or payload.get("gym_id")
        if not actor["gym_id"] and actor.get("owner_id"):
            gym = await db.gyms.find_one({"owner_id": actor["owner_id"]}, {"_id": 0, "gym_id": 1})
            actor["gym_id"] = (gym or {}).get("gym_id")
        if not actor["gym_id"]:
            raise HTTPException(status_code=409, detail="Academia nao vinculada ao funcionario")
        actor["role"] = actor.get("role") or payload.get("role", "RECEPTION")
        return actor

    if actor_type == "student":
        actor = await db.students.find_one(
            {
                "student_id": payload.get("sub"),
                "is_employee_shadow": {"$ne": True},
                "auth_login_enabled": {"$ne": False},
            },
            {"_id": 0, "password_hash": 0},
        )
        if not actor:
            raise HTTPException(status_code=401, detail="Aluno nao encontrado")
        _ensure_session_not_revoked(payload, actor)
        actor["actor_type"] = "student"
        actor["student_id"] = actor.get("student_id") or payload.get("sub")
        actor["owner_id"] = actor.get("owner_id") or payload.get("owner_id")
        actor["gym_id"] = actor.get("gym_id") or payload.get("gym_id")
        if not actor["gym_id"] and actor.get("owner_id"):
            gym = await db.gyms.find_one({"owner_id": actor["owner_id"]}, {"_id": 0, "gym_id": 1})
            actor["gym_id"] = (gym or {}).get("gym_id")
        if not actor["owner_id"]:
            raise HTTPException(status_code=409, detail="Academia nao vinculada ao aluno")
        actor["role"] = "STUDENT"
        return actor

    owner = await db.owners.find_one({"owner_id": payload.get("sub")}, {"_id": 0})
    if not owner:
        raise HTTPException(status_code=401, detail="Usuario nao encontrado")
    _ensure_session_not_revoked(payload, owner)
    if not await _resolve_owner_gym_id(db, owner):
        raise HTTPException(status_code=409, detail="Academia nao vinculada ao usuario")
    owner["actor_type"] = "owner"
    owner["role"] = "OWNER"
    return owner


async def require_active_subscription(actor: dict = Depends(get_current_actor)) -> dict:
    if actor.get("actor_type") == "super_admin":
        return actor

    db = get_db()
    subscription = await db.subscriptions.find_one({"owner_id": actor["owner_id"]}, {"_id": 0})
    if not subscription_allows_login(subscription):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Assinatura inativa",
            headers={"X-Error-Code": "PAYMENT_REQUIRED"},
        )
    return actor


def require_roles(*allowed_roles: str) -> Callable:
    async def dependency(actor: dict = Depends(require_active_subscription)) -> dict:
        role = actor.get("role", "OWNER").upper()
        if role not in {r.upper() for r in allowed_roles}:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente"
            )
        return actor

    return dependency


def require_admin_actor() -> Callable:
    async def dependency(actor: dict = Depends(require_active_subscription)) -> dict:
        actor_type = str(actor.get("actor_type") or "").lower()
        if actor_type == "student":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Area administrativa restrita"
            )
        if actor_type == "super_admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Use o painel da plataforma"
            )
        return actor

    return dependency


async def require_student_actor(actor: dict = Depends(require_active_subscription)) -> dict:
    if str(actor.get("actor_type") or "").lower() != "student":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Area do aluno restrita")
    return actor
