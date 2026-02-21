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
    await db.students.create_index([("owner_id", 1), ("student_id", 1)], unique=True)
    await db.verification_events.create_index("email")
    await db.billing_events.create_index("event_id", unique=True)
