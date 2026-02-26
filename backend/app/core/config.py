from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "GymBro API"
    environment: Literal["dev", "staging", "prod"] = "dev"
    api_prefix: str = "/api"

    mongo_uri: str = Field(default="mongodb://localhost:27017")
    db_name: str = Field(default="gymbro")

    jwt_secret: str = Field(default="change-me-dev-secret")
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60 * 24 * 7
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

    alert_webhook_failures_threshold: int = 5
    alert_access_denies_threshold: int = 20
    alert_gateway_auth_failures_threshold: int = 10

    cors_origins: str = "http://localhost:3000"

    @field_validator("jwt_secret")
    @classmethod
    def validate_jwt_secret(cls, value: str) -> str:
        if len(value) < 16:
            raise ValueError("JWT_SECRET must have at least 16 characters")
        return value

    @field_validator("fernet_key")
    @classmethod
    def validate_fernet_key(cls, value: str) -> str:
        if not value:
            # dev fallback key; override in production
            return "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
