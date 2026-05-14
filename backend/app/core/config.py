from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_JWT_SECRET = "change-me-dev-secret"
DEFAULT_FERNET_KEY = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="
MIN_JWT_SECRET_LENGTH = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "GymBro API"
    environment: Literal["dev", "staging", "prod"] = "dev"
    api_prefix: str = "/api"

    mongo_uri: str = Field(default="mongodb://localhost:27017")
    db_name: str = Field(default="gymbro")

    jwt_secret: str = Field(default=DEFAULT_JWT_SECRET)
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60 * 24 * 7
    session_cookie_name: str = "gymbro_session"
    session_cookie_domain: str | None = None
    session_cookie_path: str = "/"
    session_cookie_secure: bool = False
    session_cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    super_admin_email: str | None = None
    super_admin_password: str | None = None
    super_admin_name: str = "Platform Admin"

    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str = "no-reply@gymbro.local"
    smtp_starttls: bool = True

    app_base_url: str = "http://localhost:8000"
    frontend_base_url: str = "http://localhost:3000"

    mp_access_token: str | None = None
    mp_public_key: str | None = None
    mp_webhook_secret: str | None = None
    mp_preapproval_plan_id: str | None = None
    subscription_monthly_amount: float = 139.90
    trial_days: int = 7
    payment_grace_days: int = 3

    # Encryption keys for at-rest sensitive data (biometric templates, etc.).
    # FERNET_KEYS (preferred): comma-separated list. First key encrypts new
    # data; all keys are tried on decrypt — enables zero-downtime rotation.
    # FERNET_KEY (legacy single key) is kept for backward compatibility and
    # is appended to fernet_keys_list when FERNET_KEYS is unset.
    fernet_keys: str = ""
    fernet_key: str = ""

    toletus_mode: Literal["mock", "real"] = "mock"
    toletus_api_base_url: str | None = None
    toletus_api_key: str | None = None

    gateway_max_skew_seconds: int = 120
    gateway_nonce_ttl_seconds: int = 300
    gateway_invalid_attempt_threshold: int = 5
    gateway_block_seconds: int = 600

    auth_login_rate_limit: int = 10
    auth_login_window_seconds: int = 60
    auth_verify_rate_limit: int = 5
    auth_verify_window_seconds: int = 60
    webhook_rate_limit: int = 120
    webhook_window_seconds: int = 60

    billing_reconcile_enabled: bool = True
    billing_reconcile_interval_seconds: int = 900
    billing_reconcile_batch_size: int = 200
    student_billing_grace_days: int = 3
    student_billing_retry_offsets_days: str = "1,3,7"

    alert_webhook_failures_threshold: int = 5
    alert_access_denies_threshold: int = 20
    alert_gateway_auth_failures_threshold: int = 10

    cors_origins: str = "http://localhost:3000"
    cors_allow_methods: str = "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    cors_allow_headers: str = "Authorization,Content-Type,X-Requested-With,X-Request-ID"

    @property
    def fernet_keys_list(self) -> list[str]:
        """Resolved list of Fernet keys (FERNET_KEYS first, then legacy FERNET_KEY)."""
        keys: list[str] = []
        if self.fernet_keys:
            keys.extend(k.strip() for k in self.fernet_keys.split(",") if k.strip())
        if self.fernet_key and self.fernet_key not in keys:
            keys.append(self.fernet_key.strip())
        return keys

    @field_validator("jwt_secret")
    @classmethod
    def validate_jwt_secret(cls, value: str) -> str:
        if len(value) < 16:
            raise ValueError("JWT_SECRET must have at least 16 characters")
        return value

    @model_validator(mode="after")
    def validate_production_security(self):
        # Fernet must always be configured (encryption cannot fall back silently).
        if not self.fernet_keys_list:
            raise ValueError("FERNET_KEYS (ou FERNET_KEY legacy) e obrigatorio")

        # Never allow the public default key, in any environment.
        if any(k == DEFAULT_FERNET_KEY for k in self.fernet_keys_list):
            raise ValueError(
                "FERNET key padrao (publica em .env.example) nao pode ser usada; "
                "gere uma nova com scripts/gen-secrets.sh"
            )

        if self.environment != "prod":
            return self

        # --- production-only stricter checks ---
        if self.jwt_secret == DEFAULT_JWT_SECRET:
            raise ValueError("JWT_SECRET padrao nao pode ser usado em producao")
        if len(self.jwt_secret) < MIN_JWT_SECRET_LENGTH:
            raise ValueError(
                f"JWT_SECRET em producao deve ter pelo menos {MIN_JWT_SECRET_LENGTH} caracteres"
            )

        origins = [item.strip() for item in self.cors_origins.split(",") if item.strip()]
        if not origins or "*" in origins:
            raise ValueError("CORS_ORIGINS deve listar origens explicitas em producao")

        if self.session_cookie_samesite == "none" and not self.session_cookie_secure:
            raise ValueError(
                "SESSION_COOKIE_SECURE deve ser true quando SESSION_COOKIE_SAMESITE=none"
            )

        # MP webhook secret is required when MP integration is active.
        if self.mp_access_token and not self.mp_webhook_secret:
            raise ValueError(
                "MP_WEBHOOK_SECRET e obrigatorio quando MP_ACCESS_TOKEN esta configurado"
            )

        # Super admin password, if present, must be a bcrypt hash (starts with $2).
        if self.super_admin_password and not self.super_admin_password.startswith("$2"):
            raise ValueError(
                "SUPER_ADMIN_PASSWORD deve ser um hash bcrypt (gerar com passlib.hash.bcrypt)"
            )

        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
