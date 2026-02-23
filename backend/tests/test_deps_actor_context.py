import pytest
from fastapi import HTTPException

from app.core import deps


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = [dict(item) for item in (docs or [])]

    async def find_one(self, query: dict, _projection=None):
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in query.items()):
                return doc
        return None

    async def update_one(self, query: dict, update: dict):
        target = await self.find_one(query)
        if not target:
            return
        for key, value in update.get("$set", {}).items():
            target[key] = value


class FakeDb:
    def __init__(self, owners=None, gyms=None, employees=None):
        self.owners = FakeCollection(owners)
        self.gyms = FakeCollection(gyms)
        self.employees = FakeCollection(employees)


@pytest.mark.asyncio
async def test_get_current_actor_recovers_owner_gym_id_from_gyms(monkeypatch):
    db = FakeDb(
        owners=[{"owner_id": "own_1", "name": "Owner", "email": "owner@gymbro.com"}],
        gyms=[{"owner_id": "own_1", "gym_id": "gym_1"}],
    )
    monkeypatch.setattr(deps, "get_db", lambda: db)
    monkeypatch.setattr(
        deps,
        "safe_jwt_decode",
        lambda _token: {"sub": "own_1", "actor_type": "owner"},
    )

    actor = await deps.get_current_actor(authorization="Bearer fake-token")
    owner_doc = await db.owners.find_one({"owner_id": "own_1"})

    assert actor["owner_id"] == "own_1"
    assert actor["gym_id"] == "gym_1"
    assert owner_doc["gym_id"] == "gym_1"


@pytest.mark.asyncio
async def test_get_current_actor_raises_when_owner_has_no_gym(monkeypatch):
    db = FakeDb(owners=[{"owner_id": "own_1", "name": "Owner", "email": "owner@gymbro.com"}], gyms=[])
    monkeypatch.setattr(deps, "get_db", lambda: db)
    monkeypatch.setattr(
        deps,
        "safe_jwt_decode",
        lambda _token: {"sub": "own_1", "actor_type": "owner"},
    )

    with pytest.raises(HTTPException) as exc:
        await deps.get_current_actor(authorization="Bearer fake-token")

    assert exc.value.status_code == 409
    assert exc.value.detail == "Academia nao vinculada ao usuario"
