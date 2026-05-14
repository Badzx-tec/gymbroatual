import hmac
from datetime import datetime, timedelta
from functools import lru_cache
from hashlib import sha256
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import get_settings
from app.core.time import UTC

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

_VERIFICATION_CODE_LABEL = b"gymbro/verification-code/v1"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return pwd_context.verify(password, hashed_password)


def create_access_token(subject: str, extra: dict[str, Any] | None = None) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_minutes)).timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


@lru_cache(maxsize=1)
def _verification_code_key() -> bytes:
    """Key for verification-code HMAC.

    Derived from JWT_SECRET via labeled HMAC so we never use the JWT signing
    key directly for another purpose. Cached because Settings is immutable
    once loaded.
    """
    settings = get_settings()
    return hmac.new(settings.jwt_secret.encode("utf-8"), _VERIFICATION_CODE_LABEL, sha256).digest()


def verification_code_hash(email: str, code: str) -> str:
    msg = f"{email.lower().strip()}:{code}".encode("utf-8")
    return hmac.new(_verification_code_key(), msg, sha256).hexdigest()


def safe_jwt_decode(token: str) -> dict[str, Any] | None:
    try:
        return decode_access_token(token)
    except JWTError:
        return None
