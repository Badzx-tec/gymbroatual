"""Symmetric encryption for sensitive at-rest data (biometric templates).

Supports key rotation via MultiFernet: `FERNET_KEYS` is a comma-separated list
where the first key encrypts new tokens and all keys are tried on decrypt.
"""

import base64
from functools import lru_cache

from cryptography.fernet import Fernet, MultiFernet

from app.core.config import get_settings


def _validate_key(key: str) -> bytes:
    """Validate a single Fernet key and return its bytes form."""
    raw = key.strip().encode("utf-8")
    if not raw:
        raise ValueError("FERNET key vazia")
    try:
        decoded = base64.urlsafe_b64decode(raw)
    except Exception as exc:
        raise ValueError("FERNET key invalida: base64 malformado") from exc
    if len(decoded) != 32:
        raise ValueError("FERNET key invalida: 32 bytes apos base64 esperado")
    return raw


@lru_cache(maxsize=1)
def _multifernet() -> MultiFernet:
    settings = get_settings()
    keys = settings.fernet_keys_list
    if not keys:
        raise ValueError("FERNET_KEYS (ou FERNET_KEY legacy) nao configurado")
    fernets = [Fernet(_validate_key(k)) for k in keys]
    return MultiFernet(fernets)


def encrypt_template(template: str) -> str:
    """Encrypt with the current (first) key in FERNET_KEYS."""
    return _multifernet().encrypt(template.encode("utf-8")).decode("utf-8")


def decrypt_template(template_encrypted: str) -> str:
    """Decrypt trying each key in FERNET_KEYS in order."""
    return _multifernet().decrypt(template_encrypted.encode("utf-8")).decode("utf-8")


def rotate_token(token: str) -> str:
    """Re-encrypt a token with the current (first) key.

    Use this opportunistically when reading old data to migrate it to the new key.
    """
    return _multifernet().rotate(token.encode("utf-8")).decode("utf-8")
