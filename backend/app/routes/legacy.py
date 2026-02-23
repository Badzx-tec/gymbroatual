import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Header, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from app.core.deps import get_current_actor, require_active_subscription, require_roles
from app.db.mongo import get_db

from . import billing as billing_routes
from . import gyms as gym_routes
from . import turnstiles as turnstile_routes

router = APIRouter()


@router.post("/auth/logout")
async def logout() -> dict:
    return {"message": "ok"}


@router.get("/dashboard")
async def dashboard(actor: dict = Depends(require_active_subscription)):
    return await gym_routes.dashboard(actor)


@router.get("/dashboard/charts")
async def dashboard_charts() -> dict:
    return {
        "receita_por_plano": [],
        "acessos_por_hora": [],
        "receita_mensal": [],
    }


@router.get("/access-logs")
async def access_logs(limit: int = 100, actor: dict = Depends(require_active_subscription)):
    return await gym_routes.access_logs(limit=limit, owner=actor)


@router.get("/plans")
async def plans(actor: dict = Depends(require_active_subscription)):
    return await gym_routes.list_plans(actor)


@router.get("/plans/public")
async def plans_public():
    return await gym_routes.list_plans_public()


@router.post("/plans")
async def create_plan(payload: dict, actor: dict = Depends(require_active_subscription)):
    return await gym_routes.create_plan(payload, actor)


@router.put("/plans/{plan_id}")
async def update_plan(
    plan_id: str, payload: dict, actor: dict = Depends(require_active_subscription)
):
    return await gym_routes.update_plan(plan_id, payload, actor)


@router.delete("/plans/{plan_id}")
async def delete_plan(plan_id: str, actor: dict = Depends(require_active_subscription)):
    return await gym_routes.delete_plan(plan_id, actor)


@router.get("/academies")
async def list_academies(actor: dict = Depends(require_active_subscription)):
    return await gym_routes.list_gyms(actor)


@router.post("/academies")
async def create_academy(payload: dict, actor: dict = Depends(require_active_subscription)):
    db = get_db()
    now = datetime.now(UTC)
    gym_id = payload.get("academy_id") or f"gym_{secrets.token_hex(6)}"
    doc = {
        "gym_id": gym_id,
        "owner_id": actor["owner_id"],
        "name": payload.get("nome", "Academia"),
        "endereco": payload.get("endereco", ""),
        "telefone": payload.get("telefone", ""),
        "email": payload.get("email", ""),
        "catraca_ip": payload.get("catraca_ip", "127.0.0.1"),
        "catraca_port": int(payload.get("catraca_port", 7878)),
        "ativo": bool(payload.get("ativo", True)),
        "created_at": now,
        "updated_at": now,
    }
    await db.gyms.insert_one(doc)
    return {
        "academy_id": gym_id,
        "nome": doc["name"],
        "endereco": doc["endereco"],
        "telefone": doc["telefone"],
        "email": doc["email"],
        "catraca_ip": doc["catraca_ip"],
        "catraca_port": doc["catraca_port"],
        "ativo": doc["ativo"],
    }


@router.put("/academies/{academy_id}")
async def update_academy(
    academy_id: str, payload: dict, actor: dict = Depends(require_active_subscription)
):
    db = get_db()
    mapped = {
        "name": payload.get("nome"),
        "endereco": payload.get("endereco"),
        "telefone": payload.get("telefone"),
        "email": payload.get("email"),
        "catraca_ip": payload.get("catraca_ip"),
        "catraca_port": payload.get("catraca_port"),
        "ativo": payload.get("ativo"),
        "updated_at": datetime.now(UTC),
    }
    mapped = {k: v for k, v in mapped.items() if v is not None}
    await db.gyms.update_one(
        {"gym_id": academy_id, "owner_id": actor["owner_id"]}, {"$set": mapped}
    )
    updated = await db.gyms.find_one(
        {"gym_id": academy_id, "owner_id": actor["owner_id"]}, {"_id": 0}
    )
    if not updated:
        return JSONResponse(status_code=404, content={"detail": "Academia nao encontrada"})
    return {
        "academy_id": academy_id,
        "nome": updated.get("name", ""),
        "endereco": updated.get("endereco", ""),
        "telefone": updated.get("telefone", ""),
        "email": updated.get("email", ""),
        "catraca_ip": updated.get("catraca_ip", ""),
        "catraca_port": updated.get("catraca_port", 7878),
        "ativo": updated.get("ativo", True),
    }


@router.delete("/academies/{academy_id}")
async def delete_academy(academy_id: str, actor: dict = Depends(require_active_subscription)):
    db = get_db()
    await db.gyms.delete_one({"gym_id": academy_id, "owner_id": actor["owner_id"]})
    return {"message": "Academia removida"}


@router.get("/academies/{academy_id}/stats")
async def academy_stats(academy_id: str, actor: dict = Depends(require_active_subscription)):
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
async def academy_checkout(_: dict, actor: dict = Depends(require_roles("OWNER", "MANAGER"))):
    return await billing_routes.subscription_checkout(actor)


@router.get("/notifications")
async def notifications(limit: int = 50, actor: dict = Depends(require_active_subscription)):
    db = get_db()
    return (
        await db.notifications.find({"owner_id": actor["owner_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )


@router.post("/notifications/check-expiring")
async def notifications_check(actor: dict = Depends(require_active_subscription)):
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
async def notification_read(notif_id: str, actor: dict = Depends(require_active_subscription)):
    db = get_db()
    await db.notifications.update_one(
        {"notif_id": notif_id, "owner_id": actor["owner_id"]}, {"$set": {"lida": True}}
    )
    return {"message": "ok"}


@router.delete("/notifications/{notif_id}")
async def notification_delete(notif_id: str, actor: dict = Depends(require_active_subscription)):
    db = get_db()
    await db.notifications.delete_one({"notif_id": notif_id, "owner_id": actor["owner_id"]})
    return {"message": "ok"}


@router.post("/catraca/command")
async def catraca_command(payload: dict, actor: dict = Depends(require_active_subscription)):
    db = get_db()
    doc = {
        "cmd_id": f"cmd_{secrets.token_hex(6)}",
        "owner_id": actor["owner_id"],
        "action": payload.get("action"),
        "message": payload.get("message", ""),
        "status": "pending",
        "created_at": datetime.now(UTC),
    }
    await db.catraca_commands.insert_one(doc)
    return doc


@router.get("/catraca/commands")
async def catraca_commands(actor: dict = Depends(require_active_subscription)):
    db = get_db()
    return (
        await db.catraca_commands.find({"owner_id": actor["owner_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(50)
        .to_list(50)
    )


@router.get("/webhook-logs")
async def webhook_logs(limit: int = 50, actor: dict = Depends(require_active_subscription)):
    db = get_db()
    return (
        await db.billing_events.find({}, {"_id": 0})
        .sort("received_at", -1)
        .limit(limit)
        .to_list(limit)
    )


@router.get("/reports/students/excel")
async def export_students_excel():
    return JSONResponse(
        status_code=501, content={"detail": "Exportacao nao implementada nesta versao"}
    )


@router.get("/reports/students/pdf")
async def export_students_pdf():
    return JSONResponse(
        status_code=501, content={"detail": "Exportacao nao implementada nesta versao"}
    )


@router.get("/reports/access-logs/excel")
async def export_access_excel():
    return JSONResponse(
        status_code=501, content={"detail": "Exportacao nao implementada nesta versao"}
    )


@router.get("/reports/financial/excel")
async def export_financial_excel():
    return JSONResponse(
        status_code=501, content={"detail": "Exportacao nao implementada nesta versao"}
    )


@router.post("/students/{student_id}/biometria")
async def students_biometria(
    student_id: str, payload: dict, actor: dict = Depends(require_active_subscription)
):
    db = get_db()
    await db.students.update_one(
        {"student_id": student_id, "owner_id": actor["owner_id"]},
        {"$set": {"biometria_id": payload.get("biometria_id")}},
    )
    return {"message": "ok"}


@router.post("/students/{student_id}/progress")
async def student_progress(
    student_id: str, payload: dict, actor: dict = Depends(require_active_subscription)
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
    return doc


@router.get("/students/{student_id}/progress")
async def student_progress_list(
    student_id: str, actor: dict = Depends(require_active_subscription), limit: int = 50
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
    student_id: str, _: dict, actor: dict = Depends(require_active_subscription)
):
    return {
        "message": "Passkey placeholder",
        "student_id": student_id,
        "owner_id": actor["owner_id"],
    }


@router.post("/students/{student_id}/passkey/register/options")
async def passkey_opts(student_id: str, actor: dict = Depends(require_active_subscription)):
    return {
        "state_id": f"st_{student_id}",
        "publicKey": {"challenge": "", "user": {"id": ""}, "excludeCredentials": []},
    }


@router.post("/students/{student_id}/passkey/register/verify")
async def passkey_verify(
    student_id: str, _: dict, actor: dict = Depends(require_active_subscription)
):
    return {"message": "ok", "student_id": student_id, "owner_id": actor["owner_id"]}


@router.get("/students/{student_id}/passkeys")
async def list_passkeys(student_id: str, actor: dict = Depends(require_active_subscription)):
    return {"student_id": student_id, "webauthn_credentials": []}


@router.post("/seed")
async def seed(actor: dict = Depends(get_current_actor)):
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
