import base64

from cryptography.fernet import Fernet

from app.core.config import get_settings


def _fernet() -> Fernet:
    settings = get_settings()
    key = settings.fernet_key.encode("utf-8")
    # allow raw base64 without urlsafe padding from env
    try:
        base64.urlsafe_b64decode(key)
    except Exception as exc:  # pragma: no cover
        raise ValueError("FERNET_KEY invalida") from exc
    return Fernet(key)


def encrypt_template(template: str) -> str:
    return _fernet().encrypt(template.encode("utf-8")).decode("utf-8")


def decrypt_template(template_encrypted: str) -> str:
    return _fernet().decrypt(template_encrypted.encode("utf-8")).decode("utf-8")
