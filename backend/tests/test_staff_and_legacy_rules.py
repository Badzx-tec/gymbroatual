from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.routes import legacy, staff


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = [dict(item) for item in (docs or [])]

    async def find_one(self, query: dict, _projection=None):
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in query.items()):
                return doc
        return None

    async def insert_one(self, doc: dict):
        self.docs.append(dict(doc))

    async def find_one_and_update(self, query: dict, update: dict, upsert: bool = False, **_kwargs):
        target = await self.find_one(query)
        if not target:
            if not upsert:
                return None
            target = dict(query)
            self.docs.append(target)
            for key, value in update.get("$setOnInsert", {}).items():
                target[key] = value

        for key, value in update.get("$inc", {}).items():
            target[key] = int(target.get(key, 0)) + int(value)
        for key, value in update.get("$set", {}).items():
            target[key] = value
        return target


class FakeDb:
    def __init__(self, gyms=None, employees=None):
        self.gyms = FakeCollection(gyms)
        self.employees = FakeCollection(employees)
        self.counters = FakeCollection([])


@pytest.mark.asyncio
async def test_create_academy_is_disabled(monkeypatch):
    db = FakeDb(gyms=[{"gym_id": "gym_1", "owner_id": "own_1", "created_at": datetime.now(timezone.utc)}])
    monkeypatch.setattr(legacy, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc:
        await legacy.create_academy(payload={"nome": "Outra"}, actor={"owner_id": "own_1", "gym_id": "gym_1"})

    assert exc.value.status_code == 403
    assert exc.value.detail == "Gestao de franquias desabilitada"


@pytest.mark.asyncio
async def test_create_employee_accepts_missing_email(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(staff, "get_db", lambda: db)

    result = await staff.create_employee(
        payload={"name": "Atendente", "role": "RECEPTION", "sync_shadow_student": False},
        actor={"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"},
    )

    assert result["name"] == "Atendente"
    assert result["email"] is None
    assert result["matricula"] == "FUNC0001"
    assert result["matricula_auto_generated"] is True
    assert "temp_password" in result


@pytest.mark.asyncio
async def test_create_employee_rejects_duplicate_manual_matricula(monkeypatch):
    db = FakeDb(
        employees=[
            {
                "employee_id": "emp_1",
                "owner_id": "own_1",
                "gym_id": "gym_1",
                "name": "Existente",
                "role": "RECEPTION",
                "matricula": "FUNC0099",
                "password_hash": "hash",
                "is_active": True,
            }
        ]
    )
    monkeypatch.setattr(staff, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc:
        await staff.create_employee(
            payload={
                "name": "Novo",
                "role": "RECEPTION",
                "matricula": "func0099",
                "sync_shadow_student": False,
            },
            actor={"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"},
        )

    assert exc.value.status_code == 409
    assert exc.value.detail == "Matricula ja cadastrada"
