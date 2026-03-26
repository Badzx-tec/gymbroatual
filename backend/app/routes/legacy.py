import secrets
from datetime import datetime

from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
)

from app.core.deps import require_admin_actor, require_roles
from app.core.time import UTC
from app.db.mongo import get_db
from app.services.biometric_credentials import normalize_biometric_credential
from app.services.report_exports import as_text, students_pdf_response, xlsx_response

from . import billing as billing_routes
from . import gyms as gym_routes
from . import turnstiles as turnstile_routes

router = APIRouter()


def _clean_doc(doc: dict) -> dict:
    sanitized = dict(doc)
    sanitized.pop("_id", None)
    return sanitized


def _extract_notification_ids(payload: dict | None) -> list[str]:
    payload = payload or {}
    raw_ids = payload.get("notif_ids") or payload.get("ids") or []
    if not isinstance(raw_ids, list):
        raise HTTPException(status_code=422, detail="notif_ids deve ser uma lista")

    normalized: list[str] = []
    seen: set[str] = set()
    for item in raw_ids[:300]:
        notif_id = str(item or "").strip()
        if not notif_id or notif_id in seen:
            continue
        seen.add(notif_id)
        normalized.append(notif_id)

    if not normalized:
        raise HTTPException(
            status_code=422, detail="Selecione ao menos uma notificacao"
        )

    return normalized


@router.get("/dashboard")
async def dashboard(actor: dict = Depends(require_admin_actor())):
    return await gym_routes.dashboard(actor)


@router.get("/dashboard/charts")
async def dashboard_charts(actor: dict = Depends(require_admin_actor())) -> dict:
    return await gym_routes.dashboard_charts(actor)


@router.get("/access-logs")
async def access_logs(
    limit: int = Query(default=100, ge=1, le=1000),
    actor: dict = Depends(require_admin_actor()),
):
    return await gym_routes.access_logs(limit=limit, owner=actor)


@router.get("/plans")
async def plans(actor: dict = Depends(require_admin_actor())):
    return await gym_routes.list_plans(actor)


@router.get("/plans/public")
async def plans_public():
    return await gym_routes.list_plans_public()


@router.post("/plans")
async def create_plan(
    payload: dict, actor: dict = Depends(require_roles("OWNER", "MANAGER"))
):
    return await gym_routes.create_plan(payload, actor)


@router.put("/plans/{plan_id}")
async def update_plan(
    plan_id: str,
    payload: dict,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    return await gym_routes.update_plan(plan_id, payload, actor)


@router.delete("/plans/{plan_id}")
async def delete_plan(
    plan_id: str, actor: dict = Depends(require_roles("OWNER", "MANAGER"))
):
    return await gym_routes.delete_plan(plan_id, actor)


@router.get("/academies")
async def list_academies(actor: dict = Depends(require_admin_actor())):
    return await gym_routes.list_gyms(actor)


@router.post("/academies")
async def create_academy(payload: dict, actor: dict = Depends(require_admin_actor())):
    raise HTTPException(status_code=403, detail="Gestao de franquias desabilitada")


@router.put("/academies/{academy_id}")
async def update_academy(
    academy_id: str, payload: dict, actor: dict = Depends(require_admin_actor())
):
    raise HTTPException(status_code=403, detail="Gestao de franquias desabilitada")


@router.delete("/academies/{academy_id}")
async def delete_academy(academy_id: str, actor: dict = Depends(require_admin_actor())):
    raise HTTPException(status_code=403, detail="Gestao de franquias desabilitada")


@router.get("/academies/{academy_id}/stats")
async def academy_stats(academy_id: str, actor: dict = Depends(require_admin_actor())):
    db = get_db()
    q = {"owner_id": actor["owner_id"], "gym_id": academy_id}
    total = await db.students.count_documents(q)
    active = await db.students.count_documents({**q, "status": "ativo"})
    return {"total_alunos": total, "alunos_ativos": active, "faturamento": 0}


@router.get("/academies/{academy_id}/billing")
async def academy_billing(
    academy_id: str, actor: dict = Depends(require_roles("OWNER", "MANAGER"))
):
    status = await billing_routes.subscription_status(actor)
    return {
        "academy_id": academy_id,
        "academy_name": "Academia",
        "status": status.status,
        "trial_until": status.trial_ends_at,
        "paid_until": status.current_period_end,
        "billing_history": [],
    }


@router.post("/payments/academy/subscription/checkout")
async def academy_checkout(
    _: dict, actor: dict = Depends(require_roles("OWNER", "MANAGER"))
):
    return await billing_routes.subscription_checkout(actor)


@router.get("/notifications")
async def notifications(
    limit: int = Query(default=50, ge=1, le=300),
    actor: dict = Depends(require_admin_actor()),
):
    db = get_db()
    return (
        await db.notifications.find({"owner_id": actor["owner_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )


@router.post("/notifications/check-expiring")
async def notifications_check(actor: dict = Depends(require_admin_actor())):
    db = get_db()
    count = 0
    for student in await db.students.find(
        {"owner_id": actor["owner_id"], "status": "ativo"}, {"_id": 0}
    ).to_list(500):
        if not student.get("email"):
            continue
        notif = {
            "notif_id": f"n_{secrets.token_hex(6)}",
            "owner_id": actor["owner_id"],
            "student_id": student["student_id"],
            "student_email": student.get("email", ""),
            "tipo": "vencimento",
            "titulo": "Acompanhar aluno",
            "mensagem": f"Aluno {student.get('nome', '')} sem treino atualizado recentemente.",
            "lida": False,
            "email_enviado": False,
            "email_status": "simulado",
            "created_at": datetime.now(UTC),
        }
        await db.notifications.insert_one(notif)
        count += 1
    return {"message": f"{count} notificacoes geradas"}


@router.put("/notifications/{notif_id}/read")
async def notification_read(
    notif_id: str, actor: dict = Depends(require_admin_actor())
):
    db = get_db()
    await db.notifications.update_one(
        {"notif_id": notif_id, "owner_id": actor["owner_id"]},
        {"$set": {"lida": True, "read_at": datetime.now(UTC)}},
    )
    return {"message": "ok"}


@router.post("/notifications/read-bulk")
async def notification_read_bulk(
    payload: dict, actor: dict = Depends(require_admin_actor())
):
    db = get_db()
    notif_ids = _extract_notification_ids(payload)
    result = await db.notifications.update_many(
        {"notif_id": {"$in": notif_ids}, "owner_id": actor["owner_id"]},
        {"$set": {"lida": True, "read_at": datetime.now(UTC)}},
    )
    return {
        "message": "ok",
        "updated": int(result.modified_count or 0),
        "notif_ids": notif_ids,
    }


@router.delete("/notifications/{notif_id}")
async def notification_delete(
    notif_id: str, actor: dict = Depends(require_admin_actor())
):
    db = get_db()
    await db.notifications.delete_one(
        {"notif_id": notif_id, "owner_id": actor["owner_id"]}
    )
    return {"message": "ok"}


@router.post("/notifications/delete-bulk")
async def notification_delete_bulk(
    payload: dict, actor: dict = Depends(require_admin_actor())
):
    db = get_db()
    notif_ids = _extract_notification_ids(payload)
    result = await db.notifications.delete_many(
        {"notif_id": {"$in": notif_ids}, "owner_id": actor["owner_id"]}
    )
    return {
        "message": "ok",
        "deleted": int(result.deleted_count or 0),
        "notif_ids": notif_ids,
    }


@router.post("/catraca/command")
async def catraca_command(payload: dict, actor: dict = Depends(require_admin_actor())):
    db = get_db()
    action = str(payload.get("action") or "").strip().lower()
    target_scope = payload.get("target_scope") or payload.get("scope") or "all"
    control_state = None
    status_value = "pending"
    normalized_action = turnstile_routes._normalize_control_action(action)
    if normalized_action in turnstile_routes.CONTROL_ACTIONS:
        control_state = await turnstile_routes.apply_turnstile_control_action(
            owner_id=actor["owner_id"],
            gym_id=actor.get("gym_id"),
            action=action,
            scope=target_scope,
            actor_id=actor.get("employee_id") or actor.get("owner_id"),
            actor_role=str(actor.get("role") or "").upper() or None,
        )
        status_value = "applied"

    doc = {
        "cmd_id": f"cmd_{secrets.token_hex(6)}",
        "owner_id": actor["owner_id"],
        "action": action,
        "target_scope": turnstile_routes._normalize_control_scope(target_scope),
        "message": payload.get("message", ""),
        "status": status_value,
        "command_type": (
            "turnstile_control_state" if control_state else "legacy_forward"
        ),
        "created_at": datetime.now(UTC),
    }
    await db.catraca_commands.insert_one(doc)
    response = _clean_doc(doc)
    if control_state:
        response["control_state"] = control_state
    return response


@router.get("/catraca/commands")
async def catraca_commands(actor: dict = Depends(require_admin_actor())):
    db = get_db()
    return (
        await db.catraca_commands.find({"owner_id": actor["owner_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(50)
        .to_list(50)
    )


@router.get("/catraca/control-state")
async def catraca_control_state(actor: dict = Depends(require_admin_actor())):
    return await turnstile_routes.get_turnstile_control_state(
        owner_id=actor["owner_id"],
        gym_id=actor.get("gym_id"),
    )


@router.get("/webhook-logs")
async def webhook_logs(
    limit: int = Query(default=50, ge=1, le=300),
    actor: dict = Depends(require_admin_actor()),
):
    db = get_db()
    return (
        await db.billing_events.find({"owner_id": actor["owner_id"]}, {"_id": 0})
        .sort("received_at", -1)
        .limit(limit)
        .to_list(limit)
    )


@router.get("/reports/students/excel")
async def export_students_excel(actor: dict = Depends(require_admin_actor())):
    db = get_db()
    students = (
        await db.students.find({"owner_id": actor["owner_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(5000)
    )
    headers = [
        "ID",
        "Nome",
        "Email",
        "CPF",
        "Telefone",
        "Plano",
        "Status",
        "Vencimento",
        "Criado em",
    ]
    rows = [
        [
            as_text(student.get("student_id")),
            as_text(student.get("nome")),
            as_text(student.get("email")),
            as_text(student.get("cpf")),
            as_text(student.get("telefone")),
            as_text(student.get("plano_id")),
            as_text(student.get("status")),
            as_text(student.get("data_vencimento")),
            as_text(student.get("created_at")),
        ]
        for student in students
    ]
    return xlsx_response("alunos_gymbro.xlsx", "Alunos", headers, rows)


@router.get("/reports/students/pdf")
async def export_students_pdf(actor: dict = Depends(require_admin_actor())):
    db = get_db()
    students = (
        await db.students.find({"owner_id": actor["owner_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(3000)
    )
    rows = [
        [
            as_text(student.get("student_id")),
            as_text(student.get("nome")),
            as_text(student.get("email")),
            as_text(student.get("cpf")),
            as_text(student.get("telefone")),
            as_text(student.get("plano_id")),
            as_text(student.get("status")),
            as_text(student.get("created_at")),
        ]
        for student in students
    ]
    return students_pdf_response("alunos_gymbro.pdf", rows)


@router.get("/reports/access-logs/excel")
async def export_access_excel(actor: dict = Depends(require_admin_actor())):
    db = get_db()
    logs = (
        await db.access_logs.find({"owner_id": actor["owner_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(10000)
    )
    headers = [
        "Data/Hora",
        "Perfil",
        "Pessoa",
        "ID Pessoa",
        "Direcao",
        "Metodo",
        "Autorizado",
        "Motivo",
    ]
    rows = [
        [
            as_text(log.get("timestamp") or log.get("created_at")),
            as_text(log.get("subject_type") or log.get("tipo")),
            as_text(
                log.get("subject_name")
                or log.get("student_name")
                or log.get("employee_name")
                or log.get("owner_name")
            ),
            as_text(
                log.get("subject_id") or log.get("student_id") or log.get("employee_id")
            ),
            as_text(log.get("direction")),
            as_text(log.get("method")),
            as_text(
                log.get("autorizado")
                if log.get("autorizado") is not None
                else str(log.get("decision") or "").lower() == "allow"
            ),
            as_text(log.get("motivo") or log.get("reason")),
        ]
        for log in logs
    ]
    return xlsx_response("acessos_gymbro.xlsx", "Acessos", headers, rows)


@router.get("/reports/financial/excel")
async def export_financial_excel(
    actor: dict = Depends(require_roles("OWNER", "MANAGER"))
):
    db = get_db()
    invoices = (
        await db.invoices.find({"owner_id": actor["owner_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(5000)
    )
    charges = (
        await db.student_charges.find({"owner_id": actor["owner_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(5000)
    )
    headers = [
        "Tipo",
        "Referencia",
        "Status",
        "Valor",
        "Vencimento",
        "Pago em",
        "Origem",
    ]
    rows: list[list[str]] = []
    for invoice in invoices:
        rows.append(
            [
                "Assinatura SaaS",
                as_text(invoice.get("period_label") or invoice.get("invoice_id")),
                as_text(invoice.get("status")),
                as_text(invoice.get("amount")),
                as_text(invoice.get("due_at") or invoice.get("created_at")),
                as_text(invoice.get("paid_at")),
                "billing.invoices",
            ]
        )
    for charge in charges:
        rows.append(
            [
                "Contrato Aluno",
                as_text(charge.get("charge_id")),
                as_text(charge.get("status")),
                as_text(charge.get("amount")),
                as_text(charge.get("due_at")),
                as_text(charge.get("paid_at")),
                "student_charges",
            ]
        )
    return xlsx_response("financeiro_gymbro.xlsx", "Financeiro", headers, rows)


@router.post("/students/{student_id}/biometria")
async def students_biometria(
    student_id: str, payload: dict, actor: dict = Depends(require_admin_actor())
):
    db = get_db()
    biometria_id = normalize_biometric_credential(payload.get("biometria_id"))
    await db.students.update_one(
        {"student_id": student_id, "owner_id": actor["owner_id"]},
        {
            "$set": {
                "biometria_id": biometria_id,
                "updated_at": datetime.now(UTC),
            }
        },
    )
    return {"message": "ok"}


@router.post("/students/{student_id}/progress")
async def student_progress(
    student_id: str, payload: dict, actor: dict = Depends(require_admin_actor())
):
    db = get_db()
    doc = {
        "progress_id": f"prg_{secrets.token_hex(6)}",
        "student_id": student_id,
        "owner_id": actor["owner_id"],
        **payload,
        "created_at": datetime.now(UTC),
    }
    await db.measurements.insert_one(doc)
    return _clean_doc(doc)


@router.get("/students/{student_id}/progress")
async def student_progress_list(
    student_id: str,
    actor: dict = Depends(require_admin_actor()),
    limit: int = Query(default=50, ge=1, le=300),
):
    db = get_db()
    records = (
        await db.measurements.find(
            {"student_id": student_id, "owner_id": actor["owner_id"]}, {"_id": 0}
        )
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )
    return {"student_id": student_id, "progress_records": records}


@router.post("/students/{student_id}/passkey/register")
async def register_passkey(
    student_id: str, _: dict, actor: dict = Depends(require_admin_actor())
):
    return {
        "message": "Passkey placeholder",
        "student_id": student_id,
        "owner_id": actor["owner_id"],
    }


@router.post("/students/{student_id}/passkey/register/options")
async def passkey_opts(student_id: str, actor: dict = Depends(require_admin_actor())):
    return {
        "state_id": f"st_{student_id}",
        "publicKey": {"challenge": "", "user": {"id": ""}, "excludeCredentials": []},
    }


@router.post("/students/{student_id}/passkey/register/verify")
async def passkey_verify(
    student_id: str, _: dict, actor: dict = Depends(require_admin_actor())
):
    return {"message": "ok", "student_id": student_id, "owner_id": actor["owner_id"]}


@router.get("/students/{student_id}/passkeys")
async def list_passkeys(student_id: str, actor: dict = Depends(require_admin_actor())):
    return {"student_id": student_id, "webauthn_credentials": []}


@router.post("/seed")
async def seed(actor: dict = Depends(require_admin_actor())):
    db = get_db()
    now = datetime.now(UTC)
    plans = await db.plans.count_documents({"owner_id": actor["owner_id"]})
    if plans == 0:
        await db.plans.insert_many(
            [
                {
                    "plan_id": "mensal",
                    "owner_id": actor["owner_id"],
                    "nome": "Mensal",
                    "valor": 139.9,
                    "duracao_dias": 30,
                    "ativo": True,
                    "created_at": now,
                },
                {
                    "plan_id": "trimestral",
                    "owner_id": actor["owner_id"],
                    "nome": "Trimestral",
                    "valor": 369.9,
                    "duracao_dias": 90,
                    "ativo": True,
                    "created_at": now,
                },
            ]
        )
    return {"message": "ok"}


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            await websocket.receive_text()
            await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        return


@router.post("/turnstile/decision")
async def turnstile_decision_alias(
    payload: dict,
    request: Request,
    x_device_token: str | None = Header(default=None),
):
    return await turnstile_routes.turnstile_decision(
        payload=payload,
        request=request,
        x_device_token=x_device_token,
    )


@router.post("/turnstile/events")
async def turnstile_events_alias(
    payload: dict,
    request: Request,
    x_device_token: str | None = Header(default=None),
):
    return await turnstile_routes.turnstile_event(
        payload=payload,
        request=request,
        x_device_token=x_device_token,
    )
