import os
import uuid
import httpx
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response, Depends
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from typing import Optional, List
from jose import jwt
from passlib.context import CryptContext

load_dotenv()

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")
JWT_SECRET = os.environ.get("JWT_SECRET")
MP_ACCESS_TOKEN = os.environ.get("MERCADOPAGO_ACCESS_TOKEN")

app = FastAPI(title="GymBro API", version="1.0.0")

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

# ============== AUTH HELPERS ==============

def create_token(user_id: str, email: str):
    payload = {
        "user_id": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

async def get_current_user(request: Request):
    # Check cookie first
    session_token = request.cookies.get("session_token")
    if session_token:
        session = await db.user_sessions.find_one(
            {"session_token": session_token}, {"_id": 0}
        )
        if session:
            expires_at = session.get("expires_at")
            if isinstance(expires_at, str):
                expires_at = datetime.fromisoformat(expires_at)
            if expires_at and expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at and expires_at > datetime.now(timezone.utc):
                user = await db.users.find_one(
                    {"user_id": session["user_id"]}, {"_id": 0}
                )
                if user:
                    return user

    # Check Authorization header (JWT)
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        # Check if it's a session token
        session = await db.user_sessions.find_one(
            {"session_token": token}, {"_id": 0}
        )
        if session:
            expires_at = session.get("expires_at")
            if isinstance(expires_at, str):
                expires_at = datetime.fromisoformat(expires_at)
            if expires_at and expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at and expires_at > datetime.now(timezone.utc):
                user = await db.users.find_one(
                    {"user_id": session["user_id"]}, {"_id": 0}
                )
                if user:
                    return user
        # Try JWT
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            user = await db.users.find_one(
                {"user_id": payload["user_id"]}, {"_id": 0}
            )
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
        "user_id": user_id,
        "email": data.email,
        "name": data.name,
        "password": hashed,
        "role": "admin",
        "picture": "",
        "created_at": datetime.now(timezone.utc),
    })
    token = create_token(user_id, data.email)
    return {"token": token, "user": {"user_id": user_id, "email": data.email, "name": data.name, "role": "admin"}}

@app.post("/api/auth/login")
async def login(data: UserLogin):
    user = await db.users.find_one({"email": data.email}, {"_id": 0})
    if not user or not pwd_context.verify(data.password, user.get("password", "")):
        raise HTTPException(status_code=401, detail="Credenciais invalidas")
    token = create_token(user["user_id"], user["email"])
    return {"token": token, "user": {"user_id": user["user_id"], "email": user["email"], "name": user["name"], "role": user.get("role", "admin")}}

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
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "password": "",
            "role": "admin",
            "created_at": datetime.now(timezone.utc),
        })

    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })

    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
        max_age=7 * 24 * 3600,
    )

    return {
        "user": {"user_id": user_id, "email": email, "name": name, "picture": picture, "role": "admin"},
        "session_token": session_token,
    }

@app.get("/api/auth/me")
async def auth_me(user=Depends(get_current_user)):
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "picture": user.get("picture", ""),
        "role": user.get("role", "admin"),
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
async def list_students(user=Depends(get_current_user), search: str = "", status: str = ""):
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
    students = await db.students.find(query, {"_id": 0}).sort("nome", 1).to_list(1000)
    return students

@app.post("/api/students")
async def create_student(data: StudentCreate, user=Depends(get_current_user)):
    existing = await db.students.find_one({"cpf": data.cpf}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="CPF ja cadastrado")
    student_id = f"std_{uuid.uuid4().hex[:12]}"
    doc = {
        "student_id": student_id,
        **data.model_dump(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.students.insert_one(doc)
    result = await db.students.find_one({"student_id": student_id}, {"_id": 0})
    return result

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
    plans = await db.plans.find({}, {"_id": 0}).sort("nome", 1).to_list(100)
    return plans

@app.get("/api/plans/public")
async def list_plans_public():
    plans = await db.plans.find({"ativo": True}, {"_id": 0}).sort("valor", 1).to_list(100)
    return plans

@app.post("/api/plans")
async def create_plan(data: PlanCreate, user=Depends(get_current_user)):
    plan_id = f"plan_{uuid.uuid4().hex[:12]}"
    doc = {
        "plan_id": plan_id,
        **data.model_dump(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.plans.insert_one(doc)
    result = await db.plans.find_one({"plan_id": plan_id}, {"_id": 0})
    return result

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
    total_students = await db.students.count_documents({})
    active_students = await db.students.count_documents({"status": "ativo"})
    inactive_students = await db.students.count_documents({"status": "inativo"})
    total_plans = await db.plans.count_documents({})

    # Revenue (sum of active students' plan values)
    pipeline = [
        {"$match": {"status": "ativo"}},
        {"$lookup": {
            "from": "plans",
            "localField": "plano_id",
            "foreignField": "plan_id",
            "as": "plano"
        }},
        {"$unwind": {"path": "$plano", "preserveNullAndEmptyArrays": True}},
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$plano.valor", 0]}}}}
    ]
    revenue_result = await db.students.aggregate(pipeline).to_list(1)
    faturamento = revenue_result[0]["total"] if revenue_result else 0

    # Today access count
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    acessos_hoje = await db.access_logs.count_documents({"timestamp": {"$gte": today_start.isoformat()}})

    # Recent access logs
    recent_logs = await db.access_logs.find({}, {"_id": 0}).sort("timestamp", -1).limit(10).to_list(10)

    return {
        "total_alunos": total_students,
        "alunos_ativos": active_students,
        "alunos_inativos": inactive_students,
        "total_planos": total_plans,
        "faturamento_mensal": faturamento,
        "acessos_hoje": acessos_hoje,
        "ultimos_acessos": recent_logs,
    }

# ============== ACCESS LOGS ==============

@app.get("/api/access-logs")
async def list_access_logs(user=Depends(get_current_user), limit: int = 50):
    logs = await db.access_logs.find({}, {"_id": 0}).sort("timestamp", -1).limit(limit).to_list(limit)
    return logs

# ============== ACCESS VALIDATION (for Local Agent) ==============

@app.post("/api/access/validate")
async def validate_access(data: AccessValidation):
    """Endpoint used by the local agent to validate turnstile access"""
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
    if not student:
        await db.access_logs.insert_one({
            "log_id": f"log_{uuid.uuid4().hex[:12]}",
            "tag_id": data.tag_id,
            "tipo": data.tipo,
            "student_id": "",
            "student_name": "Desconhecido",
            "autorizado": False,
            "motivo": "Aluno nao encontrado",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return {"autorizado": False, "motivo": "Aluno nao encontrado", "aluno": None}

    # Check if subscription is active
    if student.get("status") != "ativo":
        await db.access_logs.insert_one({
            "log_id": f"log_{uuid.uuid4().hex[:12]}",
            "tag_id": data.tag_id,
            "tipo": data.tipo,
            "student_id": student["student_id"],
            "student_name": student["nome"],
            "autorizado": False,
            "motivo": "Assinatura inativa",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return {"autorizado": False, "motivo": "Assinatura inativa", "aluno": student["nome"]}

    # Check expiry date
    vencimento = student.get("data_vencimento", "")
    if vencimento:
        try:
            dt_venc = datetime.fromisoformat(vencimento)
            if dt_venc.tzinfo is None:
                dt_venc = dt_venc.replace(tzinfo=timezone.utc)
            if dt_venc < datetime.now(timezone.utc):
                await db.students.update_one(
                    {"student_id": student["student_id"]},
                    {"$set": {"status": "inativo"}}
                )
                await db.access_logs.insert_one({
                    "log_id": f"log_{uuid.uuid4().hex[:12]}",
                    "tag_id": data.tag_id,
                    "tipo": data.tipo,
                    "student_id": student["student_id"],
                    "student_name": student["nome"],
                    "autorizado": False,
                    "motivo": "Assinatura vencida",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
                return {"autorizado": False, "motivo": "Assinatura vencida", "aluno": student["nome"]}
        except Exception:
            pass

    # Access granted
    await db.access_logs.insert_one({
        "log_id": f"log_{uuid.uuid4().hex[:12]}",
        "tag_id": data.tag_id,
        "tipo": data.tipo,
        "student_id": student["student_id"],
        "student_name": student["nome"],
        "autorizado": True,
        "motivo": "Acesso liberado",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"autorizado": True, "motivo": "Acesso liberado", "aluno": student["nome"]}

# ============== MERCADO PAGO WEBHOOK ==============

@app.post("/api/webhooks/mercadopago")
async def mercadopago_webhook(request: Request):
    """
    Webhook endpoint for Mercado Pago payment notifications.
    Flow: Receives payment notification -> Queries MP API -> If approved, renews student subscription.
    """
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

    # Query Mercado Pago API
    if not MP_ACCESS_TOKEN or MP_ACCESS_TOKEN == "placeholder":
        # Log the webhook for debugging even without token
        await db.webhook_logs.insert_one({
            "log_id": f"wh_{uuid.uuid4().hex[:12]}",
            "action": action,
            "payment_id": str(payment_id),
            "status": "token_not_configured",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return {"status": "received", "message": "Token MP nao configurado - webhook registrado"}

    try:
        async with httpx.AsyncClient() as http_client:
            resp = await http_client.get(
                f"https://api.mercadopago.com/v1/payments/{payment_id}",
                headers={"Authorization": f"Bearer {MP_ACCESS_TOKEN}"},
            )
            if resp.status_code != 200:
                await db.webhook_logs.insert_one({
                    "log_id": f"wh_{uuid.uuid4().hex[:12]}",
                    "action": action,
                    "payment_id": str(payment_id),
                    "status": "mp_api_error",
                    "error": resp.text,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
                return {"status": "error", "message": "Erro ao consultar MP"}

            payment_data = resp.json()
    except Exception as e:
        await db.webhook_logs.insert_one({
            "log_id": f"wh_{uuid.uuid4().hex[:12]}",
            "action": action,
            "payment_id": str(payment_id),
            "status": "exception",
            "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return {"status": "error", "message": str(e)}

    payment_status = payment_data.get("status")
    payer_email = payment_data.get("payer", {}).get("email", "")
    external_ref = payment_data.get("external_reference", "")

    await db.webhook_logs.insert_one({
        "log_id": f"wh_{uuid.uuid4().hex[:12]}",
        "action": action,
        "payment_id": str(payment_id),
        "payment_status": payment_status,
        "payer_email": payer_email,
        "external_reference": external_ref,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    if payment_status != "approved":
        return {"status": "received", "payment_status": payment_status}

    # Find student by email or external_reference (student_id)
    student = None
    if external_ref:
        student = await db.students.find_one({"student_id": external_ref}, {"_id": 0})
    if not student and payer_email:
        student = await db.students.find_one({"email": payer_email}, {"_id": 0})

    if not student:
        return {"status": "received", "message": "Pagamento aprovado mas aluno nao encontrado"}

    # Get plan to determine renewal days
    plan = None
    if student.get("plano_id"):
        plan = await db.plans.find_one({"plan_id": student["plano_id"]}, {"_id": 0})

    days_to_add = plan["duracao_dias"] if plan else 30

    # Renew subscription
    current_expiry = student.get("data_vencimento", "")
    if current_expiry:
        try:
            base_date = datetime.fromisoformat(current_expiry)
            if base_date.tzinfo is None:
                base_date = base_date.replace(tzinfo=timezone.utc)
            if base_date < datetime.now(timezone.utc):
                base_date = datetime.now(timezone.utc)
        except Exception:
            base_date = datetime.now(timezone.utc)
    else:
        base_date = datetime.now(timezone.utc)

    new_expiry = base_date + timedelta(days=days_to_add)

    await db.students.update_one(
        {"student_id": student["student_id"]},
        {"$set": {
            "status": "ativo",
            "data_vencimento": new_expiry.isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }}
    )

    return {
        "status": "processed",
        "message": f"Assinatura renovada ate {new_expiry.strftime('%d/%m/%Y')}",
        "aluno": student["nome"],
    }

# ============== WEBHOOK LOGS ==============

@app.get("/api/webhook-logs")
async def list_webhook_logs(user=Depends(get_current_user), limit: int = 50):
    logs = await db.webhook_logs.find({}, {"_id": 0}).sort("timestamp", -1).limit(limit).to_list(limit)
    return logs

# ============== SEED DATA ==============

@app.post("/api/seed")
async def seed_data():
    """Seed initial data for testing"""
    # Check if already seeded
    existing_plans = await db.plans.count_documents({})
    if existing_plans > 0:
        return {"message": "Dados ja existem"}

    # Create plans
    plans = [
        {"plan_id": "plan_mensal", "nome": "Mensal", "valor": 89.90, "duracao_dias": 30, "descricao": "Acesso completo por 30 dias", "ativo": True, "created_at": datetime.now(timezone.utc).isoformat()},
        {"plan_id": "plan_trimestral", "nome": "Trimestral", "valor": 239.90, "duracao_dias": 90, "descricao": "Acesso completo por 90 dias", "ativo": True, "created_at": datetime.now(timezone.utc).isoformat()},
        {"plan_id": "plan_semestral", "nome": "Semestral", "valor": 429.90, "duracao_dias": 180, "descricao": "Acesso completo por 180 dias", "ativo": True, "created_at": datetime.now(timezone.utc).isoformat()},
        {"plan_id": "plan_anual", "nome": "Anual", "valor": 799.90, "duracao_dias": 365, "descricao": "Acesso completo por 365 dias", "ativo": True, "created_at": datetime.now(timezone.utc).isoformat()},
    ]
    await db.plans.insert_many(plans)

    # Create sample students
    future = (datetime.now(timezone.utc) + timedelta(days=25)).isoformat()
    past = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
    students = [
        {"student_id": "std_001", "nome": "Carlos Silva", "email": "carlos@email.com", "cpf": "123.456.789-00", "telefone": "(11) 99999-0001", "plano_id": "plan_mensal", "tag_rfid": "0000000001", "biometria_id": "", "status": "ativo", "data_vencimento": future, "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()},
        {"student_id": "std_002", "nome": "Ana Souza", "email": "ana@email.com", "cpf": "234.567.890-11", "telefone": "(11) 99999-0002", "plano_id": "plan_trimestral", "tag_rfid": "0000000002", "biometria_id": "", "status": "ativo", "data_vencimento": future, "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()},
        {"student_id": "std_003", "nome": "Bruno Oliveira", "email": "bruno@email.com", "cpf": "345.678.901-22", "telefone": "(11) 99999-0003", "plano_id": "plan_semestral", "tag_rfid": "0000000003", "biometria_id": "", "status": "ativo", "data_vencimento": future, "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()},
        {"student_id": "std_004", "nome": "Fernanda Lima", "email": "fernanda@email.com", "cpf": "456.789.012-33", "telefone": "(11) 99999-0004", "plano_id": "plan_mensal", "tag_rfid": "0000000004", "biometria_id": "", "status": "inativo", "data_vencimento": past, "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()},
        {"student_id": "std_005", "nome": "Ricardo Santos", "email": "ricardo@email.com", "cpf": "567.890.123-44", "telefone": "(11) 99999-0005", "plano_id": "plan_anual", "tag_rfid": "0000000005", "biometria_id": "1", "status": "ativo", "data_vencimento": future, "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()},
    ]
    await db.students.insert_many(students)

    # Create admin user
    admin_exists = await db.users.find_one({"email": "admin@gymbro.com"}, {"_id": 0})
    if not admin_exists:
        await db.users.insert_one({
            "user_id": "user_admin001",
            "email": "admin@gymbro.com",
            "name": "Admin GymBro",
            "password": pwd_context.hash("admin123"),
            "role": "admin",
            "picture": "",
            "created_at": datetime.now(timezone.utc),
        })

    # Sample access logs
    access_logs = []
    for i in range(8):
        hours_ago = i * 2
        ts = (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat()
        access_logs.append({
            "log_id": f"log_seed_{i}",
            "tag_id": f"000000000{i+1}",
            "tipo": "rfid",
            "student_id": f"std_00{min(i+1,5)}",
            "student_name": ["Carlos Silva", "Ana Souza", "Bruno Oliveira", "Fernanda Lima", "Ricardo Santos"][min(i, 4)],
            "autorizado": i != 3,
            "motivo": "Acesso liberado" if i != 3 else "Assinatura inativa",
            "timestamp": ts,
        })
    await db.access_logs.insert_many(access_logs)

    return {"message": "Dados de teste criados com sucesso"}

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "GymBro API"}
