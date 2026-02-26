import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pymongo.errors import DuplicateKeyError

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
from app.core.time import UTC
from app.db.mongo import get_db
from app.models.auth import (
    LoginIn,
    OwnerOut,
    RegisterIn,
    VerifyConfirmIn,
    VerifyStartIn,
)
from app.services.billing_reconcile import reconcile_subscriptions
from app.services.email import EmailDeliveryError, send_email_code
from app.services.subscription import initial_subscription, subscription_allows_login

router = APIRouter()
ALLOWED_THEME_KEYS = {"lime", "blue", "emerald", "amber", "rose"}
MAX_LOGO_DATA_URL_LENGTH = 1_500_000


def _as_utc_datetime(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    return None


def _owner_out(owner: dict) -> OwnerOut:
    return OwnerOut(
        owner_id=owner["owner_id"],
        name=owner["name"],
        email=owner["email"],
        email_verified=owner.get("email_verified", False),
        gym_id=owner["gym_id"],
    )


def _clean_optional(value) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _normalize_email(value, *, required: bool = False) -> str | None:
    email = _clean_optional(value)
    if not email:
        if required:
            raise HTTPException(status_code=400, detail="Email obrigatorio")
        return None
    email = email.lower()
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Email invalido")
    local, domain = email.split("@", 1)
    if not local or not domain or "." not in domain:
        raise HTTPException(status_code=400, detail="Email invalido")
    return email


def _normalize_name(value, *, required: bool = False) -> str | None:
    name = _clean_optional(value)
    if not name:
        if required:
            raise HTTPException(status_code=400, detail="Nome obrigatorio")
        return None
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Nome invalido")
    return name


def _try_normalize_email(value) -> str | None:
    try:
        return _normalize_email(value)
    except HTTPException:
        return None


def _normalize_cpf(value) -> str | None:
    cleaned = _clean_optional(value)
    if not cleaned:
        return None
    digits = "".join(ch for ch in str(cleaned) if ch.isdigit())
    if len(digits) != 11:
        return None
    return f"{digits[:3]}.{digits[3:6]}.{digits[6:9]}-{digits[9:]}"


def _normalize_theme_key(value, *, strict: bool = False) -> str:
    key = (_clean_optional(value) or "lime").lower()
    if key not in ALLOWED_THEME_KEYS:
        if strict:
            raise HTTPException(status_code=400, detail="Tema invalido")
        return "lime"
    return key


def _normalize_logo_data_url(value) -> str | None:
    logo_data_url = _clean_optional(value)
    if logo_data_url is None:
        return None
    if not logo_data_url.startswith("data:image/") or ";base64," not in logo_data_url:
        raise HTTPException(status_code=400, detail="Logo invalido")
    if len(logo_data_url) > MAX_LOGO_DATA_URL_LENGTH:
        raise HTTPException(status_code=400, detail="Logo muito grande")
    return logo_data_url


async def _owner_profile_payload(owner: dict) -> dict:
    db = get_db()
    gym = await db.gyms.find_one({"owner_id": owner["owner_id"]}, {"_id": 0, "name": 1})
    branding = owner.get("branding") or {}
    return {
        "actor_type": "owner",
        "role": "OWNER",
        "owner_id": owner["owner_id"],
        "name": owner.get("name") or "",
        "email": owner.get("email") or "",
        "phone": owner.get("phone"),
        "gym_name": (gym or {}).get("name"),
        "branding": {
            "theme_key": _normalize_theme_key(branding.get("theme_key")),
            "logo_data_url": branding.get("logo_data_url"),
        },
    }


async def _employee_profile_payload(employee: dict) -> dict:
    db = get_db()
    gym = await db.gyms.find_one({"owner_id": employee["owner_id"]}, {"_id": 0, "name": 1})
    owner = await db.owners.find_one({"owner_id": employee["owner_id"]}, {"_id": 0, "branding": 1})
    branding = (owner or {}).get("branding") or {}
    return {
        "actor_type": "employee",
        "role": employee.get("role") or "RECEPTION",
        "employee_id": employee["employee_id"],
        "owner_id": employee["owner_id"],
        "name": employee.get("name") or "",
        "email": employee.get("email") or "",
        "phone": employee.get("phone"),
        "gym_name": (gym or {}).get("name"),
        "branding": {
            "theme_key": _normalize_theme_key(branding.get("theme_key")),
            "logo_data_url": branding.get("logo_data_url"),
        },
    }


async def _student_profile_payload(student: dict) -> dict:
    db = get_db()
    gym = await db.gyms.find_one({"owner_id": student["owner_id"]}, {"_id": 0, "name": 1})
    owner = await db.owners.find_one({"owner_id": student["owner_id"]}, {"_id": 0, "branding": 1})
    branding = (owner or {}).get("branding") or {}
    return {
        "actor_type": "student",
        "role": "STUDENT",
        "student_id": student["student_id"],
        "owner_id": student["owner_id"],
        "gym_id": student.get("gym_id"),
        "name": student.get("nome") or "",
        "email": student.get("email") or "",
        "phone": student.get("telefone"),
        "gym_name": (gym or {}).get("name"),
        "plan_id": student.get("plano_id"),
        "plan_expires_at": student.get("plan_expires_at") or student.get("data_vencimento"),
        "auth_login_enabled": bool(student.get("auth_login_enabled", True)),
        "branding": {
            "theme_key": _normalize_theme_key(branding.get("theme_key")),
            "logo_data_url": branding.get("logo_data_url"),
        },
    }


def _super_admin_profile_payload() -> dict:
    settings = get_settings()
    return {
        "actor_type": "super_admin",
        "role": "SUPER_ADMIN",
        "name": settings.super_admin_name,
        "email": (settings.super_admin_email or "").strip().lower(),
        "phone": None,
        "gym_name": "GymBro Platform",
        "branding": {
            "theme_key": "blue",
            "logo_data_url": None,
        },
    }


def _super_admin_password_matches(password: str, configured_password: str) -> bool:
    # Allows plain text or bcrypt hash in environment configuration.
    if configured_password.startswith("$2"):
        try:
            return verify_password(password, configured_password)
        except Exception:
            return False
    return secrets.compare_digest(password, configured_password)


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
    settings = get_settings()
    await db.memberships.insert_one(
        {
            "membership_id": f"mem_{secrets.token_hex(6)}",
            "owner_id": owner_id,
            "plan_code": "owner_monthly",
            "amount": settings.subscription_monthly_amount,
            "currency": "BRL",
            "provider": "mercadopago",
            "status": "trialing",
            "started_at": now,
            "trial_ends_at": now + timedelta(days=settings.trial_days),
            "current_period_start": None,
            "current_period_end": None,
            "canceled_at": None,
            "updated_at": now,
        }
    )
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
    last_sent_at = _as_utc_datetime(owner.get("verification_last_sent_at"))
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

    try:
        sent = await send_email_code(email, code)
    except EmailDeliveryError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Servico de e-mail indisponivel no momento. Tente novamente em instantes.",
        ) from exc

    response = {"message": "Codigo enviado", "expires_at": expires_at}
    if not sent and settings.environment != "prod":
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
    expires_at = _as_utc_datetime(owner.get("verification_expires_at"))
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
    settings = get_settings()
    if (
        settings.mp_access_token
        and subscription
        and subscription.get("provider") == "mercadopago"
        and subscription.get("mp_preapproval_id")
    ):
        try:
            await reconcile_subscriptions(owner_id=owner["owner_id"], limit=1)
            subscription = await db.subscriptions.find_one(
                {"owner_id": owner["owner_id"]}, {"_id": 0}
            )
        except Exception:
            # Best-effort sync before enforcing payment gate.
            pass

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


async def _login_student(identifier: str, password: str) -> dict | None:
    db = get_db()
    cleaned_identifier = str(identifier or "").strip()
    if not cleaned_identifier:
        return None

    normalized_email = _try_normalize_email(cleaned_identifier)
    normalized_cpf = _normalize_cpf(cleaned_identifier)
    normalized_matricula = _clean_optional(cleaned_identifier)
    normalized_matricula = normalized_matricula.upper() if normalized_matricula else None

    clauses: list[dict] = []
    if normalized_email:
        clauses.append({"email": normalized_email})
    if normalized_cpf:
        clauses.append({"cpf": normalized_cpf})
    if normalized_matricula:
        clauses.append({"matricula": normalized_matricula})

    if not clauses:
        return None

    query: dict = {
        "is_employee_shadow": {"$ne": True},
        "auth_login_enabled": {"$ne": False},
    }
    if len(clauses) == 1:
        query.update(clauses[0])
    else:
        query["$or"] = clauses

    candidates = await db.students.find(query, {"_id": 0}).limit(25).to_list(25)
    if not candidates:
        return None

    valid_students: list[dict] = []
    for student in candidates:
        password_hash = student.get("password_hash")
        if not password_hash:
            continue
        if verify_password(password, password_hash):
            valid_students.append(student)

    if not valid_students:
        return None

    if len(valid_students) > 1:
        raise HTTPException(
            status_code=409,
            detail="Identificador ambiguo. Entre em contato com a academia.",
        )

    student = valid_students[0]
    if str(student.get("status") or "ativo").lower() != "ativo":
        raise HTTPException(status_code=403, detail="Aluno inativo")

    owner_id = student.get("owner_id")
    if not owner_id:
        raise HTTPException(status_code=409, detail="Aluno sem academia vinculada")

    subscription = await db.subscriptions.find_one({"owner_id": owner_id}, {"_id": 0})
    if not subscription_allows_login(subscription):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Assinatura da academia inativa",
            headers={"X-Error-Code": "PAYMENT_REQUIRED"},
        )

    token = create_access_token(
        student["student_id"],
        extra={
            "actor_type": "student",
            "role": "STUDENT",
            "owner_id": owner_id,
            "gym_id": student.get("gym_id"),
            "student_id": student["student_id"],
        },
    )
    return {
        "token": token,
        "user": {
            "owner_id": owner_id,
            "student_id": student["student_id"],
            "name": student.get("nome") or "Aluno",
            "email": student.get("email") or "",
            "email_verified": True,
            "gym_id": student.get("gym_id"),
            "role": "STUDENT",
            "actor_type": "student",
            "must_change_password": bool(student.get("must_change_password", False)),
        },
    }


async def _login_super_admin(email: str, password: str) -> dict | None:
    settings = get_settings()
    configured_email = (settings.super_admin_email or "").strip().lower()
    configured_password = (settings.super_admin_password or "").strip()
    if not configured_email or not configured_password:
        return None
    if email != configured_email:
        return None
    if not _super_admin_password_matches(password, configured_password):
        return None

    token = create_access_token(
        configured_email,
        extra={
            "actor_type": "super_admin",
            "role": "SUPER_ADMIN",
            "email": configured_email,
        },
    )
    return {
        "token": token,
        "user": {
            "name": settings.super_admin_name,
            "email": configured_email,
            "role": "SUPER_ADMIN",
            "actor_type": "super_admin",
            "email_verified": True,
            "owner_id": None,
            "gym_id": None,
        },
    }


@router.post("/login")
async def login(payload: LoginIn, request: Request):
    settings = get_settings()
    identifier = str(payload.identifier or payload.email or "").strip()
    normalized_email = _try_normalize_email(identifier)
    await _enforce_auth_rate_limit(
        request,
        normalized_email or identifier.lower(),
        scope="auth.login",
        limit=settings.auth_login_rate_limit,
        window_seconds=settings.auth_login_window_seconds,
    )

    if normalized_email:
        result = await _login_super_admin(normalized_email, payload.password)
        if result:
            return result

        result = await _login_owner(normalized_email, payload.password)
        if result:
            return result

        result = await _login_employee(normalized_email, payload.password)
        if result:
            return result

    result = await _login_student(identifier, payload.password)
    if result:
        return result

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciais invalidas")


@router.get("/me")
async def me(actor: dict = Depends(get_current_actor)):
    if actor.get("actor_type") == "super_admin":
        return {
            "name": actor.get("name") or "Platform Admin",
            "email": actor.get("email"),
            "role": "SUPER_ADMIN",
            "actor_type": "super_admin",
            "email_verified": True,
            "owner_id": None,
            "gym_id": None,
        }

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

    if actor.get("actor_type") == "student":
        return {
            "owner_id": actor["owner_id"],
            "student_id": actor["student_id"],
            "name": actor.get("nome") or "Aluno",
            "email": actor.get("email") or "",
            "gym_id": actor.get("gym_id"),
            "role": "STUDENT",
            "actor_type": "student",
            "email_verified": True,
        }

    return _owner_out(actor).model_dump()


@router.get("/profile")
async def profile(actor: dict = Depends(get_current_actor)):
    if actor.get("actor_type") == "super_admin":
        return _super_admin_profile_payload()

    db = get_db()
    if actor.get("actor_type") == "employee":
        employee = await db.employees.find_one(
            {"employee_id": actor["employee_id"], "is_active": True},
            {"_id": 0},
        )
        if not employee:
            raise HTTPException(status_code=404, detail="Funcionario nao encontrado")
        return await _employee_profile_payload(employee)

    if actor.get("actor_type") == "student":
        student = await db.students.find_one(
            {
                "student_id": actor["student_id"],
                "owner_id": actor["owner_id"],
                "is_employee_shadow": {"$ne": True},
            },
            {"_id": 0, "password_hash": 0},
        )
        if not student:
            raise HTTPException(status_code=404, detail="Aluno nao encontrado")
        return await _student_profile_payload(student)

    owner = await db.owners.find_one({"owner_id": actor["owner_id"]}, {"_id": 0})
    if not owner:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")
    return await _owner_profile_payload(owner)


@router.put("/profile")
async def update_profile(payload: dict, actor: dict = Depends(get_current_actor)):
    if actor.get("actor_type") == "super_admin":
        raise HTTPException(
            status_code=403,
            detail="Perfil do super admin e gerenciado por variavel de ambiente",
        )

    db = get_db()
    now = datetime.now(UTC)

    if actor.get("actor_type") == "employee":
        employee = await db.employees.find_one(
            {"employee_id": actor["employee_id"], "is_active": True},
            {"_id": 0},
        )
        if not employee:
            raise HTTPException(status_code=404, detail="Funcionario nao encontrado")

        update_fields = {"updated_at": now}

        if "name" in payload:
            update_fields["name"] = _normalize_name(payload.get("name"), required=True)

        if "email" in payload:
            email = _normalize_email(payload.get("email"), required=True)
            existing = await db.employees.find_one(
                {
                    "owner_id": employee["owner_id"],
                    "employee_id": {"$ne": employee["employee_id"]},
                    "email": email,
                },
                {"_id": 0, "employee_id": 1},
            )
            if existing:
                raise HTTPException(status_code=409, detail="Email ja cadastrado")
            update_fields["email"] = email

        if "phone" in payload:
            update_fields["phone"] = _clean_optional(payload.get("phone"))

        try:
            result = await db.employees.update_one(
                {"employee_id": employee["employee_id"], "owner_id": employee["owner_id"]},
                {"$set": update_fields},
            )
        except DuplicateKeyError as exc:
            raise HTTPException(status_code=409, detail="Email ja cadastrado") from exc

        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Funcionario nao encontrado")

        updated_employee = await db.employees.find_one(
            {"employee_id": employee["employee_id"], "owner_id": employee["owner_id"]},
            {"_id": 0},
        )
        if not updated_employee:
            raise HTTPException(status_code=404, detail="Funcionario nao encontrado")
        return await _employee_profile_payload(updated_employee)

    if actor.get("actor_type") == "student":
        student = await db.students.find_one(
            {
                "student_id": actor["student_id"],
                "owner_id": actor["owner_id"],
                "is_employee_shadow": {"$ne": True},
            },
            {"_id": 0},
        )
        if not student:
            raise HTTPException(status_code=404, detail="Aluno nao encontrado")

        update_fields: dict = {"updated_at": now}
        if "name" in payload:
            update_fields["nome"] = _normalize_name(payload.get("name"), required=True)
        if "email" in payload:
            update_fields["email"] = _normalize_email(payload.get("email"), required=False)
        if "phone" in payload:
            update_fields["telefone"] = _clean_optional(payload.get("phone"))

        result = await db.students.update_one(
            {"student_id": student["student_id"], "owner_id": student["owner_id"]},
            {"$set": update_fields},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Aluno nao encontrado")

        updated_student = await db.students.find_one(
            {"student_id": student["student_id"], "owner_id": student["owner_id"]},
            {"_id": 0, "password_hash": 0},
        )
        if not updated_student:
            raise HTTPException(status_code=404, detail="Aluno nao encontrado")
        return await _student_profile_payload(updated_student)

    owner = await db.owners.find_one({"owner_id": actor["owner_id"]}, {"_id": 0})
    if not owner:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")

    update_owner_fields: dict = {"updated_at": now}

    if "name" in payload:
        update_owner_fields["name"] = _normalize_name(payload.get("name"), required=True)

    if "email" in payload:
        email = _normalize_email(payload.get("email"), required=True)
        existing_owner = await db.owners.find_one(
            {"email": email, "owner_id": {"$ne": owner["owner_id"]}},
            {"_id": 0, "owner_id": 1},
        )
        if existing_owner:
            raise HTTPException(status_code=409, detail="Email ja cadastrado")
        update_owner_fields["email"] = email

    if "phone" in payload:
        update_owner_fields["phone"] = _clean_optional(payload.get("phone"))

    if any(key in payload for key in ("theme_key", "logo_data_url", "remove_logo")):
        current_branding = dict(owner.get("branding") or {})
        if "theme_key" in payload:
            current_branding["theme_key"] = _normalize_theme_key(payload.get("theme_key"), strict=True)
        if "logo_data_url" in payload:
            current_branding["logo_data_url"] = _normalize_logo_data_url(payload.get("logo_data_url"))
        if payload.get("remove_logo"):
            current_branding["logo_data_url"] = None
        current_branding["updated_at"] = now
        update_owner_fields["branding"] = current_branding

    try:
        result = await db.owners.update_one(
            {"owner_id": owner["owner_id"]},
            {"$set": update_owner_fields},
        )
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="Email ja cadastrado") from exc

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")

    if "gym_name" in payload:
        gym_name = _normalize_name(payload.get("gym_name"), required=True)
        await db.gyms.update_one(
            {"owner_id": owner["owner_id"]},
            {"$set": {"name": gym_name, "updated_at": now}},
        )

    updated_owner = await db.owners.find_one({"owner_id": owner["owner_id"]}, {"_id": 0})
    if not updated_owner:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")
    return await _owner_profile_payload(updated_owner)


@router.post("/profile/password")
async def change_profile_password(payload: dict, actor: dict = Depends(get_current_actor)):
    if actor.get("actor_type") == "super_admin":
        raise HTTPException(
            status_code=403,
            detail="Senha do super admin e gerenciada por variavel de ambiente",
        )

    current_password = str(payload.get("current_password") or "")
    new_password = str(payload.get("new_password") or "")

    if len(current_password) < 8:
        raise HTTPException(status_code=400, detail="Senha atual invalida")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Nova senha deve ter ao menos 8 caracteres")
    if current_password == new_password:
        raise HTTPException(status_code=400, detail="Nova senha deve ser diferente da atual")

    db = get_db()
    now = datetime.now(UTC)

    if actor.get("actor_type") == "employee":
        employee = await db.employees.find_one(
            {"employee_id": actor["employee_id"], "is_active": True},
            {"_id": 0, "password_hash": 1, "owner_id": 1},
        )
        if not employee:
            raise HTTPException(status_code=404, detail="Funcionario nao encontrado")
        if not verify_password(current_password, employee["password_hash"]):
            raise HTTPException(status_code=401, detail="Senha atual incorreta")

        await db.employees.update_one(
            {"employee_id": actor["employee_id"], "owner_id": employee["owner_id"]},
            {
                "$set": {
                    "password_hash": hash_password(new_password),
                    "updated_at": now,
                }
            },
        )
        return {"message": "Senha atualizada com sucesso"}

    if actor.get("actor_type") == "student":
        student = await db.students.find_one(
            {
                "student_id": actor["student_id"],
                "owner_id": actor["owner_id"],
                "is_employee_shadow": {"$ne": True},
            },
            {"_id": 0, "password_hash": 1, "owner_id": 1, "student_id": 1},
        )
        if not student:
            raise HTTPException(status_code=404, detail="Aluno nao encontrado")
        if not student.get("password_hash") or not verify_password(
            current_password, student["password_hash"]
        ):
            raise HTTPException(status_code=401, detail="Senha atual incorreta")

        await db.students.update_one(
            {"student_id": student["student_id"], "owner_id": student["owner_id"]},
            {
                "$set": {
                    "password_hash": hash_password(new_password),
                    "must_change_password": False,
                    "updated_at": now,
                }
            },
        )
        return {"message": "Senha atualizada com sucesso"}

    owner = await db.owners.find_one(
        {"owner_id": actor["owner_id"]},
        {"_id": 0, "password_hash": 1},
    )
    if not owner:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")
    if not verify_password(current_password, owner["password_hash"]):
        raise HTTPException(status_code=401, detail="Senha atual incorreta")

    await db.owners.update_one(
        {"owner_id": actor["owner_id"]},
        {
            "$set": {
                "password_hash": hash_password(new_password),
                "updated_at": now,
            }
        },
    )
    return {"message": "Senha atualizada com sucesso"}
