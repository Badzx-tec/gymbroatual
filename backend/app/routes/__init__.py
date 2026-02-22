from fastapi import APIRouter

from . import auth, billing, gyms, legacy, ops, staff, students, tolletus, turnstiles

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(billing.router, prefix="/billing", tags=["billing"])
api_router.include_router(students.router, prefix="/students", tags=["students"])
api_router.include_router(gyms.router, prefix="/gyms", tags=["gyms"])
api_router.include_router(tolletus.router, prefix="/tolletus", tags=["tolletus"])
api_router.include_router(staff.router, prefix="/staff", tags=["staff"])
api_router.include_router(turnstiles.router, prefix="/turnstiles", tags=["turnstiles"])
api_router.include_router(ops.router, prefix="/ops", tags=["ops"])
api_router.include_router(legacy.router, tags=["legacy"])
