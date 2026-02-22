from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.db.mongo import init_indexes
from app.routes import api_router

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_indexes()
    yield


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


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": settings.app_name, "version": "3.0.0"}


@app.get("/api/health")
async def api_health() -> dict:
    return {"status": "ok", "service": settings.app_name, "version": "3.0.0"}


app.include_router(api_router, prefix=settings.api_prefix)
