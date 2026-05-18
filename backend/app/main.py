import asyncio
import smtplib
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.db.mongo import get_db, init_indexes
from app.routes import api_router
from app.services.billing_reconcile import reconcile_subscriptions
from app.services.observability import log_event, record_request

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_indexes()
    reconcile_task: asyncio.Task | None = None

    if settings.billing_reconcile_enabled and settings.mp_access_token:

        async def _reconcile_loop():
            while True:
                try:
                    summary = await reconcile_subscriptions(
                        limit=settings.billing_reconcile_batch_size
                    )
                    log_event("billing_reconcile_cycle", summary=summary)
                except Exception as exc:  # pragma: no cover - loop resiliency
                    log_event("billing_reconcile_loop_error", error=str(exc))
                await asyncio.sleep(settings.billing_reconcile_interval_seconds)

        reconcile_task = asyncio.create_task(_reconcile_loop())

    yield
    if reconcile_task:
        reconcile_task.cancel()
        try:
            await reconcile_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title=settings.app_name, version="3.0.0", lifespan=lifespan)

if settings.cors_origins.strip() == "*":
    allow_origins = ["*"]
else:
    allow_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]

allow_methods = [item.strip().upper() for item in settings.cors_allow_methods.split(",") if item.strip()]
allow_headers = [item.strip() for item in settings.cors_allow_headers.split(",") if item.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=settings.cors_origins.strip() != "*",
    allow_methods=allow_methods or ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=allow_headers or ["Authorization", "Content-Type", "X-Requested-With"],
)


@app.middleware("http")
async def request_observability_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    request.state.request_id = request_id
    started_at = time.perf_counter()

    try:
        response = await call_next(request)
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - started_at) * 1000
        record_request(path=request.url.path, status_code=500, latency_ms=elapsed_ms)
        log_event(
            "http_request",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            status_code=500,
            latency_ms=round(elapsed_ms, 2),
            error=str(exc),
        )
        raise

    elapsed_ms = (time.perf_counter() - started_at) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    )
    forwarded_proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    if settings.environment == "prod" and str(forwarded_proto).split(",")[0].strip() == "https":
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains",
        )
    record_request(path=request.url.path, status_code=response.status_code, latency_ms=elapsed_ms)
    log_event(
        "http_request",
        request_id=request_id,
        method=request.method,
        path=request.url.path,
        status_code=response.status_code,
        latency_ms=round(elapsed_ms, 2),
    )
    return response


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": settings.app_name, "version": "3.0.0"}


@app.get("/api/health")
async def api_health() -> dict:
    return {"status": "ok", "service": settings.app_name, "version": "3.0.0"}


# ── Readiness probe cache ────────────────────────────────────────────────────
# Healthy results cache for 5 min (rare external API calls).
# Degraded results cache for 10s only — so the service recovers visibility
# quickly once MongoDB/MP/SMTP come back online.
_READY_CACHE_TTL_OK = 300        # 5 minutes when status == "ready"
_READY_CACHE_TTL_DEGRADED = 10   # 10 seconds when status == "degraded"


@dataclass
class _ReadyCache:
    _lock: Lock = field(default_factory=Lock, repr=False)
    _data: dict[str, Any] = field(default_factory=dict)
    _checked_at: float = 0.0

    def get(self) -> dict[str, Any] | None:
        with self._lock:
            if not self._data:
                return None
            cached_status = self._data.get("status")
            ttl = _READY_CACHE_TTL_OK if cached_status == "ready" else _READY_CACHE_TTL_DEGRADED
            if time.time() - self._checked_at < ttl:
                return dict(self._data)
            return None

    def set(self, data: dict[str, Any]) -> None:
        with self._lock:
            self._data = dict(data)
            self._checked_at = time.time()


_READY_CACHE = _ReadyCache()


async def _check_mongo() -> dict[str, Any]:
    try:
        await asyncio.wait_for(get_db().command("ping"), timeout=5.0)
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


async def _check_mp() -> dict[str, Any]:
    """Lightweight connectivity probe to the MercadoPago API."""
    if not settings.mp_access_token:
        return {"ok": True, "skipped": True, "reason": "mp_access_token not configured"}
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(
                "https://api.mercadopago.com/users/me",
                headers={"Authorization": f"Bearer {settings.mp_access_token}"},
            )
            # 200 = auth OK; 401 = bad token but API is reachable (still counts as up)
            if r.status_code in {200, 401}:
                return {"ok": True, "status_code": r.status_code}
            return {"ok": False, "status_code": r.status_code}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _check_smtp_sync() -> dict[str, Any]:
    """Synchronous SMTP connectivity check (run in thread pool)."""
    if not settings.smtp_host:
        return {"ok": True, "skipped": True, "reason": "smtp_host not configured"}
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=8) as conn:
            if settings.smtp_starttls:
                conn.ehlo()
                conn.starttls()
            return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


async def _check_smtp() -> dict[str, Any]:
    return await asyncio.to_thread(_check_smtp_sync)


async def _build_readiness_payload() -> tuple[dict[str, Any], bool]:
    """Run all probes concurrently and build the readiness response.
    Returns (payload, is_ready)."""
    mongo_result, mp_result, smtp_result = await asyncio.gather(
        _check_mongo(),
        _check_mp(),
        _check_smtp(),
        return_exceptions=False,
    )
    checks = {
        "mongodb": mongo_result,
        "mercadopago": mp_result,
        "smtp": smtp_result,
    }
    # MongoDB is the only hard dependency; MP and SMTP are optional probes.
    is_ready = bool(mongo_result.get("ok"))
    payload = {
        "status": "ready" if is_ready else "degraded",
        "service": settings.app_name,
        "version": "3.0.0",
        "checks": checks,
    }
    return payload, is_ready


@app.get("/health/ready")
async def health_ready():
    cached = _READY_CACHE.get()
    if cached is not None:
        is_ready = cached.get("status") == "ready"
        if not is_ready:
            return JSONResponse(status_code=503, content=cached)
        return cached

    payload, is_ready = await _build_readiness_payload()
    _READY_CACHE.set(payload)
    if not is_ready:
        return JSONResponse(status_code=503, content=payload)
    return payload


@app.get("/api/health/ready")
async def api_health_ready():
    return await health_ready()


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    request_id = getattr(request.state, "request_id", uuid.uuid4().hex)
    log_event(
        "validation_error",
        request_id=request_id,
        path=request.url.path,
        method=request.method,
        errors=exc.errors(),
    )
    return JSONResponse(
        status_code=422,
        content={
            "detail": "Dados de entrada invalidos",
            "errors": exc.errors(),
            "request_id": request_id,
        },
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", uuid.uuid4().hex)
    log_event(
        "unhandled_exception",
        request_id=request_id,
        path=request.url.path,
        method=request.method,
        error=str(exc),
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Erro interno do servidor",
            "request_id": request_id,
        },
    )


app.include_router(api_router, prefix=settings.api_prefix)
