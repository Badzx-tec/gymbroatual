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

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        target = await self.find_one(query)
        matched_count = 1 if target else 0
        if not target and upsert:
            target = dict(query)
            self.docs.append(target)

        if target:
            for key, value in update.get("$setOnInsert", {}).items():
                target.setdefault(key, value)
            for key, value in update.get("$set", {}).items():
                target[key] = value

        return type("UpdateResult", (), {"matched_count": matched_count})

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
    def __init__(self, gyms=None, employees=None, students=None):
        self.gyms = FakeCollection(gyms)
        self.employees = FakeCollection(employees)
        self.students = FakeCollection(students)
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


@pytest.mark.asyncio
async def test_create_employee_auto_matricula_skips_legacy_sequence(monkeypatch):
    employees = []
    for sequence in range(1, 56):
        employees.append(
            {
                "employee_id": f"emp_{sequence}",
                "owner_id": "own_1",
                "gym_id": "gym_1",
                "name": f"Existente {sequence}",
                "role": "RECEPTION",
                "matricula": f"FUNC{sequence:04d}",
                "password_hash": "hash",
                "is_active": True,
            }
        )

    db = FakeDb(employees=employees)
    monkeypatch.setattr(staff, "get_db", lambda: db)

    result = await staff.create_employee(
        payload={"name": "Novo", "role": "MANAGER", "sync_shadow_student": False},
        actor={"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"},
    )

    assert result["matricula"] == "FUNC0056"
    assert result["matricula_auto_generated"] is True


@pytest.mark.asyncio
async def test_create_employee_blank_matricula_with_shadow_sync(monkeypatch):
    db = FakeDb(students=[])
    monkeypatch.setattr(staff, "get_db", lambda: db)

    result = await staff.create_employee(
        payload={
            "name": "Rafaela",
            "email": "rafae@gmail.com",
            "role": "MANAGER",
            "matricula": "",
            "tag_rfid": "",
            "biometria_id": "",
            "keypad_code": "159",
            "sync_shadow_student": True,
        },
        actor={"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"},
    )

    assert result["name"] == "Rafaela"
    assert result["matricula"].startswith("FUNC")
    assert result["matricula_auto_generated"] is True
    assert result["shadow_student_id"].startswith("empstd_")
    assert "shadow_sync_warning" not in result


@pytest.mark.asyncio
async def test_reset_employee_password_accepts_custom_password(monkeypatch):
    db = FakeDb(
        employees=[
            {
                "employee_id": "emp_1",
                "owner_id": "own_1",
                "gym_id": "gym_1",
                "name": "Recepcao",
                "role": "RECEPTION",
                "password_hash": "hash-antigo",
                "is_active": True,
            }
        ]
    )
    monkeypatch.setattr(staff, "get_db", lambda: db)

    result = await staff.reset_password(
        employee_id="emp_1",
        payload={"new_password": "NovaSenha#2026"},
        actor={"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"},
    )

    assert result["temp_password"] == "NovaSenha#2026"
    updated = await db.employees.find_one({"employee_id": "emp_1", "owner_id": "own_1"})
    assert updated["password_hash"] != "hash-antigo"
    assert updated.get("session_revoked_at") is not None
