from collections.abc import Callable

from fastapi import Depends, Header, HTTPException, status

from app.core.config import get_settings
from app.core.security import safe_jwt_decode
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


async def get_current_actor(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Nao autenticado")

    token = authorization.split(" ", 1)[1]
    payload = safe_jwt_decode(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalido")

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

    owner = await db.owners.find_one({"owner_id": payload.get("sub")}, {"_id": 0})
    if not owner:
        raise HTTPException(status_code=401, detail="Usuario nao encontrado")
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
