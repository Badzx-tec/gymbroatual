import os
import io
import uuid
import json
import asyncio
import httpx
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response, Depends, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
from typing import Optional, List
from jose import jwt
from passlib.context import CryptContext

load_dotenv()

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")
JWT_SECRET = os.environ.get("JWT_SECRET")
MP_ACCESS_TOKEN = os.environ.get("MERCADOPAGO_ACCESS_TOKEN")

app = FastAPI(title="GymBro API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ============== WEBSOCKET MANAGER ==============

class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, message: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

ws_manager = ConnectionManager()

# ============== MODELS ==============

class UserRegister(BaseModel):
    email: str
    password: str
    name: str

class UserLogin(BaseModel):
    email: str
    password: str

class StudentCreate(BaseModel):
    nome: str
    email: str
    cpf: str
    telefone: Optional[str] = ""
    plano_id: Optional[str] = ""
    tag_rfid: Optional[str] = ""
    biometria_id: Optional[str] = ""
    status: str = "ativo"
    data_vencimento: Optional[str] = ""
    academy_id: Optional[str] = ""

class StudentUpdate(BaseModel):
    nome: Optional[str] = None
    email: Optional[str] = None
    cpf: Optional[str] = None
    telefone: Optional[str] = None
    plano_id: Optional[str] = None
    tag_rfid: Optional[str] = None
    biometria_id: Optional[str] = None
    status: Optional[str] = None
    data_vencimento: Optional[str] = None
    academy_id: Optional[str] = None

class PlanCreate(BaseModel):
    nome: str
    valor: float
    duracao_dias: int
    descricao: Optional[str] = ""
    ativo: bool = True

class PlanUpdate(BaseModel):
    nome: Optional[str] = None
    valor: Optional[float] = None
    duracao_dias: Optional[int] = None
    descricao: Optional[str] = None
    ativo: Optional[bool] = None

class AccessValidation(BaseModel):
    tag_id: str
    tipo: str = "rfid"
    academy_id: Optional[str] = ""

class AcademyCreate(BaseModel):
    nome: str
    endereco: Optional[str] = ""
    telefone: Optional[str] = ""
    cnpj: Optional[str] = ""
    email: Optional[str] = ""
    catraca_ip: Optional[str] = "192.168.1.9"
    catraca_port: Optional[int] = 7878
    ativo: bool = True

class AcademyUpdate(BaseModel):
    nome: Optional[str] = None
    endereco: Optional[str] = None
    telefone: Optional[str] = None
    cnpj: Optional[str] = None
    email: Optional[str] = None
    catraca_ip: Optional[str] = None
    catraca_port: Optional[int] = None
    ativo: Optional[bool] = None

class CatracaCommand(BaseModel):
    action: str  # release_entry, release_exit, block, message
    message: Optional[str] = ""
    academy_id: Optional[str] = ""

# ============== AUTH HELPERS ==============

def create_token(user_id: str, email: str):
    payload = {
        "user_id": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

async def get_current_user(request: Request):
    session_token = request.cookies.get("session_token")
    if session_token:
        session = await db.user_sessions.find_one({"session_token": session_token}, {"_id": 0})
        if session:
            expires_at = session.get("expires_at")
            if isinstance(expires_at, str):
                expires_at = datetime.fromisoformat(expires_at)
            if expires_at and expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at and expires_at > datetime.now(timezone.utc):
                user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
                if user:
                    return user

    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
        if session:
            expires_at = session.get("expires_at")
            if isinstance(expires_at, str):
                expires_at = datetime.fromisoformat(expires_at)
            if expires_at and expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at and expires_at > datetime.now(timezone.utc):
                user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
                if user:
                    return user
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            user = await db.users.find_one({"user_id": payload["user_id"]}, {"_id": 0})
            if user:
                return user
        except Exception:
            pass

    raise HTTPException(status_code=401, detail="Nao autenticado")

# ============== AUTH ENDPOINTS ==============

@app.post("/api/auth/register")
async def register(data: UserRegister):
    existing = await db.users.find_one({"email": data.email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Email ja cadastrado")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    hashed = pwd_context.hash(data.password)
    await db.users.insert_one({
        "user_id": user_id, "email": data.email, "name": data.name,
        "password": hashed, "role": "admin", "picture": "",
        "academy_id": "", "created_at": datetime.now(timezone.utc),
    })
    token = create_token(user_id, data.email)
    return {"token": token, "user": {"user_id": user_id, "email": data.email, "name": data.name, "role": "admin", "academy_id": ""}}

@app.post("/api/auth/login")
async def login(data: UserLogin):
    user = await db.users.find_one({"email": data.email}, {"_id": 0})
    if not user or not pwd_context.verify(data.password, user.get("password", "")):
        raise HTTPException(status_code=401, detail="Credenciais invalidas")
    token = create_token(user["user_id"], user["email"])
    return {"token": token, "user": {
        "user_id": user["user_id"], "email": user["email"], "name": user["name"],
        "role": user.get("role", "admin"), "academy_id": user.get("academy_id", ""),
        "picture": user.get("picture", ""),
    }}

@app.post("/api/auth/google/session")
async def google_session(request: Request, response: Response):
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id obrigatorio")
    # REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    async with httpx.AsyncClient() as client_http:
        resp = await client_http.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Sessao invalida")
        data = resp.json()

    email = data["email"]
    name = data.get("name", "")
    picture = data.get("picture", "")
    session_token = data.get("session_token", f"st_{uuid.uuid4().hex}")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"name": name, "picture": picture}})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id, "email": email, "name": name, "picture": picture,
            "password": "", "role": "admin", "academy_id": "", "created_at": datetime.now(timezone.utc),
        })

    await db.user_sessions.insert_one({
        "user_id": user_id, "session_token": session_token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })

    response.set_cookie(key="session_token", value=session_token, httponly=True,
                        secure=True, samesite="none", path="/", max_age=7*24*3600)
    return {
        "user": {"user_id": user_id, "email": email, "name": name, "picture": picture, "role": "admin", "academy_id": ""},
        "session_token": session_token,
    }

@app.get("/api/auth/me")
async def auth_me(user=Depends(get_current_user)):
    return {
        "user_id": user["user_id"], "email": user["email"], "name": user["name"],
        "picture": user.get("picture", ""), "role": user.get("role", "admin"),
        "academy_id": user.get("academy_id", ""),
    }

@app.post("/api/auth/logout")
async def logout(request: Request, response: Response):
    session_token = request.cookies.get("session_token")
    if session_token:
        await db.user_sessions.delete_many({"session_token": session_token})
    response.delete_cookie("session_token", path="/")
    return {"message": "Logout realizado"}

# ============== STUDENTS CRUD ==============

@app.get("/api/students")
async def list_students(user=Depends(get_current_user), search: str = "", status: str = "", academy_id: str = ""):
    query = {}
    if search:
        query["$or"] = [
            {"nome": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
            {"cpf": {"$regex": search, "$options": "i"}},
            {"tag_rfid": {"$regex": search, "$options": "i"}},
        ]
    if status:
        query["status"] = status
    if academy_id:
        query["academy_id"] = academy_id
    elif user.get("role") != "super_admin" and user.get("academy_id"):
        query["academy_id"] = user["academy_id"]
    students = await db.students.find(query, {"_id": 0}).sort("nome", 1).to_list(1000)
    return students

@app.post("/api/students")
async def create_student(data: StudentCreate, user=Depends(get_current_user)):
    existing = await db.students.find_one({"cpf": data.cpf}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="CPF ja cadastrado")
    student_id = f"std_{uuid.uuid4().hex[:12]}"
    doc = {"student_id": student_id, **data.model_dump(),
           "created_at": datetime.now(timezone.utc).isoformat(),
           "updated_at": datetime.now(timezone.utc).isoformat()}
    if not doc.get("academy_id") and user.get("academy_id"):
        doc["academy_id"] = user["academy_id"]
    await db.students.insert_one(doc)
    return await db.students.find_one({"student_id": student_id}, {"_id": 0})

@app.get("/api/students/{student_id}")
async def get_student(student_id: str, user=Depends(get_current_user)):
    student = await db.students.find_one({"student_id": student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Aluno nao encontrado")
    return student

@app.put("/api/students/{student_id}")
async def update_student(student_id: str, data: StudentUpdate, user=Depends(get_current_user)):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="Nenhum dado para atualizar")
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.students.update_one({"student_id": student_id}, {"$set": update_data})
    student = await db.students.find_one({"student_id": student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Aluno nao encontrado")
    return student

@app.delete("/api/students/{student_id}")
async def delete_student(student_id: str, user=Depends(get_current_user)):
    result = await db.students.delete_one({"student_id": student_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Aluno nao encontrado")
    return {"message": "Aluno removido"}

# ============== PLANS CRUD ==============

@app.get("/api/plans")
async def list_plans(user=Depends(get_current_user)):
    return await db.plans.find({}, {"_id": 0}).sort("valor", 1).to_list(100)

@app.get("/api/plans/public")
async def list_plans_public():
    return await db.plans.find({"ativo": True}, {"_id": 0}).sort("valor", 1).to_list(100)

@app.post("/api/plans")
async def create_plan(data: PlanCreate, user=Depends(get_current_user)):
    plan_id = f"plan_{uuid.uuid4().hex[:12]}"
    doc = {"plan_id": plan_id, **data.model_dump(), "created_at": datetime.now(timezone.utc).isoformat()}
    await db.plans.insert_one(doc)
    return await db.plans.find_one({"plan_id": plan_id}, {"_id": 0})

@app.put("/api/plans/{plan_id}")
async def update_plan(plan_id: str, data: PlanUpdate, user=Depends(get_current_user)):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="Nenhum dado para atualizar")
    await db.plans.update_one({"plan_id": plan_id}, {"$set": update_data})
    plan = await db.plans.find_one({"plan_id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=404, detail="Plano nao encontrado")
    return plan

@app.delete("/api/plans/{plan_id}")
async def delete_plan(plan_id: str, user=Depends(get_current_user)):
    result = await db.plans.delete_one({"plan_id": plan_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Plano nao encontrado")
    return {"message": "Plano removido"}

# ============== DASHBOARD ==============

@app.get("/api/dashboard")
async def dashboard_stats(user=Depends(get_current_user)):
    q = {}
    if user.get("role") != "super_admin" and user.get("academy_id"):
        q["academy_id"] = user["academy_id"]

    total_students = await db.students.count_documents(q)
    active_q = {**q, "status": "ativo"}
    inactive_q = {**q, "status": "inativo"}
    active_students = await db.students.count_documents(active_q)
    inactive_students = await db.students.count_documents(inactive_q)
    total_plans = await db.plans.count_documents({})

    pipeline = [{"$match": active_q},
                {"$lookup": {"from": "plans", "localField": "plano_id", "foreignField": "plan_id", "as": "plano"}},
                {"$unwind": {"path": "$plano", "preserveNullAndEmptyArrays": True}},
                {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$plano.valor", 0]}}}}]
    rev = await db.students.aggregate(pipeline).to_list(1)
    faturamento = rev[0]["total"] if rev else 0

    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    log_q = {"timestamp": {"$gte": today_start.isoformat()}}
    if q.get("academy_id"):
        log_q["academy_id"] = q["academy_id"]
    acessos_hoje = await db.access_logs.count_documents(log_q)

    recent_q = {}
    if q.get("academy_id"):
        recent_q["academy_id"] = q["academy_id"]
    recent_logs = await db.access_logs.find(recent_q, {"_id": 0}).sort("timestamp", -1).limit(10).to_list(10)

    # Occupancy estimate (entries in last hour)
    hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    occ_q = {"timestamp": {"$gte": hour_ago}, "autorizado": True}
    if q.get("academy_id"):
        occ_q["academy_id"] = q["academy_id"]
    ocupacao_atual = await db.access_logs.count_documents(occ_q)

    return {
        "total_alunos": total_students, "alunos_ativos": active_students,
        "alunos_inativos": inactive_students, "total_planos": total_plans,
        "faturamento_mensal": faturamento, "acessos_hoje": acessos_hoje,
        "ocupacao_atual": ocupacao_atual, "ultimos_acessos": recent_logs,
    }

# ============== CHART DATA ==============

@app.get("/api/dashboard/charts")
async def dashboard_charts(user=Depends(get_current_user)):
    q = {}
    if user.get("role") != "super_admin" and user.get("academy_id"):
        q["academy_id"] = user["academy_id"]

    # Revenue by plan
    pipeline = [{"$match": {**q, "status": "ativo"}},
                {"$lookup": {"from": "plans", "localField": "plano_id", "foreignField": "plan_id", "as": "plano"}},
                {"$unwind": {"path": "$plano", "preserveNullAndEmptyArrays": True}},
                {"$group": {"_id": "$plano.nome", "total": {"$sum": {"$ifNull": ["$plano.valor", 0]}}, "count": {"$sum": 1}}}]
    rev_by_plan = await db.students.aggregate(pipeline).to_list(20)
    revenue_chart = [{"plano": r["_id"] or "Sem Plano", "valor": r["total"], "alunos": r["count"]} for r in rev_by_plan]

    # Access by hour (last 24h)
    now = datetime.now(timezone.utc)
    hours_data = []
    for i in range(24):
        h = now - timedelta(hours=23-i)
        h_start = h.replace(minute=0, second=0, microsecond=0)
        h_end = h_start + timedelta(hours=1)
        hq = {"timestamp": {"$gte": h_start.isoformat(), "$lt": h_end.isoformat()}}
        if q.get("academy_id"):
            hq["academy_id"] = q["academy_id"]
        cnt = await db.access_logs.count_documents(hq)
        hours_data.append({"hora": h_start.strftime("%H:00"), "acessos": cnt})

    # Students by status
    status_chart = [
        {"status": "Ativos", "count": await db.students.count_documents({**q, "status": "ativo"})},
        {"status": "Inativos", "count": await db.students.count_documents({**q, "status": "inativo"})},
    ]

    # Monthly revenue (last 6 months simulated from active students)
    monthly = []
    for i in range(6):
        month_date = now - timedelta(days=30*i)
        monthly.append({
            "mes": month_date.strftime("%b/%y"),
            "valor": round(revenue_chart and sum(r["valor"] for r in revenue_chart) * (0.7 + 0.05*i) or 0, 2),
        })
    monthly.reverse()

    return {
        "receita_por_plano": revenue_chart,
        "acessos_por_hora": hours_data,
        "alunos_por_status": status_chart,
        "receita_mensal": monthly,
    }

# ============== ACCESS LOGS ==============

@app.get("/api/access-logs")
async def list_access_logs(user=Depends(get_current_user), limit: int = 50):
    q = {}
    if user.get("role") != "super_admin" and user.get("academy_id"):
        q["academy_id"] = user["academy_id"]
    return await db.access_logs.find(q, {"_id": 0}).sort("timestamp", -1).limit(limit).to_list(limit)

# ============== ACCESS VALIDATION (for Local Agent) ==============

@app.post("/api/access/validate")
async def validate_access(data: AccessValidation):
    query = {}
    if data.tipo == "rfid":
        query["tag_rfid"] = data.tag_id
    elif data.tipo == "biometria":
        query["biometria_id"] = data.tag_id
    elif data.tipo == "teclado":
        query["cpf"] = data.tag_id
    else:
        query["tag_rfid"] = data.tag_id

    student = await db.students.find_one(query, {"_id": 0})

    log_base = {
        "log_id": f"log_{uuid.uuid4().hex[:12]}",
        "tag_id": data.tag_id, "tipo": data.tipo,
        "academy_id": data.academy_id or (student or {}).get("academy_id", ""),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    if not student:
        log_base.update({"student_id": "", "student_name": "Desconhecido", "autorizado": False, "motivo": "Aluno nao encontrado"})
        await db.access_logs.insert_one(log_base)
        await ws_manager.broadcast({"type": "access", "data": {k: v for k, v in log_base.items() if k != "_id"}})
        return {"autorizado": False, "motivo": "Aluno nao encontrado", "aluno": None}

    if student.get("status") != "ativo":
        log_base.update({"student_id": student["student_id"], "student_name": student["nome"], "autorizado": False, "motivo": "Assinatura inativa"})
        await db.access_logs.insert_one(log_base)
        await ws_manager.broadcast({"type": "access", "data": {k: v for k, v in log_base.items() if k != "_id"}})
        return {"autorizado": False, "motivo": "Assinatura inativa", "aluno": student["nome"]}

    vencimento = student.get("data_vencimento", "")
    if vencimento:
        try:
            dt_venc = datetime.fromisoformat(vencimento)
            if dt_venc.tzinfo is None:
                dt_venc = dt_venc.replace(tzinfo=timezone.utc)
            if dt_venc < datetime.now(timezone.utc):
                await db.students.update_one({"student_id": student["student_id"]}, {"$set": {"status": "inativo"}})
                log_base.update({"student_id": student["student_id"], "student_name": student["nome"], "autorizado": False, "motivo": "Assinatura vencida"})
                await db.access_logs.insert_one(log_base)
                await ws_manager.broadcast({"type": "access", "data": {k: v for k, v in log_base.items() if k != "_id"}})
                return {"autorizado": False, "motivo": "Assinatura vencida", "aluno": student["nome"]}
        except Exception:
            pass

    log_base.update({"student_id": student["student_id"], "student_name": student["nome"], "autorizado": True, "motivo": "Acesso liberado"})
    await db.access_logs.insert_one(log_base)
    await ws_manager.broadcast({"type": "access", "data": {k: v for k, v in log_base.items() if k != "_id"}})
    return {"autorizado": True, "motivo": "Acesso liberado", "aluno": student["nome"]}

# ============== MERCADO PAGO WEBHOOK ==============

@app.post("/api/webhooks/mercadopago")
async def mercadopago_webhook(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Payload invalido")

    action = body.get("action", "")
    data = body.get("data", {})
    payment_id = data.get("id")

    if action not in ("payment.created", "payment.updated"):
        return {"status": "ignored", "reason": "Acao nao relevante"}
    if not payment_id:
        return {"status": "ignored", "reason": "Sem ID de pagamento"}

    if not MP_ACCESS_TOKEN or MP_ACCESS_TOKEN == "placeholder":
        await db.webhook_logs.insert_one({
            "log_id": f"wh_{uuid.uuid4().hex[:12]}", "action": action,
            "payment_id": str(payment_id), "status": "token_not_configured",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return {"status": "received", "message": "Token MP nao configurado - webhook registrado"}

    try:
        async with httpx.AsyncClient() as http_client:
            resp = await http_client.get(f"https://api.mercadopago.com/v1/payments/{payment_id}",
                                         headers={"Authorization": f"Bearer {MP_ACCESS_TOKEN}"})
            if resp.status_code != 200:
                await db.webhook_logs.insert_one({
                    "log_id": f"wh_{uuid.uuid4().hex[:12]}", "action": action,
                    "payment_id": str(payment_id), "status": "mp_api_error", "error": resp.text,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
                return {"status": "error", "message": "Erro ao consultar MP"}
            payment_data = resp.json()
    except Exception as e:
        await db.webhook_logs.insert_one({
            "log_id": f"wh_{uuid.uuid4().hex[:12]}", "action": action,
            "payment_id": str(payment_id), "status": "exception", "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return {"status": "error", "message": str(e)}

    payment_status = payment_data.get("status")
    payer_email = payment_data.get("payer", {}).get("email", "")
    external_ref = payment_data.get("external_reference", "")

    await db.webhook_logs.insert_one({
        "log_id": f"wh_{uuid.uuid4().hex[:12]}", "action": action,
        "payment_id": str(payment_id), "payment_status": payment_status,
        "payer_email": payer_email, "external_reference": external_ref,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    if payment_status != "approved":
        return {"status": "received", "payment_status": payment_status}

    student = None
    if external_ref:
        student = await db.students.find_one({"student_id": external_ref}, {"_id": 0})
    if not student and payer_email:
        student = await db.students.find_one({"email": payer_email}, {"_id": 0})
    if not student:
        return {"status": "received", "message": "Pagamento aprovado mas aluno nao encontrado"}

    plan = None
    if student.get("plano_id"):
        plan = await db.plans.find_one({"plan_id": student["plano_id"]}, {"_id": 0})
    days_to_add = plan["duracao_dias"] if plan else 30

    current_expiry = student.get("data_vencimento", "")
    try:
        base_date = datetime.fromisoformat(current_expiry) if current_expiry else datetime.now(timezone.utc)
        if base_date.tzinfo is None:
            base_date = base_date.replace(tzinfo=timezone.utc)
        if base_date < datetime.now(timezone.utc):
            base_date = datetime.now(timezone.utc)
    except Exception:
        base_date = datetime.now(timezone.utc)

    new_expiry = base_date + timedelta(days=days_to_add)
    await db.students.update_one(
        {"student_id": student["student_id"]},
        {"$set": {"status": "ativo", "data_vencimento": new_expiry.isoformat(),
                  "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"status": "processed", "message": f"Assinatura renovada ate {new_expiry.strftime('%d/%m/%Y')}", "aluno": student["nome"]}

@app.get("/api/webhook-logs")
async def list_webhook_logs(user=Depends(get_current_user), limit: int = 50):
    return await db.webhook_logs.find({}, {"_id": 0}).sort("timestamp", -1).limit(limit).to_list(limit)

# ============== ACADEMIES (MULTI-TENANCY) ==============

@app.get("/api/academies")
async def list_academies(user=Depends(get_current_user)):
    return await db.academies.find({}, {"_id": 0}).sort("nome", 1).to_list(100)

@app.post("/api/academies")
async def create_academy(data: AcademyCreate, user=Depends(get_current_user)):
    academy_id = f"acad_{uuid.uuid4().hex[:12]}"
    doc = {"academy_id": academy_id, **data.model_dump(),
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.academies.insert_one(doc)
    return await db.academies.find_one({"academy_id": academy_id}, {"_id": 0})

@app.put("/api/academies/{academy_id}")
async def update_academy(academy_id: str, data: AcademyUpdate, user=Depends(get_current_user)):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="Nenhum dado para atualizar")
    await db.academies.update_one({"academy_id": academy_id}, {"$set": update_data})
    acad = await db.academies.find_one({"academy_id": academy_id}, {"_id": 0})
    if not acad:
        raise HTTPException(status_code=404, detail="Academia nao encontrada")
    return acad

@app.delete("/api/academies/{academy_id}")
async def delete_academy(academy_id: str, user=Depends(get_current_user)):
    result = await db.academies.delete_one({"academy_id": academy_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Academia nao encontrada")
    return {"message": "Academia removida"}

@app.get("/api/academies/{academy_id}/stats")
async def academy_stats(academy_id: str, user=Depends(get_current_user)):
    q = {"academy_id": academy_id}
    total = await db.students.count_documents(q)
    active = await db.students.count_documents({**q, "status": "ativo"})
    inactive = await db.students.count_documents({**q, "status": "inativo"})
    pipeline = [{"$match": {**q, "status": "ativo"}},
                {"$lookup": {"from": "plans", "localField": "plano_id", "foreignField": "plan_id", "as": "plano"}},
                {"$unwind": {"path": "$plano", "preserveNullAndEmptyArrays": True}},
                {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$plano.valor", 0]}}}}]
    rev = await db.students.aggregate(pipeline).to_list(1)
    return {"total_alunos": total, "alunos_ativos": active, "alunos_inativos": inactive,
            "faturamento": rev[0]["total"] if rev else 0}

# ============== NOTIFICATIONS (MOCKED EMAIL) ==============

@app.get("/api/notifications")
async def list_notifications(user=Depends(get_current_user), limit: int = 50):
    return await db.notifications.find({}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)

@app.post("/api/notifications/check-expiring")
async def check_expiring_subscriptions(user=Depends(get_current_user)):
    """Check for students whose subscriptions expire in the next 7 days and create notifications"""
    now = datetime.now(timezone.utc)
    week_from_now = (now + timedelta(days=7)).isoformat()
    expiring = await db.students.find({
        "status": "ativo",
        "data_vencimento": {"$lte": week_from_now, "$gte": now.isoformat()},
    }, {"_id": 0}).to_list(1000)

    created = 0
    for student in expiring:
        existing = await db.notifications.find_one({
            "student_id": student["student_id"], "tipo": "vencimento",
            "created_at": {"$gte": now.replace(hour=0, minute=0).isoformat()}
        })
        if existing:
            continue
        dt_venc = student.get("data_vencimento", "")
        try:
            venc_fmt = datetime.fromisoformat(dt_venc).strftime("%d/%m/%Y")
        except Exception:
            venc_fmt = dt_venc
        days_left = 0
        try:
            dt = datetime.fromisoformat(dt_venc)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            days_left = (dt - now).days
        except Exception:
            pass

        notif = {
            "notif_id": f"notif_{uuid.uuid4().hex[:12]}",
            "tipo": "vencimento",
            "titulo": f"Assinatura vencendo em {days_left} dias",
            "mensagem": f"O aluno {student['nome']} ({student['email']}) tem assinatura vencendo em {venc_fmt}.",
            "student_id": student["student_id"],
            "student_name": student["nome"],
            "student_email": student["email"],
            "email_enviado": True,
            "email_destino": student["email"],
            "email_status": "enviado (simulado)",
            "lida": False,
            "created_at": now.isoformat(),
        }
        await db.notifications.insert_one(notif)
        created += 1

    return {"message": f"{created} notificacoes criadas", "total_vencendo": len(expiring)}

@app.put("/api/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: str, user=Depends(get_current_user)):
    await db.notifications.update_one({"notif_id": notif_id}, {"$set": {"lida": True}})
    return {"message": "Notificacao marcada como lida"}

@app.delete("/api/notifications/{notif_id}")
async def delete_notification(notif_id: str, user=Depends(get_current_user)):
    await db.notifications.delete_one({"notif_id": notif_id})
    return {"message": "Notificacao removida"}

# ============== REPORTS (PDF / EXCEL) ==============

@app.get("/api/reports/students/excel")
async def export_students_excel(user=Depends(get_current_user)):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    students = await db.students.find({}, {"_id": 0}).sort("nome", 1).to_list(5000)
    plans_list = await db.plans.find({}, {"_id": 0}).to_list(100)
    plans_map = {p["plan_id"]: p["nome"] for p in plans_list}

    wb = Workbook()
    ws = wb.active
    ws.title = "Alunos"
    headers = ["Nome", "Email", "CPF", "Telefone", "Plano", "Status", "Vencimento", "Tag RFID"]
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1a1a1a", end_color="1a1a1a", fill_type="solid")
    for col, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=h)
        cell.font = header_font
        cell.fill = header_fill

    for row, s in enumerate(students, 2):
        ws.cell(row=row, column=1, value=s.get("nome", ""))
        ws.cell(row=row, column=2, value=s.get("email", ""))
        ws.cell(row=row, column=3, value=s.get("cpf", ""))
        ws.cell(row=row, column=4, value=s.get("telefone", ""))
        ws.cell(row=row, column=5, value=plans_map.get(s.get("plano_id", ""), "-"))
        ws.cell(row=row, column=6, value=s.get("status", ""))
        venc = s.get("data_vencimento", "")
        try:
            venc = datetime.fromisoformat(venc).strftime("%d/%m/%Y")
        except Exception:
            pass
        ws.cell(row=row, column=7, value=venc)
        ws.cell(row=row, column=8, value=s.get("tag_rfid", ""))

    for col in range(1, 9):
        ws.column_dimensions[chr(64+col)].width = 20

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename=alunos_gymbro.xlsx"})

@app.get("/api/reports/students/pdf")
async def export_students_pdf(user=Depends(get_current_user)):
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet

    students = await db.students.find({}, {"_id": 0}).sort("nome", 1).to_list(5000)
    plans_list = await db.plans.find({}, {"_id": 0}).to_list(100)
    plans_map = {p["plan_id"]: p["nome"] for p in plans_list}

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), topMargin=30, bottomMargin=30)
    styles = getSampleStyleSheet()
    elements = []

    elements.append(Paragraph("GymBro - Relatorio de Alunos", styles['Title']))
    elements.append(Paragraph(f"Gerado em: {datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M')}", styles['Normal']))
    elements.append(Spacer(1, 20))

    data = [["Nome", "Email", "CPF", "Plano", "Status", "Vencimento"]]
    for s in students:
        venc = s.get("data_vencimento", "")
        try:
            venc = datetime.fromisoformat(venc).strftime("%d/%m/%Y")
        except Exception:
            pass
        data.append([s.get("nome",""), s.get("email",""), s.get("cpf",""),
                     plans_map.get(s.get("plano_id",""), "-"), s.get("status","").upper(), venc])

    table = Table(data, colWidths=[120, 150, 100, 80, 60, 80])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#1a1a1a")),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('FONTSIZE', (0, 1), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f5f5")]),
    ]))
    elements.append(table)
    doc.build(elements)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": "attachment; filename=alunos_gymbro.pdf"})

@app.get("/api/reports/access-logs/excel")
async def export_access_logs_excel(user=Depends(get_current_user)):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    logs = await db.access_logs.find({}, {"_id": 0}).sort("timestamp", -1).limit(5000).to_list(5000)
    wb = Workbook()
    ws = wb.active
    ws.title = "Acessos"
    headers = ["Data/Hora", "Aluno", "Tag/ID", "Tipo", "Status", "Motivo"]
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1a1a1a", end_color="1a1a1a", fill_type="solid")
    for col, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=h)
        cell.font = header_font
        cell.fill = header_fill

    for row, l in enumerate(logs, 2):
        ts = l.get("timestamp", "")
        try:
            ts = datetime.fromisoformat(ts).strftime("%d/%m/%Y %H:%M")
        except Exception:
            pass
        ws.cell(row=row, column=1, value=ts)
        ws.cell(row=row, column=2, value=l.get("student_name", ""))
        ws.cell(row=row, column=3, value=l.get("tag_id", ""))
        ws.cell(row=row, column=4, value=l.get("tipo", ""))
        ws.cell(row=row, column=5, value="Liberado" if l.get("autorizado") else "Negado")
        ws.cell(row=row, column=6, value=l.get("motivo", ""))

    for col in range(1, 7):
        ws.column_dimensions[chr(64+col)].width = 20

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename=acessos_gymbro.xlsx"})

@app.get("/api/reports/financial/excel")
async def export_financial_excel(user=Depends(get_current_user)):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    students = await db.students.find({"status": "ativo"}, {"_id": 0}).to_list(5000)
    plans_list = await db.plans.find({}, {"_id": 0}).to_list(100)
    plans_map = {p["plan_id"]: p for p in plans_list}

    wb = Workbook()
    ws = wb.active
    ws.title = "Financeiro"
    headers = ["Aluno", "Email", "Plano", "Valor (R$)", "Vencimento", "Status"]
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1a1a1a", end_color="1a1a1a", fill_type="solid")
    for col, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=h)
        cell.font = header_font
        cell.fill = header_fill

    total = 0
    for row, s in enumerate(students, 2):
        plan = plans_map.get(s.get("plano_id", ""), {})
        valor = plan.get("valor", 0)
        total += valor
        venc = s.get("data_vencimento", "")
        try:
            venc = datetime.fromisoformat(venc).strftime("%d/%m/%Y")
        except Exception:
            pass
        ws.cell(row=row, column=1, value=s.get("nome", ""))
        ws.cell(row=row, column=2, value=s.get("email", ""))
        ws.cell(row=row, column=3, value=plan.get("nome", "-"))
        ws.cell(row=row, column=4, value=valor)
        ws.cell(row=row, column=5, value=venc)
        ws.cell(row=row, column=6, value=s.get("status", "").upper())

    row_total = len(students) + 2
    ws.cell(row=row_total, column=3, value="TOTAL").font = Font(bold=True)
    ws.cell(row=row_total, column=4, value=total).font = Font(bold=True)

    for col in range(1, 7):
        ws.column_dimensions[chr(64+col)].width = 20

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename=financeiro_gymbro.xlsx"})

# ============== CATRACA REMOTE CONTROL ==============

@app.post("/api/catraca/command")
async def catraca_command(data: CatracaCommand, user=Depends(get_current_user)):
    """Queue a command for the local agent to execute on the turnstile"""
    cmd_id = f"cmd_{uuid.uuid4().hex[:12]}"
    doc = {
        "cmd_id": cmd_id, "action": data.action, "message": data.message or "",
        "academy_id": data.academy_id or user.get("academy_id", ""),
        "status": "pending", "created_by": user["user_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.catraca_commands.insert_one(doc)
    await ws_manager.broadcast({"type": "catraca_command", "data": {"cmd_id": cmd_id, "action": data.action, "message": data.message}})
    return {k: v for k, v in doc.items() if k != "_id"}

@app.get("/api/catraca/commands")
async def list_catraca_commands(user=Depends(get_current_user), limit: int = 20):
    return await db.catraca_commands.find({}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)

@app.get("/api/catraca/pending")
async def get_pending_commands(academy_id: str = ""):
    """Endpoint polled by the local agent to get pending commands"""
    q = {"status": "pending"}
    if academy_id:
        q["academy_id"] = academy_id
    cmds = await db.catraca_commands.find(q, {"_id": 0}).sort("created_at", 1).to_list(50)
    # Mark as delivered
    for cmd in cmds:
        await db.catraca_commands.update_one({"cmd_id": cmd["cmd_id"]}, {"$set": {"status": "delivered"}})
    return cmds

@app.put("/api/catraca/commands/{cmd_id}/status")
async def update_command_status(cmd_id: str, request: Request):
    """Local agent reports command execution status"""
    body = await request.json()
    new_status = body.get("status", "executed")
    await db.catraca_commands.update_one({"cmd_id": cmd_id}, {"$set": {"status": new_status, "executed_at": datetime.now(timezone.utc).isoformat()}})
    return {"message": "Status atualizado"}

# ============== WEBSOCKET ==============

@app.websocket("/api/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        while True:
            data = await ws.receive_text()
            # Keep-alive / ping
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)

# ============== SEED DATA ==============

@app.post("/api/seed")
async def seed_data():
    existing_plans = await db.plans.count_documents({})
    if existing_plans > 0:
        return {"message": "Dados ja existem"}

    # Create default academy
    await db.academies.insert_one({
        "academy_id": "acad_matriz", "nome": "GymBro Matriz",
        "endereco": "Av. Paulista, 1000 - Sao Paulo, SP",
        "telefone": "(11) 99999-9999", "cnpj": "12.345.678/0001-00",
        "email": "matriz@gymbro.com.br", "catraca_ip": "192.168.1.9",
        "catraca_port": 7878, "ativo": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.academies.insert_one({
        "academy_id": "acad_filial01", "nome": "GymBro Filial Moema",
        "endereco": "Rua dos Tres Irmaos, 500 - Moema, SP",
        "telefone": "(11) 98888-8888", "cnpj": "12.345.678/0002-00",
        "email": "moema@gymbro.com.br", "catraca_ip": "192.168.1.10",
        "catraca_port": 7878, "ativo": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    plans = [
        {"plan_id": "plan_mensal", "nome": "Mensal", "valor": 139.90, "duracao_dias": 30, "descricao": "Acesso completo por 30 dias", "ativo": True, "created_at": datetime.now(timezone.utc).isoformat()},
        {"plan_id": "plan_trimestral", "nome": "Trimestral", "valor": 369.90, "duracao_dias": 90, "descricao": "Acesso completo por 90 dias - Economize 15%", "ativo": True, "created_at": datetime.now(timezone.utc).isoformat()},
        {"plan_id": "plan_semestral", "nome": "Semestral", "valor": 669.90, "duracao_dias": 180, "descricao": "Acesso completo por 180 dias - Economize 20%", "ativo": True, "created_at": datetime.now(timezone.utc).isoformat()},
        {"plan_id": "plan_anual", "nome": "Anual", "valor": 1249.90, "duracao_dias": 365, "descricao": "Acesso completo por 365 dias - Economize 25%", "ativo": True, "created_at": datetime.now(timezone.utc).isoformat()},
    ]
    await db.plans.insert_many(plans)

    future = (datetime.now(timezone.utc) + timedelta(days=25)).isoformat()
    future_3d = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    future_5d = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
    past = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
    students = [
        {"student_id": "std_001", "nome": "Carlos Silva", "email": "carlos@email.com", "cpf": "123.456.789-00", "telefone": "(11) 99999-0001", "plano_id": "plan_mensal", "tag_rfid": "0000000001", "biometria_id": "", "status": "ativo", "data_vencimento": future, "academy_id": "acad_matriz", "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()},
        {"student_id": "std_002", "nome": "Ana Souza", "email": "ana@email.com", "cpf": "234.567.890-11", "telefone": "(11) 99999-0002", "plano_id": "plan_trimestral", "tag_rfid": "0000000002", "biometria_id": "", "status": "ativo", "data_vencimento": future_3d, "academy_id": "acad_matriz", "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()},
        {"student_id": "std_003", "nome": "Bruno Oliveira", "email": "bruno@email.com", "cpf": "345.678.901-22", "telefone": "(11) 99999-0003", "plano_id": "plan_semestral", "tag_rfid": "0000000003", "biometria_id": "", "status": "ativo", "data_vencimento": future, "academy_id": "acad_matriz", "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()},
        {"student_id": "std_004", "nome": "Fernanda Lima", "email": "fernanda@email.com", "cpf": "456.789.012-33", "telefone": "(11) 99999-0004", "plano_id": "plan_mensal", "tag_rfid": "0000000004", "biometria_id": "", "status": "inativo", "data_vencimento": past, "academy_id": "acad_matriz", "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()},
        {"student_id": "std_005", "nome": "Ricardo Santos", "email": "ricardo@email.com", "cpf": "567.890.123-44", "telefone": "(11) 99999-0005", "plano_id": "plan_anual", "tag_rfid": "0000000005", "biometria_id": "1", "status": "ativo", "data_vencimento": future, "academy_id": "acad_matriz", "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()},
        {"student_id": "std_006", "nome": "Juliana Costa", "email": "juliana@email.com", "cpf": "678.901.234-55", "telefone": "(11) 99999-0006", "plano_id": "plan_trimestral", "tag_rfid": "0000000006", "biometria_id": "", "status": "ativo", "data_vencimento": future_5d, "academy_id": "acad_filial01", "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()},
        {"student_id": "std_007", "nome": "Pedro Almeida", "email": "pedro@email.com", "cpf": "789.012.345-66", "telefone": "(11) 99999-0007", "plano_id": "plan_semestral", "tag_rfid": "0000000007", "biometria_id": "2", "status": "ativo", "data_vencimento": future, "academy_id": "acad_filial01", "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()},
        {"student_id": "std_008", "nome": "Mariana Rocha", "email": "mariana@email.com", "cpf": "890.123.456-77", "telefone": "(11) 99999-0008", "plano_id": "plan_anual", "tag_rfid": "0000000008", "biometria_id": "", "status": "ativo", "data_vencimento": future, "academy_id": "acad_filial01", "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()},
    ]
    await db.students.insert_many(students)

    admin_exists = await db.users.find_one({"email": "admin@gymbro.com"}, {"_id": 0})
    if not admin_exists:
        await db.users.insert_one({
            "user_id": "user_admin001", "email": "admin@gymbro.com",
            "name": "Admin GymBro", "password": pwd_context.hash("admin123"),
            "role": "super_admin", "picture": "", "academy_id": "",
            "created_at": datetime.now(timezone.utc),
        })

    access_logs = []
    names = ["Carlos Silva", "Ana Souza", "Bruno Oliveira", "Fernanda Lima", "Ricardo Santos", "Juliana Costa", "Pedro Almeida", "Mariana Rocha"]
    for i in range(15):
        hours_ago = i * 1.5
        ts = (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat()
        idx = i % len(names)
        access_logs.append({
            "log_id": f"log_seed_{i}", "tag_id": f"000000000{idx+1}",
            "tipo": "rfid" if i % 3 != 2 else "biometria",
            "student_id": f"std_00{idx+1}", "student_name": names[idx],
            "autorizado": i != 3, "motivo": "Acesso liberado" if i != 3 else "Assinatura inativa",
            "academy_id": "acad_matriz" if idx < 5 else "acad_filial01",
            "timestamp": ts,
        })
    await db.access_logs.insert_many(access_logs)

    return {"message": "Dados de teste criados com sucesso"}

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "GymBro API", "version": "2.0.0"}
