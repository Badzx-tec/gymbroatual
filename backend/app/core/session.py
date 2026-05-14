from fastapi import Response

from app.core.config import get_settings


def _should_use_secure_cookie(settings) -> bool:
    return bool(
        settings.session_cookie_secure
        or settings.environment == "prod"
        or settings.app_base_url.startswith("https://")
    )


def set_auth_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    max_age = max(int(settings.access_token_minutes) * 60, 60)
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=max_age,
        expires=max_age,
        httponly=True,
        secure=_should_use_secure_cookie(settings),
        samesite=settings.session_cookie_samesite,
        domain=settings.session_cookie_domain,
        path=settings.session_cookie_path,
    )


def clear_auth_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.session_cookie_name,
        domain=settings.session_cookie_domain,
        path=settings.session_cookie_path,
        secure=_should_use_secure_cookie(settings),
        samesite=settings.session_cookie_samesite,
    )
