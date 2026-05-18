from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.deps import require_roles
from app.core.http import get_client_ip
from app.core.rate_limit import enforce_rate_limit
from app.core.security import decode_access_token
from app.core.time import UTC
from app.db.mongo import get_db
from app.services.observability import metrics_snapshot

router = APIRouter()


class ClientErrorPayload(BaseModel):
    message: str = Field(..., max_length=2000)
    stack: str = Field("", max_length=10000)
    component_stack: str = Field("", max_length=10000)
    url: str = Field("", max_length=2000)
    ua: str = Field("", max_length=1000)


@router.post("/client-errors", status_code=202)
async def report_client_error(
    payload: ClientErrorPayload,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    db = get_db()
    client_ip = get_client_ip(request)
    await enforce_rate_limit(
        scope="ops.client_errors.ip",
        key=client_ip,
        limit=20,
        window_seconds=60,
        error_detail="Limite de relatorios de erro atingido.",
    )

    actor_id = None
    owner_id = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:]
        try:
            claims = decode_access_token(token)
            actor_id = claims.get("sub")
            owner_id = claims.get("owner_id")
        except Exception:
            pass

    now = datetime.now(UTC)
    ttl_at = now + timedelta(days=30)
    await db.client_errors.insert_one(
        {
            "message": payload.message,
            "stack": payload.stack,
            "component_stack": payload.component_stack,
            "url": payload.url,
            "ua": payload.ua,
            "ip": client_ip,
            "actor_id": actor_id,
            "owner_id": owner_id,
            "created_at": now,
            "ttl_at": ttl_at,
        }
    )
    return {"ok": True}


@router.post("/csp-report", status_code=204)
async def csp_report(request: Request):
    client_ip = get_client_ip(request)
    await enforce_rate_limit(
        scope="ops.csp_report.ip",
        key=client_ip,
        limit=30,
        window_seconds=60,
        error_detail="Limite de relatorios CSP atingido.",
    )
    try:
        body = await request.json()
    except Exception:
        body = {}
    db = get_db()
    await db.csp_reports.insert_one(
        {"report": body, "ip": client_ip, "created_at": datetime.now(UTC)}
    )
    return None


@router.get("/metrics")
async def get_metrics(actor: dict = Depends(require_roles("OWNER", "MANAGER"))):
    return {
        "owner_id": actor["owner_id"],
        "generated_at": datetime.now(UTC),
        "runtime": metrics_snapshot(),
    }


@router.get("/alerts")
async def get_alerts(actor: dict = Depends(require_roles("OWNER", "MANAGER"))):
    settings = get_settings()
    db = get_db()
    now = datetime.now(UTC)

    webhook_window = now - timedelta(hours=24)
    turnstile_window = now - timedelta(hours=1)

    webhook_failures = await db.billing_events.count_documents(
        {
            "owner_id": actor["owner_id"],
            "received_at": {"$gte": webhook_window},
            "$or": [
                {"status": {"$in": ["past_due", "canceled", "expired", "reconcile_error"]}},
                {"action": {"$in": ["reconcile_error"]}},
            ],
        }
    )
    denied_accesses = await db.access_logs.count_documents(
        {
            "owner_id": actor["owner_id"],
            "created_at": {"$gte": turnstile_window},
            "decision": "deny",
        }
    )
    gateway_auth_failures = await db.turnstile_security_events.count_documents(
        {
            "owner_id": actor["owner_id"],
            "created_at": {"$gte": turnstile_window},
            "event": "auth_failure",
        }
    )

    alerts = []
    if webhook_failures >= settings.alert_webhook_failures_threshold:
        alerts.append(
            {
                "severity": "high",
                "code": "WEBHOOK_FAILURE_SPIKE",
                "message": f"{webhook_failures} falhas de billing nas ultimas 24h",
            }
        )
    if denied_accesses >= settings.alert_access_denies_threshold:
        alerts.append(
            {
                "severity": "medium",
                "code": "ACCESS_DENY_SPIKE",
                "message": f"{denied_accesses} negacoes de acesso na ultima hora",
            }
        )
    if gateway_auth_failures >= settings.alert_gateway_auth_failures_threshold:
        alerts.append(
            {
                "severity": "high",
                "code": "GATEWAY_AUTH_FAILURE_SPIKE",
                "message": f"{gateway_auth_failures} falhas de autenticacao do gateway na ultima hora",
            }
        )

    return {
        "owner_id": actor["owner_id"],
        "generated_at": now,
        "counters": {
            "webhook_failures_24h": webhook_failures,
            "access_denies_1h": denied_accesses,
            "gateway_auth_failures_1h": gateway_auth_failures,
        },
        "alerts": alerts,
    }
