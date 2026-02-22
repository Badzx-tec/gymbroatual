import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException

from app.core.deps import require_roles
from app.core.security import hash_password
from app.db.mongo import get_db

router = APIRouter()

ALLOWED_ROLES = {"OWNER", "MANAGER", "RECEPTION", "TRAINER"}


@router.post("/invites")
async def create_invite(payload: dict, actor: dict = Depends(require_roles("OWNER", "MANAGER"))):
    role = (payload.get("role") or "").upper()
    email = (payload.get("email") or "").strip().lower()
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
    email = (payload.get("email") or "").strip().lower()
    role = (payload.get("role") or "").upper()
    if role not in ALLOWED_ROLES - {"OWNER"}:
        raise HTTPException(status_code=400, detail="Role invalida")
    if not email or not payload.get("name"):
        raise HTTPException(status_code=400, detail="Nome e email obrigatorios")

    if await db.employees.find_one({"email": email, "owner_id": actor["owner_id"]}, {"_id": 0}):
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
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    await db.employees.insert_one(employee)
    result = {k: v for k, v in employee.items() if k != "password_hash"}
    result["temp_password"] = raw_password
    return result


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
