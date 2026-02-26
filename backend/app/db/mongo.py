from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError

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


async def _ensure_employee_email_unique_index(db: AsyncIOMotorDatabase) -> None:
    index_name = "owner_id_1_email_1"
    indexes = await db.employees.index_information()
    current = indexes.get(index_name)

    # Recria o índice legado para suportar múltiplos funcionários sem email
    # e manter unicidade quando email estiver presente.
    if current and current.get("unique") and "partialFilterExpression" not in current:
        await db.employees.drop_index(index_name)

    await db.employees.create_index(
        [("owner_id", 1), ("email", 1)],
        unique=True,
        partialFilterExpression={"email": {"$type": "string"}},
    )


async def _ensure_matricula_unique_index(
    collection, *, owner_field: str = "owner_id", matricula_field: str = "matricula"
) -> None:
    index_name = f"{owner_field}_1_{matricula_field}_1"
    indexes = await collection.index_information()
    current = indexes.get(index_name)

    expected_partial = {matricula_field: {"$type": "string"}}
    if current:
        if not current.get("unique") or current.get("partialFilterExpression") != expected_partial:
            await collection.drop_index(index_name)

    try:
        await collection.create_index(
            [(owner_field, 1), (matricula_field, 1)],
            unique=True,
            partialFilterExpression=expected_partial,
        )
    except DuplicateKeyError:
        # Compatibilidade: bases legadas com duplicidade nao devem impedir bootstrap.
        await collection.create_index([(owner_field, 1), (matricula_field, 1)])


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
    await db.student_contracts.create_index([("owner_id", 1), ("contract_id", 1)], unique=True)
    await db.student_contracts.create_index([("owner_id", 1), ("student_id", 1), ("status", 1)])
    await db.student_charges.create_index([("owner_id", 1), ("charge_id", 1)], unique=True)
    await db.student_charges.create_index([("owner_id", 1), ("contract_id", 1), ("due_at", -1)])
    await db.student_billing_events.create_index([("owner_id", 1), ("created_at", -1)])
    await db.students.create_index([("owner_id", 1), ("student_id", 1)], unique=True)
    await _ensure_matricula_unique_index(db.students)
    await db.students.create_index([("owner_id", 1), ("tag_rfid", 1)])
    await db.students.create_index([("owner_id", 1), ("biometria_id", 1)])
    await db.students.create_index([("email", 1)])
    await db.students.create_index([("cpf", 1)])
    await db.students.create_index([("auth_login_enabled", 1)])
    await _ensure_employee_email_unique_index(db)
    await _ensure_matricula_unique_index(db.employees)
    await db.employees.create_index([("owner_id", 1), ("tag_rfid", 1)])
    await db.employees.create_index([("owner_id", 1), ("biometria_id", 1)])
    await db.employees.create_index([("owner_id", 1), ("keypad_code", 1)])
    await db.biometrics.create_index([("owner_id", 1), ("subject_type", 1), ("subject_id", 1)])
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
