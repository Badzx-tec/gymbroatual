import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.deps import require_active_subscription
from app.db.mongo import get_db
from app.models.students import AttendanceIn, MeasurementIn, StudentIn, WorkoutPlanIn

router = APIRouter()


@router.get("")
async def list_students(
    search: str = "",
    status: str = "",
    owner: dict = Depends(require_active_subscription),
):
    db = get_db()
    query = {"owner_id": owner["owner_id"]}
    if status:
        query["status"] = status
    if search:
        query["$or"] = [
            {"nome": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
            {"telefone": {"$regex": search, "$options": "i"}},
            {"matricula": {"$regex": search, "$options": "i"}},
        ]

    return await db.students.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.post("")
async def create_student(
    payload: StudentIn, owner: dict = Depends(require_active_subscription)
):
    db = get_db()
    now = datetime.now(UTC)
    student_id = f"std_{secrets.token_hex(6)}"
    doc = {
        "student_id": student_id,
        "owner_id": owner["owner_id"],
        "gym_id": owner["gym_id"],
        **payload.model_dump(),
        "created_at": now,
        "updated_at": now,
    }
    await db.students.insert_one(doc)
    return doc


@router.get("/{student_id}")
async def get_student(
    student_id: str, owner: dict = Depends(require_active_subscription)
):
    db = get_db()
    student = await db.students.find_one(
        {"student_id": student_id, "owner_id": owner["owner_id"]},
        {"_id": 0},
    )
    if not student:
        raise HTTPException(status_code=404, detail="Aluno nao encontrado")

    student["measurements"] = (
        await db.measurements.find(
            {"student_id": student_id, "owner_id": owner["owner_id"]},
            {"_id": 0},
        )
        .sort("data", -1)
        .to_list(100)
    )
    student["workouts"] = (
        await db.workouts.find(
            {"student_id": student_id, "owner_id": owner["owner_id"]},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .to_list(20)
    )
    student["attendance"] = (
        await db.attendance.find(
            {"student_id": student_id, "owner_id": owner["owner_id"]},
            {"_id": 0},
        )
        .sort("date_time", -1)
        .to_list(100)
    )
    return student


@router.put("/{student_id}")
async def update_student(
    student_id: str, payload: dict, owner: dict = Depends(require_active_subscription)
):
    db = get_db()
    now = datetime.now(UTC)
    result = await db.students.update_one(
        {"student_id": student_id, "owner_id": owner["owner_id"]},
        {"$set": {**payload, "updated_at": now}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Aluno nao encontrado")
    return await db.students.find_one(
        {"student_id": student_id, "owner_id": owner["owner_id"]}, {"_id": 0}
    )


@router.delete("/{student_id}")
async def delete_student(
    student_id: str, owner: dict = Depends(require_active_subscription)
):
    db = get_db()
    result = await db.students.delete_one(
        {"student_id": student_id, "owner_id": owner["owner_id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Aluno nao encontrado")
    return {"message": "Aluno removido"}


@router.post("/{student_id}/measurements")
async def add_measurement(
    student_id: str,
    payload: MeasurementIn,
    owner: dict = Depends(require_active_subscription),
):
    db = get_db()
    doc = {
        "measurement_id": f"mea_{secrets.token_hex(6)}",
        "student_id": student_id,
        "owner_id": owner["owner_id"],
        "gym_id": owner["gym_id"],
        **payload.model_dump(by_alias=False),
        "created_at": datetime.now(UTC),
    }
    await db.measurements.insert_one(doc)
    return doc


@router.get("/{student_id}/measurements")
async def list_measurements(
    student_id: str, owner: dict = Depends(require_active_subscription)
):
    db = get_db()
    return (
        await db.measurements.find(
            {"student_id": student_id, "owner_id": owner["owner_id"]},
            {"_id": 0},
        )
        .sort("data", -1)
        .to_list(200)
    )


@router.post("/{student_id}/workouts")
async def add_workout(
    student_id: str,
    payload: WorkoutPlanIn,
    owner: dict = Depends(require_active_subscription),
):
    db = get_db()
    doc = {
        "workout_id": f"wrk_{secrets.token_hex(6)}",
        "student_id": student_id,
        "owner_id": owner["owner_id"],
        "gym_id": owner["gym_id"],
        **payload.model_dump(),
        "created_at": datetime.now(UTC),
    }
    await db.workouts.insert_one(doc)
    return doc


@router.get("/{student_id}/workouts")
async def list_workouts(
    student_id: str, owner: dict = Depends(require_active_subscription)
):
    db = get_db()
    return (
        await db.workouts.find(
            {"student_id": student_id, "owner_id": owner["owner_id"]},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .to_list(100)
    )


@router.post("/{student_id}/attendance")
async def add_attendance(
    student_id: str,
    payload: AttendanceIn,
    owner: dict = Depends(require_active_subscription),
):
    db = get_db()
    doc = {
        "attendance_id": f"att_{secrets.token_hex(6)}",
        "student_id": student_id,
        "owner_id": owner["owner_id"],
        "gym_id": owner["gym_id"],
        **payload.model_dump(),
        "created_at": datetime.now(UTC),
    }
    await db.attendance.insert_one(doc)
    await db.access_logs.insert_one(
        {
            "log_id": f"log_{secrets.token_hex(6)}",
            "student_id": student_id,
            "student_name": (
                await db.students.find_one(
                    {"student_id": student_id}, {"nome": 1, "_id": 0}
                )
                or {}
            ).get("nome", "Aluno"),
            "tag_id": student_id,
            "tipo": payload.source,
            "autorizado": True,
            "motivo": "Acesso registrado",
            "timestamp": payload.date_time,
            "owner_id": owner["owner_id"],
            "gym_id": owner["gym_id"],
        }
    )
    return doc


@router.get("/{student_id}/attendance")
async def list_attendance(
    student_id: str,
    owner: dict = Depends(require_active_subscription),
    limit: int = Query(default=100, le=500),
):
    db = get_db()
    return (
        await db.attendance.find(
            {"student_id": student_id, "owner_id": owner["owner_id"]},
            {"_id": 0},
        )
        .sort("date_time", -1)
        .limit(limit)
        .to_list(limit)
    )
