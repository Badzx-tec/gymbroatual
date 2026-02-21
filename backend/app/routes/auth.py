import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import get_current_owner
from app.core.security import create_access_token, hash_password, verification_code_hash, verify_password
from app.db.mongo import get_db
from app.models.auth import LoginIn, LoginOut, OwnerOut, RegisterIn, VerifyConfirmIn, VerifyStartIn
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


@router.post("/register")
async def register(payload: RegisterIn):
    db = get_db()
    email = payload.email.lower().strip()

    existing = await db.owners.find_one({"email": email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Email ja cadastrado")

    now = datetime.now(UTC)
    owner_id = f"own_{secrets.token_hex(6)}"
    gym_id = f"gym_{secrets.token_hex(6)}"

    owner_doc = {
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

    gym_doc = {
        "gym_id": gym_id,
        "owner_id": owner_id,
        "name": payload.gym_name,
        "created_at": now,
        "updated_at": now,
    }

    await db.owners.insert_one(owner_doc)
    await db.gyms.insert_one(gym_doc)
    await db.subscriptions.insert_one(initial_subscription(owner_id))

    return {"message": "Cadastro criado. Verifique seu email para continuar."}


@router.post("/verify/start")
async def verify_start(payload: VerifyStartIn):
    db = get_db()
    email = payload.email.lower().strip()
    owner = await db.owners.find_one({"email": email}, {"_id": 0})
    if not owner:
        raise HTTPException(status_code=404, detail="Conta nao encontrada")

    now = datetime.now(UTC)
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

    attempts = int(owner.get("verification_attempts", 0))
    if attempts >= 5:
        raise HTTPException(status_code=429, detail="Muitas tentativas. Reenvie o codigo")

    candidate_hash = verification_code_hash(email, payload.code)
    if candidate_hash != owner.get("verification_code_hash"):
        await db.owners.update_one({"owner_id": owner["owner_id"]}, {"$inc": {"verification_attempts": 1}})
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


@router.post("/login", response_model=LoginOut)
async def login(payload: LoginIn):
    db = get_db()
    email = payload.email.lower().strip()

    owner = await db.owners.find_one({"email": email}, {"_id": 0})
    if not owner or not verify_password(payload.password, owner["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciais invalidas")

    if not owner.get("email_verified"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Email nao verificado",
            headers={"X-Error-Code": "NEED_EMAIL_VERIFICATION"},
        )

    subscription = await db.subscriptions.find_one({"owner_id": owner["owner_id"]}, {"_id": 0})
    if not subscription_allows_login(subscription):
        from app.routes.billing import create_checkout_for_owner

        checkout = await create_checkout_for_owner(owner)
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Assinatura inativa. Realize o pagamento para entrar.",
            headers={
                "X-Error-Code": "PAYMENT_REQUIRED",
                "X-Checkout-Url": checkout.checkout_url,
            },
        )

    token = create_access_token(owner["owner_id"], extra={"role": "OWNER"})
    return LoginOut(token=token, user=_owner_out(owner))


@router.get("/me", response_model=OwnerOut)
async def me(owner: dict = Depends(get_current_owner)):
    return _owner_out(owner)
