import secrets
from datetime import UTC, datetime

import httpx

from app.core.config import get_settings
from app.db.mongo import get_db
from app.services.observability import log_event
from app.services.subscription import compute_grace_until, compute_next_period_end, now_utc


def _to_utc_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def map_mp_preapproval_status(mp_status: str | None) -> str:
    status_value = (mp_status or "").strip().lower()
    if status_value in {"authorized", "active"}:
        return "active"
    if status_value in {"cancelled", "canceled", "paused"}:
        return "canceled"
    if status_value in {"expired"}:
        return "expired"
    if status_value in {"pending"}:
        return "past_due"
    return "past_due"


async def _fetch_preapproval(client: httpx.AsyncClient, preapproval_id: str, token: str) -> dict:
    response = await client.get(
        f"https://api.mercadopago.com/preapproval/{preapproval_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    response.raise_for_status()
    return response.json()


async def reconcile_subscriptions(owner_id: str | None = None, limit: int | None = None) -> dict:
    settings = get_settings()
    db = get_db()

    if not settings.mp_access_token:
        return {
            "processed": 0,
            "updated": 0,
            "failed": 0,
            "skipped": 0,
            "reason": "mp_not_configured",
        }

    query: dict = {"provider": "mercadopago", "mp_preapproval_id": {"$nin": [None, ""]}}
    if owner_id:
        query["owner_id"] = owner_id

    max_items = int(limit or settings.billing_reconcile_batch_size)
    subscriptions = (
        await db.subscriptions.find(query, {"_id": 0}).limit(max_items).to_list(max_items)
    )

    processed = 0
    updated = 0
    failed = 0
    skipped = 0

    async with httpx.AsyncClient(timeout=15) as client:
        for sub in subscriptions:
            processed += 1
            preapproval_id = sub.get("mp_preapproval_id")
            if not preapproval_id:
                skipped += 1
                continue

            now = now_utc()
            owner = sub["owner_id"]
            try:
                mp_data = await _fetch_preapproval(client, preapproval_id, settings.mp_access_token)
                mapped = map_mp_preapproval_status(mp_data.get("status"))
                next_payment = _to_utc_datetime(mp_data.get("next_payment_date"))
                update: dict = {
                    "status": mapped,
                    "updated_at": now,
                    "meta.last_reconcile": {
                        "at": now,
                        "status": mp_data.get("status"),
                    },
                }
                if mapped == "active":
                    update["last_payment_at"] = now
                    update["grace_until"] = None
                    update["current_period_end"] = next_payment or compute_next_period_end(now)
                elif mapped == "past_due":
                    update["grace_until"] = compute_grace_until(now)

                result = await db.subscriptions.update_one({"owner_id": owner}, {"$set": update})
                if result.matched_count:
                    updated += 1

                await db.billing_events.insert_one(
                    {
                        "event_id": f"reconcile:{owner}:{int(now.timestamp() * 1000000)}:{secrets.token_hex(2)}",
                        "action": "reconcile_poll",
                        "owner_id": owner,
                        "status": mapped,
                        "payload": {
                            "source": "reconcile_job",
                            "mp_status": mp_data.get("status"),
                            "preapproval_id": preapproval_id,
                        },
                        "received_at": now,
                    }
                )
                await db.subscription_events.insert_one(
                    {
                        "event_id": (
                            f"subevt_reconcile:{owner}:{int(now.timestamp() * 1000000)}"
                            f":{secrets.token_hex(2)}"
                        ),
                        "owner_id": owner,
                        "source": "reconcile",
                        "event_type": "poll_status",
                        "status": mapped,
                        "metadata": {
                            "preapproval_id": preapproval_id,
                            "mp_status": mp_data.get("status"),
                        },
                        "created_at": now,
                    }
                )
            except Exception as exc:  # pragma: no cover - network dependent
                failed += 1
                log_event(
                    "billing_reconcile_error",
                    owner_id=owner,
                    preapproval_id=preapproval_id,
                    error=str(exc),
                )
                await db.billing_events.insert_one(
                    {
                        "event_id": (
                            f"reconcile_error:{owner}:{int(now.timestamp() * 1000000)}"
                            f":{secrets.token_hex(2)}"
                        ),
                        "action": "reconcile_error",
                        "owner_id": owner,
                        "status": "reconcile_error",
                        "payload": {
                            "source": "reconcile_job",
                            "preapproval_id": preapproval_id,
                            "error": str(exc),
                        },
                        "received_at": now,
                    }
                )

    return {
        "processed": processed,
        "updated": updated,
        "failed": failed,
        "skipped": skipped,
    }
