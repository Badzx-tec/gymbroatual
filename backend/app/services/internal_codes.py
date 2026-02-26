from datetime import datetime

from pymongo import ReturnDocument

from app.core.time import UTC


def normalize_internal_code(value) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip().upper()
    return cleaned or None


def format_internal_code(prefix: str, sequence: int, *, width: int = 4) -> str:
    return f"{prefix.upper()}{int(sequence):0{width}d}"


async def ensure_unique_internal_code(
    db,
    *,
    collection_name: str,
    owner_id: str,
    code: str,
    field_name: str = "matricula",
    exclude_id_field: str | None = None,
    exclude_id_value: str | None = None,
) -> None:
    query: dict = {"owner_id": owner_id, field_name: code}
    if exclude_id_field and exclude_id_value:
        query[exclude_id_field] = {"$ne": exclude_id_value}
    collection = getattr(db, collection_name)
    if hasattr(collection, "find_one"):
        existing = await collection.find_one(query, {"_id": 0, field_name: 1})
    else:
        existing = None
        docs = getattr(collection, "docs", [])
        for item in docs:
            if item.get("owner_id") != owner_id:
                continue
            if item.get(field_name) != code:
                continue
            if exclude_id_field and exclude_id_value and item.get(exclude_id_field) == exclude_id_value:
                continue
            existing = item
            break
    if existing:
        raise ValueError(f"{field_name} ja cadastrada")


async def generate_unique_internal_code(
    db,
    *,
    owner_id: str,
    collection_name: str,
    prefix: str,
    counter_key: str,
    field_name: str = "matricula",
    width: int = 4,
    max_attempts: int = 50,
) -> str:
    now = datetime.now(UTC)
    counters = getattr(db, "counters", None)
    if counters is None or not hasattr(counters, "find_one_and_update"):
        collection = getattr(db, collection_name)
        for sequence in range(1, max_attempts + 1):
            candidate = format_internal_code(prefix, sequence, width=width)
            if hasattr(collection, "find_one"):
                exists = await collection.find_one(
                    {"owner_id": owner_id, field_name: candidate},
                    {"_id": 0, field_name: 1},
                )
            else:
                exists = None
                for item in getattr(collection, "docs", []):
                    if item.get("owner_id") == owner_id and item.get(field_name) == candidate:
                        exists = item
                        break
            if not exists:
                return candidate
        raise RuntimeError("Nao foi possivel gerar codigo interno unico")

    for _ in range(max_attempts):
        counter = await counters.find_one_and_update(
            {"owner_id": owner_id, "key": counter_key},
            {
                "$inc": {"value": 1},
                "$setOnInsert": {
                    "owner_id": owner_id,
                    "key": counter_key,
                    "value": 0,
                    "created_at": now,
                },
                "$set": {"updated_at": now},
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        sequence = int((counter or {}).get("value") or 0)
        candidate = format_internal_code(prefix, sequence, width=width)
        exists = await getattr(db, collection_name).find_one(
            {"owner_id": owner_id, field_name: candidate},
            {"_id": 0, field_name: 1},
        )
        if not exists:
            return candidate
    raise RuntimeError("Nao foi possivel gerar codigo interno unico")
