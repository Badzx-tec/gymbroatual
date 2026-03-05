from datetime import datetime, timedelta, timezone

import pytest

from app.routes import platform_admin


class UpdateResult:
    def __init__(self, matched_count: int, modified_count: int):
        self.matched_count = matched_count
        self.modified_count = modified_count


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = [dict(item) for item in (docs or [])]

    async def find_one(self, query, _projection=None):
        for item in self.docs:
            if _matches(item, query):
                return item
        return None

    async def update_one(self, query, update, upsert=False):
        for item in self.docs:
            if _matches(item, query):
                for key, value in (update.get("$set") or {}).items():
                    _set_value(item, key, value)
                return UpdateResult(1, 1)
        if upsert:
            created = dict(query)
            for key, value in (update.get("$setOnInsert") or {}).items():
                _set_value(created, key, value)
            for key, value in (update.get("$set") or {}).items():
                _set_value(created, key, value)
            self.docs.append(created)
            return UpdateResult(1, 1)
        return UpdateResult(0, 0)

    async def insert_one(self, doc):
        self.docs.append(dict(doc))


class FakeDb:
    def __init__(self):
        now = datetime(2026, 3, 5, 12, 0, tzinfo=timezone.utc)
        self.owners = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "name": "Owner Teste",
                    "email": "owner@example.com",
                }
            ]
        )
        self.subscriptions = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "status": "expired",
                    "grace_until": None,
                    "trial_ends_at": now - timedelta(days=10),
                    "current_period_end": now - timedelta(days=5),
                    "updated_at": now - timedelta(days=2),
                }
            ]
        )
        self.memberships = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "status": "expired",
                    "updated_at": now - timedelta(days=2),
                }
            ]
        )
        self.subscription_events = FakeCollection([])


def _set_value(doc: dict, key: str, value):
    parts = key.split(".")
    cursor = doc
    for part in parts[:-1]:
        if part not in cursor or not isinstance(cursor[part], dict):
            cursor[part] = {}
        cursor = cursor[part]
    cursor[parts[-1]] = value


def _matches(doc: dict, query: dict) -> bool:
    for key, expected in query.items():
        if isinstance(expected, dict):
            if "$in" in expected:
                if doc.get(key) not in expected["$in"]:
                    return False
                continue
            return False
        if doc.get(key) != expected:
            return False
    return True


@pytest.mark.asyncio
async def test_grant_owner_grace_sets_past_due_and_grace(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(platform_admin, "get_db", lambda: db)
    actor = {"role": "SUPER_ADMIN", "email": "super@example.com"}

    result = await platform_admin.grant_owner_grace(
        owner_id="own_1",
        payload=platform_admin.OwnerGraceIn(days=3, reason="teste"),
        actor=actor,
    )

    updated_sub = await db.subscriptions.find_one({"owner_id": "own_1"})
    updated_mem = await db.memberships.find_one({"owner_id": "own_1"})

    assert result["owner_id"] == "own_1"
    assert result["status"] == "past_due"
    assert updated_sub["status"] == "past_due"
    assert updated_sub["grace_until"] is not None
    assert updated_mem["status"] == "past_due"
    assert any(item.get("event_type") == "manual_grace_granted" for item in db.subscription_events.docs)


@pytest.mark.asyncio
async def test_clear_owner_grace_removes_grace_and_expires_past_due(monkeypatch):
    db = FakeDb()
    now = datetime.now(timezone.utc)
    db.subscriptions.docs[0]["status"] = "past_due"
    db.subscriptions.docs[0]["grace_until"] = now + timedelta(days=2)
    db.memberships.docs[0]["status"] = "past_due"

    monkeypatch.setattr(platform_admin, "get_db", lambda: db)
    actor = {"role": "SUPER_ADMIN", "email": "super@example.com"}

    result = await platform_admin.clear_owner_grace(
        owner_id="own_1",
        actor=actor,
    )

    updated_sub = await db.subscriptions.find_one({"owner_id": "own_1"})
    updated_mem = await db.memberships.find_one({"owner_id": "own_1"})

    assert result["owner_id"] == "own_1"
    assert result["status"] == "expired"
    assert updated_sub["status"] == "expired"
    assert updated_sub["grace_until"] is None
    assert updated_mem["status"] == "expired"
    assert any(item.get("event_type") == "manual_grace_removed" for item in db.subscription_events.docs)
