import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.config import get_settings
from app.core.deps import get_current_actor
from app.core.http import get_client_ip
from app.core.rate_limit import enforce_rate_limit
from app.core.security import (
    create_access_token,
    hash_password,
    verification_code_hash,
    verify_password,
)
from app.db.mongo import get_db
from app.models.auth import (
    LoginIn,
    OwnerOut,
    RegisterIn,
    VerifyConfirmIn,
    VerifyStartIn,
)
from app.services.email import send_email_code
from app.services.subscription import initial_subscription, subscription_allows_login

router = APIRouter()


def _owner_out(owner: dict) -> OwnerOut:
    return OwnerOut(
        owner_id=owner["owner_id"],
        name=owner["name"],
        email=owner["email"],
        email_verified=owner.get("email_verified", False),
        gym_id=owner["gym_id"],
    )


async def _enforce_auth_rate_limit(
    request: Request, email: str, *, scope: str, limit: int, window_seconds: int
) -> None:
    client_ip = get_client_ip(request)
    await enforce_rate_limit(
        scope=scope,
        key=f"{client_ip}:{email}",
        limit=limit,
        window_seconds=window_seconds,
        error_detail="Muitas tentativas. Aguarde um instante e tente novamente.",
    )


@router.post("/register")
async def register(payload: RegisterIn):
    db = get_db()
    email = payload.email.lower().strip()

    if await db.owners.find_one({"email": email}, {"_id": 0}):
        raise HTTPException(status_code=400, detail="Email ja cadastrado")

    now = datetime.now(UTC)
    owner_id = f"own_{secrets.token_hex(6)}"
    gym_id = f"gym_{secrets.token_hex(6)}"

    await db.owners.insert_one(
        {
            "owner_id": owner_id,
            "gym_id": gym_id,
            "name": payload.name,
            "email": email,
            "password_hash": hash_password(payload.password),
            "role": "OWNER",
            "email_verified": False,
            "verification_code_hash": None,
            "verification_expires_at": None,
            "verification_attempts": 0,
            "verification_last_sent_at": None,
            "created_at": now,
            "updated_at": now,
        }
    )

    await db.gyms.insert_one(
        {
            "gym_id": gym_id,
            "owner_id": owner_id,
            "name": payload.gym_name,
            "created_at": now,
            "updated_at": now,
        }
    )

    await db.subscriptions.insert_one(initial_subscription(owner_id))
    return {"message": "Cadastro criado. Verifique seu email para continuar."}


@router.post("/verify/start")
async def verify_start(payload: VerifyStartIn, request: Request):
    db = get_db()
    settings = get_settings()
    email = payload.email.lower().strip()
    await _enforce_auth_rate_limit(
        request,
        email,
        scope="auth.verify_start",
        limit=settings.auth_verify_rate_limit,
        window_seconds=settings.auth_verify_window_seconds,
    )
    owner = await db.owners.find_one({"email": email}, {"_id": 0})
    if not owner:
        raise HTTPException(status_code=404, detail="Conta nao encontrada")

    now = datetime.now(UTC)
    last_sent_at = owner.get("verification_last_sent_at")
    if last_sent_at and (now - last_sent_at).total_seconds() < 30:
        raise HTTPException(status_code=429, detail="Aguarde alguns segundos para reenviar")

    code = f"{secrets.randbelow(999999):06d}"
    code_hash = verification_code_hash(email, code)
    expires_at = now + timedelta(minutes=15)

    await db.owners.update_one(
        {"owner_id": owner["owner_id"]},
        {
            "$set": {
                "verification_code_hash": code_hash,
                "verification_expires_at": expires_at,
                "verification_attempts": 0,
                "verification_last_sent_at": now,
                "updated_at": now,
            }
        },
    )

    sent = await send_email_code(email, code)
    response = {"message": "Codigo enviado", "expires_at": expires_at}
    if not sent:
        response["dev_code"] = code
    return response


@router.post("/verify/confirm")
async def verify_confirm(payload: VerifyConfirmIn):
    db = get_db()
    email = payload.email.lower().strip()
    owner = await db.owners.find_one({"email": email}, {"_id": 0})
    if not owner:
        raise HTTPException(status_code=404, detail="Conta nao encontrada")

    if owner.get("email_verified"):
        return {"message": "Email ja verificado"}

    now = datetime.now(UTC)
    expires_at = owner.get("verification_expires_at")
    if not expires_at or expires_at < now:
        raise HTTPException(status_code=400, detail="Codigo expirado")

    if int(owner.get("verification_attempts", 0)) >= 5:
        raise HTTPException(status_code=429, detail="Muitas tentativas. Reenvie o codigo")

    if verification_code_hash(email, payload.code) != owner.get("verification_code_hash"):
        await db.owners.update_one(
            {"owner_id": owner["owner_id"]}, {"$inc": {"verification_attempts": 1}}
        )
        raise HTTPException(status_code=400, detail="Codigo invalido")

    await db.owners.update_one(
        {"owner_id": owner["owner_id"]},
        {
            "$set": {
                "email_verified": True,
                "verification_code_hash": None,
                "verification_expires_at": None,
                "verification_attempts": 0,
                "updated_at": now,
            }
        },
    )
    return {"message": "Email verificado com sucesso"}


async def _login_owner(email: str, password: str) -> dict | None:
    db = get_db()
    owner = await db.owners.find_one({"email": email}, {"_id": 0})
    if not owner or not verify_password(password, owner["password_hash"]):
        return None

    if not owner.get("email_verified"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Email nao verificado",
            headers={"X-Error-Code": "NEED_EMAIL_VERIFICATION"},
        )

    subscription = await db.subscriptions.find_one({"owner_id": owner["owner_id"]}, {"_id": 0})
    if not subscription_allows_login(subscription):
        checkout_url = None
        try:
            from .billing import create_checkout_for_owner

            checkout = await create_checkout_for_owner(owner)
            checkout_url = checkout.checkout_url
        except Exception:  # pragma: no cover - optional dependency/network failure
            checkout_url = None

        headers = {"X-Error-Code": "PAYMENT_REQUIRED"}
        if checkout_url:
            headers["X-Checkout-Url"] = checkout_url
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Assinatura inativa. Realize o pagamento para entrar.",
            headers=headers,
        )

    token = create_access_token(
        owner["owner_id"],
        extra={
            "actor_type": "owner",
            "role": "OWNER",
            "owner_id": owner["owner_id"],
            "gym_id": owner["gym_id"],
        },
    )
    return {"token": token, "user": _owner_out(owner)}


async def _login_employee(email: str, password: str) -> dict | None:
    db = get_db()
    employee = await db.employees.find_one(
        {"email": email.lower().strip(), "is_active": True}, {"_id": 0}
    )
    if not employee:
        return None
    if not verify_password(password, employee["password_hash"]):
        return None

    subscription = await db.subscriptions.find_one({"owner_id": employee["owner_id"]}, {"_id": 0})
    if not subscription_allows_login(subscription):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Assinatura da academia inativa",
            headers={"X-Error-Code": "PAYMENT_REQUIRED"},
        )

    token = create_access_token(
        employee["employee_id"],
        extra={
            "actor_type": "employee",
            "role": employee["role"],
            "owner_id": employee["owner_id"],
            "gym_id": employee["gym_id"],
        },
    )
    return {
        "token": token,
        "user": {
            "owner_id": employee["owner_id"],
            "name": employee["name"],
            "email": employee["email"],
            "email_verified": True,
            "gym_id": employee["gym_id"],
            "role": employee["role"],
            "employee_id": employee["employee_id"],
        },
    }


@router.post("/login")
async def login(payload: LoginIn, request: Request):
    settings = get_settings()
    email = payload.email.lower().strip()
    await _enforce_auth_rate_limit(
        request,
        email,
        scope="auth.login",
        limit=settings.auth_login_rate_limit,
        window_seconds=settings.auth_login_window_seconds,
    )

    result = await _login_owner(email, payload.password)
    if result:
        return result

    result = await _login_employee(email, payload.password)
    if result:
        return result

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciais invalidas")


@router.get("/me")
async def me(actor: dict = Depends(get_current_actor)):
    if actor.get("actor_type") == "employee":
        return {
            "owner_id": actor["owner_id"],
            "employee_id": actor["employee_id"],
            "name": actor["name"],
            "email": actor["email"],
            "gym_id": actor["gym_id"],
            "role": actor["role"],
            "email_verified": True,
        }

    return _owner_out(actor).model_dump()
