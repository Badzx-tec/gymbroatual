from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ValidationError

from app.core.config import get_settings
from app.core.deps import require_roles
from app.core.time import UTC
from app.db.mongo import get_db
from app.models.plans import PlanCreateIn, PlanUpdateIn

router = APIRouter()


def _clean_doc(doc: dict) -> dict:
    sanitized = dict(doc)
    sanitized.pop("_id", None)
    return sanitized


def _coerce_datetime_utc(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    return None


def _is_access_allowed(log: dict) -> bool:
    if "autorizado" in log:
        return bool(log.get("autorizado"))
    decision = str(log.get("decision") or "").strip().lower()
    if decision:
        return decision == "allow"
    return True


def _normalize_access_log(log: dict) -> dict:
    timestamp = _coerce_datetime_utc(log.get("timestamp")) or _coerce_datetime_utc(
        log.get("created_at")
    )
    return {
        "log_id": log.get("log_id") or "",
        "student_name": (
            log.get("subject_name")
            or log.get("student_name")
            or log.get("employee_name")
            or log.get("owner_name")
            or "Nao identificado"
        ),
        "tipo": log.get("tipo") or log.get("subject_type") or log.get("method") or "acesso",
        "autorizado": _is_access_allowed(log),
        "timestamp": timestamp,
    }


def _month_floor(value: datetime) -> datetime:
    return value.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _shift_months(value: datetime, months: int) -> datetime:
    year = value.year
    month = value.month + months
    while month <= 0:
        month += 12
        year -= 1
    while month > 12:
        month -= 12
        year += 1
    return value.replace(year=year, month=month)


def _month_label(value: datetime) -> str:
    names = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
    return f"{names[value.month - 1]}/{value.year % 100:02d}"


def _can_view_financial_dashboard(actor: dict) -> bool:
    return str(actor.get("role") or "").upper() in {"OWNER", "MANAGER"}


def _default_public_plans() -> list[dict]:
    monthly = float(get_settings().subscription_monthly_amount)
    quarterly = 369.90 if round(monthly, 2) == 139.90 else round(monthly * 3 * 0.88, 2)
    return [
        {
            "plan_id": "owner_monthly",
            "nome": "GymBro Mensal",
            "valor": round(monthly, 2),
            "duration_unit": "days",
            "duration_value": 30,
            "duracao_dias": 30,
            "descricao": "Plano mensal para 1 franquia",
        },
        {
            "plan_id": "owner_quarterly",
            "nome": "GymBro Trimestral Pre-pago",
            "valor": quarterly,
            "duration_unit": "days",
            "duration_value": 90,
            "duracao_dias": 90,
            "descricao": "Plano trimestral para 1 franquia",
        },
    ]


@router.get("")
async def list_gyms(
    owner: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION", "TRAINER"))
):
    db = get_db()
    gyms = await db.gyms.find({"owner_id": owner["owner_id"]}, {"_id": 0}).to_list(20)
    return gyms


@router.get("/dashboard")
async def dashboard(
    owner: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION", "TRAINER"))
):
    db = get_db()
    owner_id = owner["owner_id"]
    can_view_financial = _can_view_financial_dashboard(owner)
    base = {"owner_id": owner["owner_id"], "is_employee_shadow": {"$ne": True}}
    total_alunos = await db.students.count_documents(base)
    alunos_ativos = await db.students.count_documents({**base, "status": "ativo"})
    alunos_inativos = await db.students.count_documents({**base, "status": "inativo"})
    now = datetime.now(UTC)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    acessos_hoje = await db.access_logs.count_documents(
        {
            **base,
            "$or": [{"timestamp": {"$gte": day_start}}, {"created_at": {"$gte": day_start}}],
        }
    )
    sem_treino = await db.students.count_documents({**base, "$or": [{"treino": {"$exists": False}}, {"treino": ""}]})

    faturamento_mensal = None
    if can_view_financial:
        revenue_window_start = now - timedelta(days=30)
        paid_charges = await db.student_charges.find(
            {"owner_id": owner_id, "status": "paid", "paid_at": {"$gte": revenue_window_start}},
            {"_id": 0, "amount": 1, "amount_received": 1},
        ).to_list(5000)
        faturamento_mensal = round(
            sum(float(item.get("amount_received") or item.get("amount") or 0) for item in paid_charges),
            2,
        )

    occupancy_window = now - timedelta(hours=2)
    current_accesses = await db.access_logs.find(
        {
            "owner_id": owner_id,
            "$or": [
                {"timestamp": {"$gte": occupancy_window}},
                {"created_at": {"$gte": occupancy_window}},
            ],
        },
        {
            "_id": 0,
            "student_id": 1,
            "student_name": 1,
            "employee_id": 1,
            "employee_name": 1,
            "autorizado": 1,
            "decision": 1,
        },
    ).to_list(4000)
    unique_subjects: set[str] = set()
    for access in current_accesses:
        if not _is_access_allowed(access):
            continue
        identity = (
            access.get("student_id")
            or access.get("employee_id")
            or access.get("student_name")
            or access.get("employee_name")
        )
        if identity:
            unique_subjects.add(str(identity))

    latest_logs_raw = (
        await db.access_logs.find({"owner_id": owner_id}, {"_id": 0})
        .sort("created_at", -1)
        .limit(120)
        .to_list(120)
    )
    latest_logs = [_normalize_access_log(item) for item in latest_logs_raw]
    latest_logs.sort(
        key=lambda item: item.get("timestamp") or datetime.min.replace(tzinfo=UTC),
        reverse=True,
    )

    return {
        "total_alunos": total_alunos,
        "alunos_ativos": alunos_ativos,
        "alunos_inativos": alunos_inativos,
        "acessos_hoje": acessos_hoje,
        "alunos_sem_treino": sem_treino,
        "faturamento_mensal": faturamento_mensal,
        "ocupacao_atual": len(unique_subjects),
        "ultimos_acessos": latest_logs[:10],
    }


async def dashboard_charts(owner: dict) -> dict:
    db = get_db()
    owner_id = owner["owner_id"]
    now = datetime.now(UTC)
    can_view_financial = _can_view_financial_dashboard(owner)

    receita_por_plano: list[dict] = []
    if can_view_financial:
        contracts = await db.student_contracts.find(
            {
                "owner_id": owner_id,
                "$or": [
                    {"status": {"$in": ["active", "past_due"]}},
                    {
                        "contract_status": {
                            "$in": [
                                "active",
                                "pending_activation",
                                "frozen",
                                "scheduled_cancel",
                                "scheduled_freeze",
                            ]
                        }
                    },
                ],
            },
            {"_id": 0, "plan_name": 1, "plan_id": 1, "amount": 1},
        ).to_list(3000)
        plan_totals: dict[str, float] = defaultdict(float)
        for contract in contracts:
            plan_name = contract.get("plan_name") or contract.get("plan_id") or "Sem plano"
            plan_totals[str(plan_name)] += float(contract.get("amount") or 0)
        receita_por_plano = [
            {"plano": plan_name, "valor": round(total, 2)}
            for plan_name, total in sorted(plan_totals.items(), key=lambda item: item[1], reverse=True)
        ]

    hour_start = (now - timedelta(hours=23)).replace(minute=0, second=0, microsecond=0)
    hour_buckets = [hour_start + timedelta(hours=index) for index in range(24)]
    hour_counts = {
        bucket.strftime("%Y-%m-%d %H:%M"): 0
        for bucket in hour_buckets
    }
    access_logs = await db.access_logs.find(
        {
            "owner_id": owner_id,
            "$or": [
                {"timestamp": {"$gte": hour_start}},
                {"created_at": {"$gte": hour_start}},
            ],
        },
        {"_id": 0, "timestamp": 1, "created_at": 1},
    ).to_list(5000)
    for access in access_logs:
        timestamp = _coerce_datetime_utc(access.get("timestamp")) or _coerce_datetime_utc(
            access.get("created_at")
        )
        if not timestamp:
            continue
        bucket_key = timestamp.replace(minute=0, second=0, microsecond=0).strftime("%Y-%m-%d %H:%M")
        if bucket_key in hour_counts:
            hour_counts[bucket_key] += 1
    acessos_por_hora = [
        {"hora": bucket.strftime("%H:00"), "acessos": hour_counts[bucket.strftime("%Y-%m-%d %H:%M")]}
        for bucket in hour_buckets
    ]

    receita_mensal: list[dict] = []
    if can_view_financial:
        current_month = _month_floor(now)
        month_buckets = [_month_floor(_shift_months(current_month, -offset)) for offset in range(5, -1, -1)]
        month_start = month_buckets[0]
        charges = await db.student_charges.find(
            {"owner_id": owner_id, "status": "paid", "paid_at": {"$gte": month_start}},
            {"_id": 0, "paid_at": 1, "amount": 1, "amount_received": 1},
        ).to_list(10000)
        month_totals: dict[str, float] = {
            bucket.strftime("%Y-%m"): 0.0
            for bucket in month_buckets
        }
        for charge in charges:
            paid_at = _coerce_datetime_utc(charge.get("paid_at"))
            if not paid_at:
                continue
            month_key = paid_at.strftime("%Y-%m")
            if month_key not in month_totals:
                continue
            month_totals[month_key] += float(charge.get("amount_received") or charge.get("amount") or 0)
        receita_mensal = [
            {"mes": _month_label(bucket), "valor": round(month_totals[bucket.strftime("%Y-%m")], 2)}
            for bucket in month_buckets
        ]

    return {
        "receita_por_plano": receita_por_plano,
        "acessos_por_hora": acessos_por_hora,
        "receita_mensal": receita_mensal,
    }


@router.get("/access-logs")
async def access_logs(
    limit: int = Query(default=100, ge=1, le=1000),
    owner: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION", "TRAINER")),
):
    db = get_db()
    return (
        await db.access_logs.find({"owner_id": owner["owner_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )


@router.get("/plans")
async def list_plans(
    owner: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION", "TRAINER"))
):
    db = get_db()
    return await db.plans.find({"owner_id": owner["owner_id"]}, {"_id": 0}).to_list(200)


@router.get("/plans/public")
async def list_plans_public():
    db = get_db()
    default_plans = _default_public_plans()
    plans = await db.public_plans.find({}, {"_id": 0}).to_list(20)
    if not plans:
        return default_plans

    by_id = {
        str(plan.get("plan_id")): plan
        for plan in plans
        if isinstance(plan, dict) and plan.get("plan_id")
    }
    merged = []
    for default_plan in default_plans:
        merged.append(by_id.pop(default_plan["plan_id"], default_plan))
    merged.extend(by_id.values())
    return merged[:20]


@router.post("/plans")
async def create_plan(payload: dict, owner: dict = Depends(require_roles("OWNER", "MANAGER"))):
    db = get_db()
    try:
        normalized = PlanCreateIn.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc

    plan_id = normalized.plan_id or f"pln_{datetime.now(UTC).timestamp():.0f}"
    doc = {
        "plan_id": plan_id,
        "owner_id": owner["owner_id"],
        **normalized.model_dump(exclude={"plan_id"}),
    }
    await db.plans.insert_one(doc)
    return _clean_doc(doc)


@router.put("/plans/{plan_id}")
async def update_plan(
    plan_id: str,
    payload: dict,
    owner: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    db = get_db()
    try:
        normalized = PlanUpdateIn.model_validate(payload).model_dump(
            exclude_none=True, exclude={"updated_at"}
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc
    if not normalized:
        raise HTTPException(status_code=400, detail="Nenhum campo valido para atualizar")
    normalized["updated_at"] = datetime.now(UTC)

    result = await db.plans.update_one(
        {"plan_id": plan_id, "owner_id": owner["owner_id"]}, {"$set": normalized}
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Plano nao encontrado")
    return await db.plans.find_one({"plan_id": plan_id, "owner_id": owner["owner_id"]}, {"_id": 0})


@router.delete("/plans/{plan_id}")
async def delete_plan(plan_id: str, owner: dict = Depends(require_roles("OWNER", "MANAGER"))):
    db = get_db()
    result = await db.plans.delete_one({"plan_id": plan_id, "owner_id": owner["owner_id"]})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Plano nao encontrado")
    return {"message": "Plano removido"}
