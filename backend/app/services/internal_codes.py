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


def _extract_sequence(value, prefix: str) -> int | None:
    if value is None:
        return None
    code = str(value).strip().upper()
    normalized_prefix = prefix.upper()
    if not code.startswith(normalized_prefix):
        return None
    suffix = code[len(normalized_prefix) :]
    if not suffix.isdigit():
        return None
    return int(suffix)


async def _find_max_sequence(
    db,
    *,
    owner_id: str,
    collection_name: str,
    prefix: str,
    field_name: str,
) -> int:
    collection = getattr(db, collection_name)
    max_sequence = 0

    if hasattr(collection, "find"):
        docs = await collection.find({"owner_id": owner_id}, {"_id": 0, field_name: 1}).to_list(10000)
    else:
        docs = getattr(collection, "docs", [])

    for item in docs:
        sequence = _extract_sequence(item.get(field_name), prefix)
        if sequence is not None and sequence > max_sequence:
            max_sequence = sequence
    return max_sequence


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
    max_attempts: int = 500,
) -> str:
    now = datetime.now(UTC)
    counters = getattr(db, "counters", None)
    if counters is None or not hasattr(counters, "find_one_and_update"):
        max_sequence = await _find_max_sequence(
            db,
            owner_id=owner_id,
            collection_name=collection_name,
            prefix=prefix,
            field_name=field_name,
        )
        collection = getattr(db, collection_name)
        for sequence in range(max_sequence + 1, max_sequence + max_attempts + 1):
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

    # Se o contador ainda nao existe, semeia usando o maior codigo atual para evitar
    # colisoes em bases legadas com muitas matriculas ja cadastradas.
    counter = await counters.find_one({"owner_id": owner_id, "key": counter_key}, {"_id": 0, "value": 1})
    if not counter:
        seed_value = await _find_max_sequence(
            db,
            owner_id=owner_id,
            collection_name=collection_name,
            prefix=prefix,
            field_name=field_name,
        )
        await counters.find_one_and_update(
            {"owner_id": owner_id, "key": counter_key},
            {
                "$setOnInsert": {
                    "owner_id": owner_id,
                    "key": counter_key,
                    "value": int(seed_value),
                    "created_at": now,
                },
                "$set": {"updated_at": now},
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )

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
