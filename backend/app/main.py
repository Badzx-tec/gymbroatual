import asyncio
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.db.mongo import init_indexes
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=settings.cors_origins.strip() != "*",
    allow_methods=["*"],
    allow_headers=["*"],
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
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), interest-cohort=()",
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
