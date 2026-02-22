from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import get_settings

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        settings = get_settings()
        _client = AsyncIOMotorClient(settings.mongo_uri)
    return _client


def get_db() -> AsyncIOMotorDatabase:
    settings = get_settings()
    return get_client()[settings.db_name]


async def init_indexes() -> None:
    db = get_db()
    await db.owners.create_index("email", unique=True)
    await db.gyms.create_index("owner_id", unique=True)
    await db.subscriptions.create_index("owner_id", unique=True)
    await db.memberships.create_index("owner_id", unique=True)
    await db.invoices.create_index([("owner_id", 1), ("period_label", 1)], unique=True)
    await db.invoices.create_index([("owner_id", 1), ("created_at", -1)])
    await db.payment_attempts.create_index([("owner_id", 1), ("created_at", -1)])
    await db.subscription_events.create_index([("owner_id", 1), ("created_at", -1)])
    await db.students.create_index([("owner_id", 1), ("student_id", 1)], unique=True)
    await db.students.create_index([("owner_id", 1), ("matricula", 1)])
    await db.students.create_index([("owner_id", 1), ("tag_rfid", 1)])
    await db.students.create_index([("owner_id", 1), ("biometria_id", 1)])
    await db.employees.create_index([("owner_id", 1), ("email", 1)], unique=True)
    await db.employee_invites.create_index("token", unique=True)
    await db.employee_invites.create_index("expires_at")
    await db.billing_events.create_index("event_id", unique=True)
    await db.billing_events.create_index([("owner_id", 1), ("received_at", -1)])
    await db.turnstile_devices.create_index([("owner_id", 1), ("device_id", 1)], unique=True)
    await db.access_logs.create_index([("owner_id", 1), ("created_at", -1)])
    await db.turnstile_events.create_index([("owner_id", 1), ("created_at", -1)])
    await db.turnstile_nonces.create_index([("device_id", 1), ("nonce", 1)], unique=True)
    await db.turnstile_nonces.create_index("expires_at", expireAfterSeconds=0)
    await db.turnstile_security_events.create_index([("owner_id", 1), ("created_at", -1)])
    await db.rate_limits.create_index("expires_at", expireAfterSeconds=0)
