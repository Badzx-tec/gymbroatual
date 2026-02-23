from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from app.core.deps import require_active_subscription
from app.core.time import UTC
from app.db.mongo import get_db

router = APIRouter()


@router.get("")
async def list_gyms(owner: dict = Depends(require_active_subscription)):
    db = get_db()
    gyms = await db.gyms.find({"owner_id": owner["owner_id"]}, {"_id": 0}).to_list(20)
    return gyms


@router.get("/dashboard")
async def dashboard(owner: dict = Depends(require_active_subscription)):
    db = get_db()
    base = {"owner_id": owner["owner_id"]}
    total_alunos = await db.students.count_documents(base)
    alunos_ativos = await db.students.count_documents({**base, "status": "ativo"})
    alunos_inativos = await db.students.count_documents({**base, "status": "inativo"})
    day_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    acessos_hoje = await db.access_logs.count_documents(
        {
            **base,
            "$or": [{"timestamp": {"$gte": day_start}}, {"created_at": {"$gte": day_start}}],
        }
    )
    sem_treino = await db.students.count_documents(
        {**base, "$or": [{"treino": {"$exists": False}}, {"treino": ""}]}
    )

    return {
        "total_alunos": total_alunos,
        "alunos_ativos": alunos_ativos,
        "alunos_inativos": alunos_inativos,
        "acessos_hoje": acessos_hoje,
        "alunos_sem_treino": sem_treino,
    }


@router.get("/access-logs")
async def access_logs(limit: int = 100, owner: dict = Depends(require_active_subscription)):
    db = get_db()
    return (
        await db.access_logs.find({"owner_id": owner["owner_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )


@router.get("/plans")
async def list_plans(owner: dict = Depends(require_active_subscription)):
    db = get_db()
    return await db.plans.find({"owner_id": owner["owner_id"]}, {"_id": 0}).to_list(50)


@router.get("/plans/public")
async def list_plans_public():
    db = get_db()
    plans = await db.public_plans.find({}, {"_id": 0}).to_list(20)
    if plans:
        return plans
    return [
        {
            "plan_id": "owner_monthly",
            "nome": "GymBro SaaS",
            "valor": 139.9,
            "duracao_dias": 30,
            "descricao": "Plano mensal do dono da academia",
        }
    ]


@router.post("/plans")
async def create_plan(payload: dict, owner: dict = Depends(require_active_subscription)):
    db = get_db()
    doc = {
        "plan_id": payload.get("plan_id") or f"pln_{datetime.now(UTC).timestamp():.0f}",
        "owner_id": owner["owner_id"],
        **payload,
    }
    await db.plans.insert_one(doc)
    return doc


@router.put("/plans/{plan_id}")
async def update_plan(
    plan_id: str, payload: dict, owner: dict = Depends(require_active_subscription)
):
    db = get_db()
    result = await db.plans.update_one(
        {"plan_id": plan_id, "owner_id": owner["owner_id"]}, {"$set": payload}
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Plano nao encontrado")
    return await db.plans.find_one({"plan_id": plan_id, "owner_id": owner["owner_id"]}, {"_id": 0})


@router.delete("/plans/{plan_id}")
async def delete_plan(plan_id: str, owner: dict = Depends(require_active_subscription)):
    db = get_db()
    result = await db.plans.delete_one({"plan_id": plan_id, "owner_id": owner["owner_id"]})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Plano nao encontrado")
    return {"message": "Plano removido"}
