import pytest
from fastapi import HTTPException

from app.routes import gyms


class FakeCollection:
    def __init__(self):
        self.docs = []

    async def insert_one(self, doc: dict):
        self.docs.append(dict(doc))

    async def update_one(self, query: dict, update: dict):
        for item in self.docs:
            if all(item.get(k) == v for k, v in query.items()):
                for key, value in update.get("$set", {}).items():
                    item[key] = value
                return type("Result", (), {"matched_count": 1})()
        return type("Result", (), {"matched_count": 0})()

    async def find_one(self, query: dict, _projection=None):
        for item in self.docs:
            if all(item.get(k) == v for k, v in query.items()):
                return dict(item)
        return None


class FakeDb:
    def __init__(self):
        self.plans = FakeCollection()


@pytest.mark.asyncio
async def test_create_plan_rejects_invalid_payload(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(gyms, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc:
        await gyms.create_plan(
            payload={"nome": "A", "valor": -1, "duracao_dias": 0},
            owner={"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"},
        )

    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_update_plan_rejects_empty_payload(monkeypatch):
    db = FakeDb()
    db.plans.docs.append(
        {
            "plan_id": "pln_1",
            "owner_id": "own_1",
            "nome": "Mensal",
            "valor": 100.0,
            "duracao_dias": 30,
            "ativo": True,
        }
    )
    monkeypatch.setattr(gyms, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc:
        await gyms.update_plan(
            plan_id="pln_1",
            payload={},
            owner={"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"},
        )

    assert exc.value.status_code == 400
