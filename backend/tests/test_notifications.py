from datetime import datetime, timezone

import pytest

from app.routes import legacy


class UpdateResult:
    def __init__(self, matched_count: int, modified_count: int):
        self.matched_count = matched_count
        self.modified_count = modified_count


class DeleteResult:
    def __init__(self, deleted_count: int):
        self.deleted_count = deleted_count


def _matches(doc: dict, query: dict) -> bool:
    for key, expected in query.items():
        value = doc.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and value not in expected["$in"]:
                return False
            continue
        if value != expected:
            return False
    return True


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = [dict(item) for item in (docs or [])]

    async def update_one(self, query: dict, update: dict):
        modified = 0
        for doc in self.docs:
            if _matches(doc, query):
                for key, value in (update.get("$set") or {}).items():
                    doc[key] = value
                modified += 1
                break
        return UpdateResult(modified, modified)

    async def update_many(self, query: dict, update: dict):
        matched = 0
        modified = 0
        for doc in self.docs:
            if _matches(doc, query):
                matched += 1
                for key, value in (update.get("$set") or {}).items():
                    doc[key] = value
                modified += 1
        return UpdateResult(matched, modified)

    async def delete_one(self, query: dict):
        return await self.delete_many(query)

    async def delete_many(self, query: dict):
        kept = []
        deleted = 0
        for doc in self.docs:
            if _matches(doc, query):
                deleted += 1
            else:
                kept.append(doc)
        self.docs = kept
        return DeleteResult(deleted)


class FakeDb:
    def __init__(self):
        now = datetime(2026, 3, 8, 12, 0, tzinfo=timezone.utc)
        self.notifications = FakeCollection(
            [
                {
                    "notif_id": "n_1",
                    "owner_id": "own_1",
                    "titulo": "Primeira",
                    "lida": False,
                    "created_at": now,
                },
                {
                    "notif_id": "n_2",
                    "owner_id": "own_1",
                    "titulo": "Segunda",
                    "lida": False,
                    "created_at": now,
                },
                {
                    "notif_id": "n_3",
                    "owner_id": "own_2",
                    "titulo": "Outra academia",
                    "lida": False,
                    "created_at": now,
                },
            ]
        )


@pytest.mark.asyncio
async def test_notifications_bulk_read_marks_only_owner_records(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(legacy, "get_db", lambda: db)

    result = await legacy.notification_read_bulk(
        payload={"notif_ids": ["n_1", "n_2", "n_3"]},
        actor={"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"},
    )

    own_1_docs = [item for item in db.notifications.docs if item["owner_id"] == "own_1"]
    own_2_doc = next(item for item in db.notifications.docs if item["owner_id"] == "own_2")

    assert result["updated"] == 2
    assert all(item["lida"] is True for item in own_1_docs)
    assert all(item.get("read_at") is not None for item in own_1_docs)
    assert own_2_doc["lida"] is False


@pytest.mark.asyncio
async def test_notifications_bulk_delete_scopes_owner(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(legacy, "get_db", lambda: db)

    result = await legacy.notification_delete_bulk(
        payload={"notif_ids": ["n_1", "n_3"]},
        actor={"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"},
    )

    remaining_ids = {item["notif_id"] for item in db.notifications.docs}

    assert result["deleted"] == 1
    assert remaining_ids == {"n_2", "n_3"}

