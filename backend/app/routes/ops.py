from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends

from app.core.config import get_settings
from app.core.deps import require_roles
from app.db.mongo import get_db
from app.services.observability import metrics_snapshot

router = APIRouter()


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
