from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException

from app.core.deps import require_active_subscription
from app.db.mongo import get_db
from app.integrations.tolletus.client import get_tolletus_client
from app.models.students import (
    TolletusEnrollConfirmIn,
    TolletusEnrollStartIn,
    TolletusStatusOut,
)
from app.services.crypto import encrypt_template

router = APIRouter()


def _resolve_client():
    try:
        return get_tolletus_client()
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/enroll/start")
async def enroll_start(
    payload: TolletusEnrollStartIn, owner: dict = Depends(require_active_subscription)
):
    db = get_db()
    student = await db.students.find_one(
        {"student_id": payload.student_id, "owner_id": owner["owner_id"]}, {"_id": 0}
    )
    if not student:
        raise HTTPException(status_code=404, detail="Aluno nao encontrado")

    client = _resolve_client()
    result = await client.enroll_start(payload.student_id, payload.device_id)
    await db.audit_logs.insert_one(
        {
            "owner_id": owner["owner_id"],
            "event": "tolletus.enroll.start",
            "student_id": payload.student_id,
            "device_id": payload.device_id,
            "created_at": datetime.now(UTC),
        }
    )
    return result


@router.post("/enroll/confirm")
async def enroll_confirm(
    payload: TolletusEnrollConfirmIn, owner: dict = Depends(require_active_subscription)
):
    db = get_db()
    student = await db.students.find_one(
        {"student_id": payload.student_id, "owner_id": owner["owner_id"]}, {"_id": 0}
    )
    if not student:
        raise HTTPException(status_code=404, detail="Aluno nao encontrado")

    client = _resolve_client()
    provider_result = await client.enroll_confirm(
        payload.student_id, payload.device_id, payload.template
    )

    now = datetime.now(UTC)
    biometric_doc = {
        "student_id": payload.student_id,
        "owner_id": owner["owner_id"],
        "provider": "tolletus",
        "template_encrypted": encrypt_template(payload.template),
        "device_id": payload.device_id,
        "external_id": payload.external_id or provider_result.get("external_id"),
        "enrolled_at": now,
        "updated_at": now,
    }
    await db.biometrics.update_one(
        {"student_id": payload.student_id, "owner_id": owner["owner_id"]},
        {"$set": biometric_doc},
        upsert=True,
    )
    return {
        "message": "Biometria cadastrada",
        "student_id": payload.student_id,
        "provider": "tolletus",
    }


@router.get("/students/{student_id}/status", response_model=TolletusStatusOut)
async def student_biometric_status(
    student_id: str, owner: dict = Depends(require_active_subscription)
):
    db = get_db()
    biometric = await db.biometrics.find_one(
        {"student_id": student_id, "owner_id": owner["owner_id"]}, {"_id": 0}
    )
    if not biometric:
        return TolletusStatusOut(student_id=student_id, has_biometric=False)
    return TolletusStatusOut(
        student_id=student_id,
        has_biometric=True,
        enrolled_at=biometric.get("enrolled_at"),
        provider=biometric.get("provider"),
    )
