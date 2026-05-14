"""Regression tests for Phase 0 security hardening.

Covers:
- MultiFernet rotation (encrypt with key A, decrypt after rotating to [B, A]).
- Settings validator rejects DEFAULT_FERNET_KEY in any env.
- Settings validator requires bcrypt hash for SUPER_ADMIN_PASSWORD in prod.
- Settings validator requires MP_WEBHOOK_SECRET when MP_ACCESS_TOKEN is set in prod.
- HMAC key for verification codes is derived (not equal to) JWT_SECRET.
- `_super_admin_password_matches` rejects plaintext.
- Webhook fail-closed: missing X-Signature when secret configured returns 401.
"""

import hmac
import json
from hashlib import sha256
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException

from app.core.config import DEFAULT_FERNET_KEY, Settings
from app.core.security import _verification_code_key, verification_code_hash
from app.routes import billing
from app.routes.auth import _super_admin_password_matches
from app.services.crypto import _multifernet, decrypt_template, encrypt_template

# -----------------------------------------------------------------------------
# MultiFernet rotation
# -----------------------------------------------------------------------------


def test_multifernet_rotation_decrypts_old_data(monkeypatch):
    """Data encrypted with key A still decrypts after we rotate to [B, A]."""
    key_a = Fernet.generate_key().decode()
    key_b = Fernet.generate_key().decode()

    _multifernet.cache_clear()
    monkeypatch.setenv("FERNET_KEYS", key_a)
    from app.core.config import get_settings

    get_settings.cache_clear()
    ciphertext = encrypt_template("biometric-template-payload")

    # Rotate: new key first, old key kept as fallback for decrypt.
    _multifernet.cache_clear()
    monkeypatch.setenv("FERNET_KEYS", f"{key_b},{key_a}")
    get_settings.cache_clear()
    assert decrypt_template(ciphertext) == "biometric-template-payload"

    # Cleanup: restore conftest defaults so other tests aren't affected.
    _multifernet.cache_clear()
    monkeypatch.delenv("FERNET_KEYS", raising=False)
    get_settings.cache_clear()


def test_multifernet_decrypt_with_wrong_key_fails(monkeypatch):
    """Ciphertext from key A cannot decrypt under key B alone."""
    key_a = Fernet.generate_key().decode()
    key_b = Fernet.generate_key().decode()

    _multifernet.cache_clear()
    monkeypatch.setenv("FERNET_KEYS", key_a)
    from app.core.config import get_settings

    get_settings.cache_clear()
    ciphertext = encrypt_template("payload")

    _multifernet.cache_clear()
    monkeypatch.setenv("FERNET_KEYS", key_b)
    get_settings.cache_clear()

    with pytest.raises(Exception):  # InvalidToken from cryptography
        decrypt_template(ciphertext)

    _multifernet.cache_clear()
    monkeypatch.delenv("FERNET_KEYS", raising=False)
    get_settings.cache_clear()


# -----------------------------------------------------------------------------
# Settings validators
# -----------------------------------------------------------------------------


def _make_settings(**overrides) -> Settings:
    """Build Settings ignoring environment, with sane defaults."""
    test_fernet = Fernet.generate_key().decode()
    defaults = {
        "environment": "dev",
        "jwt_secret": "a" * 32,
        "fernet_keys": test_fernet,
        "fernet_key": "",
        "_env_file": None,
    }
    defaults.update(overrides)
    env_file = defaults.pop("_env_file")
    return Settings(_env_file=env_file, **defaults)


def test_default_fernet_key_rejected():
    with pytest.raises(ValueError, match="padrao"):
        _make_settings(fernet_keys=DEFAULT_FERNET_KEY)


def test_legacy_fernet_key_field_accepted():
    """`fernet_key` (singular) should fall back into fernet_keys_list."""
    test_key = Fernet.generate_key().decode()
    s = _make_settings(fernet_keys="", fernet_key=test_key)
    assert s.fernet_keys_list == [test_key]


def test_prod_requires_strong_jwt():
    test_fernet = Fernet.generate_key().decode()
    with pytest.raises(ValueError, match="JWT_SECRET"):
        _make_settings(
            environment="prod",
            jwt_secret="short",
            fernet_keys=test_fernet,
            cors_origins="https://example.com",
        )


def test_prod_requires_bcrypt_super_admin_password():
    test_fernet = Fernet.generate_key().decode()
    with pytest.raises(ValueError, match="bcrypt"):
        _make_settings(
            environment="prod",
            jwt_secret="a" * 64,
            fernet_keys=test_fernet,
            cors_origins="https://example.com",
            super_admin_password="plaintext_password_123",
        )


def test_prod_requires_mp_webhook_secret_when_mp_token_set():
    test_fernet = Fernet.generate_key().decode()
    with pytest.raises(ValueError, match="MP_WEBHOOK_SECRET"):
        _make_settings(
            environment="prod",
            jwt_secret="a" * 64,
            fernet_keys=test_fernet,
            cors_origins="https://example.com",
            mp_access_token="mp_token_xxx",
            mp_webhook_secret=None,
        )


def test_prod_rejects_cors_wildcard():
    test_fernet = Fernet.generate_key().decode()
    with pytest.raises(ValueError, match="CORS_ORIGINS"):
        _make_settings(
            environment="prod",
            jwt_secret="a" * 64,
            fernet_keys=test_fernet,
            cors_origins="*",
        )


# -----------------------------------------------------------------------------
# Verification code HMAC key separation
# -----------------------------------------------------------------------------


def test_verification_code_key_differs_from_jwt_secret():
    """The HMAC key used for verification codes must not equal the JWT secret."""
    _verification_code_key.cache_clear()
    derived = _verification_code_key()
    from app.core.config import get_settings

    jwt_secret_bytes = get_settings().jwt_secret.encode("utf-8")
    assert derived != jwt_secret_bytes


def test_verification_code_hash_uses_derived_key():
    """Hash should not be reproducible by HMAC-ing directly with JWT_SECRET."""
    from app.core.config import get_settings

    email = "user@example.com"
    code = "123456"
    expected = verification_code_hash(email, code)

    jwt_secret = get_settings().jwt_secret.encode("utf-8")
    msg = f"{email}:{code}".encode("utf-8")
    naive = hmac.new(jwt_secret, msg, sha256).hexdigest()
    assert expected != naive


# -----------------------------------------------------------------------------
# Super admin bcrypt enforcement
# -----------------------------------------------------------------------------


def test_super_admin_plaintext_rejected():
    assert _super_admin_password_matches("any", "plaintext_password") is False


def test_super_admin_bcrypt_match():
    from passlib.hash import bcrypt

    hashed = bcrypt.hash("correct horse battery staple")
    assert _super_admin_password_matches("correct horse battery staple", hashed) is True
    assert _super_admin_password_matches("wrong", hashed) is False


# -----------------------------------------------------------------------------
# Webhook fail-closed
# -----------------------------------------------------------------------------


class _DummyClient:
    host = "127.0.0.1"


class _DummyRequest:
    def __init__(self, payload: dict, headers: dict | None = None):
        self._payload = payload
        self.headers = headers or {}
        self.client = _DummyClient()

    async def body(self):
        return json.dumps(self._payload).encode("utf-8")

    async def json(self):
        return dict(self._payload)


@pytest.mark.asyncio
async def test_webhook_rejects_missing_signature_when_secret_set(monkeypatch):
    """Fail-closed: secret configured + no X-Signature → 401."""

    class _DummyCollection:
        async def insert_one(self, _doc):
            return None

        async def find_one(self, _q):
            return None

    class _DummyDb:
        billing_events = _DummyCollection()

    async def bypass_rate_limit(**_kwargs):
        return None

    settings = SimpleNamespace(
        mp_access_token="ACCESS",
        mp_webhook_secret="WEBHOOK_SECRET",
        webhook_rate_limit=100,
        webhook_window_seconds=60,
    )

    monkeypatch.setattr(billing, "get_db", lambda: _DummyDb())
    monkeypatch.setattr(billing, "get_settings", lambda: settings)
    monkeypatch.setattr(billing, "enforce_rate_limit", bypass_rate_limit)

    with pytest.raises(HTTPException) as exc_info:
        await billing.webhook_mercadopago(_DummyRequest({"id": "evt_x"}), x_signature=None)
    assert exc_info.value.status_code == 401
