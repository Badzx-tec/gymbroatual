from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from app.core.deps import require_admin_actor
from app.core.time import UTC
from app.db.mongo import get_db
from app.integrations.tolletus.client import get_tolletus_client
from app.models.students import (
    TolletusEmployeeEnrollConfirmIn,
    TolletusEmployeeEnrollStartIn,
    TolletusEmployeeStatusOut,
    TolletusEnrollConfirmIn,
    TolletusEnrollStartIn,
    TolletusStatusOut,
)
from app.services.biometric_credentials import (
    mask_biometric_credential,
    normalize_biometric_credential,
)
from app.services.crypto import encrypt_template
from app.services.observability import log_event

router = APIRouter()


def _resolve_client():
    try:
        return get_tolletus_client()
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _resolve_credential_id(
    payload_external_id: str | None, provider_result: dict
) -> str:
    credential_id = normalize_biometric_credential(
        payload_external_id or provider_result.get("external_id")
    )
    if not credential_id:
        raise HTTPException(
            status_code=502,
            detail="Tolletus enroll confirm sem external_id utilizavel",
        )
    return credential_id


@router.post("/enroll/start")
async def enroll_start(
    payload: TolletusEnrollStartIn, owner: dict = Depends(require_admin_actor())
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
    payload: TolletusEnrollConfirmIn, owner: dict = Depends(require_admin_actor())
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
    credential_id = _resolve_credential_id(payload.external_id, provider_result)

    now = datetime.now(UTC)
    biometric_doc = {
        "student_id": payload.student_id,
        "subject_type": "student",
        "subject_id": payload.student_id,
        "owner_id": owner["owner_id"],
        "provider": "tolletus",
        "template_encrypted": encrypt_template(payload.template),
        "device_id": payload.device_id,
        "external_id": credential_id,
        "enrolled_at": now,
        "updated_at": now,
    }
    await db.biometrics.update_one(
        {"student_id": payload.student_id, "owner_id": owner["owner_id"]},
        {"$set": biometric_doc},
        upsert=True,
    )
    await db.students.update_one(
        {"student_id": payload.student_id, "owner_id": owner["owner_id"]},
        {
            "$set": {
                "biometria_id": credential_id,
                "updated_at": now,
            }
        },
    )
    log_event(
        "tolletus_student_enroll_confirm",
        owner_id=owner["owner_id"],
        student_id=payload.student_id,
        device_id=payload.device_id,
        provider="tolletus",
        credential_masked=mask_biometric_credential(credential_id),
        linked=True,
    )
    return {
        "message": "Biometria cadastrada",
        "student_id": payload.student_id,
        "provider": "tolletus",
        "biometria_id": credential_id,
    }


@router.get("/students/{student_id}/status", response_model=TolletusStatusOut)
async def student_biometric_status(
    student_id: str, owner: dict = Depends(require_admin_actor())
):
    db = get_db()
    biometric = await db.biometrics.find_one(
        {
            "owner_id": owner["owner_id"],
            "$or": [
                {"student_id": student_id},
                {"subject_type": "student", "subject_id": student_id},
            ],
        },
        {"_id": 0},
    )
    if not biometric:
        return TolletusStatusOut(student_id=student_id, has_biometric=False)
    return TolletusStatusOut(
        student_id=student_id,
        has_biometric=True,
        enrolled_at=biometric.get("enrolled_at"),
        provider=biometric.get("provider"),
    )


@router.post("/employees/enroll/start")
async def employee_enroll_start(
    payload: TolletusEmployeeEnrollStartIn,
    owner: dict = Depends(require_admin_actor()),
):
    db = get_db()
    employee = await db.employees.find_one(
        {"employee_id": payload.employee_id, "owner_id": owner["owner_id"]},
        {"_id": 0},
    )
    if not employee:
        raise HTTPException(status_code=404, detail="Funcionario nao encontrado")

    client = _resolve_client()
    result = await client.enroll_start(payload.employee_id, payload.device_id)
    await db.audit_logs.insert_one(
        {
            "owner_id": owner["owner_id"],
            "event": "tolletus.employee.enroll.start",
            "employee_id": payload.employee_id,
            "device_id": payload.device_id,
            "created_at": datetime.now(UTC),
        }
    )
    return result


@router.post("/employees/enroll/confirm")
async def employee_enroll_confirm(
    payload: TolletusEmployeeEnrollConfirmIn,
    owner: dict = Depends(require_admin_actor()),
):
    db = get_db()
    employee = await db.employees.find_one(
        {"employee_id": payload.employee_id, "owner_id": owner["owner_id"]},
        {"_id": 0},
    )
    if not employee:
        raise HTTPException(status_code=404, detail="Funcionario nao encontrado")

    client = _resolve_client()
    provider_result = await client.enroll_confirm(
        payload.employee_id, payload.device_id, payload.template
    )

    now = datetime.now(UTC)
    credential_id = _resolve_credential_id(payload.external_id, provider_result)
    biometric_doc = {
        "employee_id": payload.employee_id,
        "subject_type": "employee",
        "subject_id": payload.employee_id,
        "owner_id": owner["owner_id"],
        "provider": "tolletus",
        "template_encrypted": encrypt_template(payload.template),
        "device_id": payload.device_id,
        "external_id": credential_id,
        "enrolled_at": now,
        "updated_at": now,
    }
    await db.biometrics.update_one(
        {"employee_id": payload.employee_id, "owner_id": owner["owner_id"]},
        {"$set": biometric_doc},
        upsert=True,
    )

    employee_update = {"updated_at": now}
    if credential_id:
        employee_update["biometria_id"] = str(credential_id)
    await db.employees.update_one(
        {"employee_id": payload.employee_id, "owner_id": owner["owner_id"]},
        {"$set": employee_update},
    )
    log_event(
        "tolletus_employee_enroll_confirm",
        owner_id=owner["owner_id"],
        employee_id=payload.employee_id,
        device_id=payload.device_id,
        provider="tolletus",
        credential_masked=mask_biometric_credential(credential_id),
        linked=True,
    )

    return {
        "message": "Biometria de funcionario cadastrada",
        "employee_id": payload.employee_id,
        "provider": "tolletus",
        "biometria_id": str(credential_id) if credential_id else None,
    }


@router.get("/employees/{employee_id}/status", response_model=TolletusEmployeeStatusOut)
async def employee_biometric_status(
    employee_id: str, owner: dict = Depends(require_admin_actor())
):
    db = get_db()
    biometric = await db.biometrics.find_one(
        {
            "owner_id": owner["owner_id"],
            "$or": [
                {"employee_id": employee_id},
                {"subject_type": "employee", "subject_id": employee_id},
            ],
        },
        {"_id": 0},
    )
    employee = await db.employees.find_one(
        {"employee_id": employee_id, "owner_id": owner["owner_id"]},
        {"_id": 0, "biometria_id": 1},
    )
    if not biometric:
        return TolletusEmployeeStatusOut(
            employee_id=employee_id,
            has_biometric=bool(employee and employee.get("biometria_id")),
            biometria_id=(employee or {}).get("biometria_id"),
        )

    return TolletusEmployeeStatusOut(
        employee_id=employee_id,
        has_biometric=True,
        enrolled_at=biometric.get("enrolled_at"),
        provider=biometric.get("provider"),
        biometria_id=(employee or {}).get("biometria_id")
        or biometric.get("external_id"),
    )
