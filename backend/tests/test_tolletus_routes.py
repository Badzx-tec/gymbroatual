from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.models.students import TolletusEnrollConfirmIn
from app.routes import tolletus


class _FakeCollection:
    def __init__(self, docs=None):
        self.docs = docs or []

    async def find_one(self, query, _projection=None):
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in query.items()):
                return doc
        return None

    async def update_one(self, query, update, upsert=False):
        for item in self.docs:
            if all(item.get(key) == value for key, value in query.items()):
                item.update(update.get("$set", {}))
                return type(
                    "UpdateResult", (), {"matched_count": 1, "modified_count": 1}
                )()

        if upsert:
            created = dict(query)
            created.update(update.get("$setOnInsert", {}))
            created.update(update.get("$set", {}))
            self.docs.append(created)
            return type(
                "UpdateResult",
                (),
                {"matched_count": 0, "modified_count": 0, "upserted_id": "up_1"},
            )()

        return type("UpdateResult", (), {"matched_count": 0, "modified_count": 0})()


class _FakeDb:
    def __init__(self):
        now = datetime.now(timezone.utc)
        self.students = _FakeCollection(
            [
                {
                    "student_id": "std_1",
                    "owner_id": "own_1",
                    "nome": "Aluno Teste",
                    "created_at": now,
                    "updated_at": now,
                }
            ]
        )
        self.biometrics = _FakeCollection([])


class _FakeTolletusClient:
    def __init__(self, external_id):
        self.external_id = external_id

    async def enroll_confirm(
        self, student_id: str, device_id: str, template: str
    ) -> dict:
        return {
            "provider": "tolletus",
            "student_id": student_id,
            "device_id": device_id,
            "template": template,
            "external_id": self.external_id,
        }


@pytest.mark.asyncio
async def test_student_enroll_confirm_updates_students_biometria_id(monkeypatch):
    db = _FakeDb()

    monkeypatch.setattr(tolletus, "get_db", lambda: db)
    monkeypatch.setattr(
        tolletus, "_resolve_client", lambda: _FakeTolletusClient(" ext-001 ")
    )
    monkeypatch.setattr(
        tolletus, "encrypt_template", lambda template: f"enc:{template}"
    )
    monkeypatch.setattr(
        tolletus, "log_event", lambda *_args, **_kwargs: None, raising=False
    )

    result = await tolletus.enroll_confirm(
        TolletusEnrollConfirmIn(
            student_id="std_1",
            device_id="dev_1",
            template="tpl-data",
        ),
        owner={"owner_id": "own_1"},
    )

    student = await db.students.find_one({"student_id": "std_1", "owner_id": "own_1"})
    biometric = await db.biometrics.find_one(
        {"student_id": "std_1", "owner_id": "own_1"}
    )

    assert result["biometria_id"] == "ext-001"
    assert student["biometria_id"] == "ext-001"
    assert biometric["external_id"] == "ext-001"


@pytest.mark.asyncio
async def test_student_enroll_confirm_normalizes_numeric_external_id(monkeypatch):
    db = _FakeDb()

    monkeypatch.setattr(tolletus, "get_db", lambda: db)
    monkeypatch.setattr(
        tolletus, "_resolve_client", lambda: _FakeTolletusClient("ignored")
    )
    monkeypatch.setattr(
        tolletus, "encrypt_template", lambda template: f"enc:{template}"
    )
    monkeypatch.setattr(
        tolletus, "log_event", lambda *_args, **_kwargs: None, raising=False
    )

    result = await tolletus.enroll_confirm(
        TolletusEnrollConfirmIn(
            student_id="std_1",
            device_id="dev_1",
            template="tpl-data",
            external_id=" 000123 ",
        ),
        owner={"owner_id": "own_1"},
    )

    student = await db.students.find_one({"student_id": "std_1", "owner_id": "own_1"})
    biometric = await db.biometrics.find_one(
        {"student_id": "std_1", "owner_id": "own_1"}
    )

    assert result["biometria_id"] == "123"
    assert student["biometria_id"] == "123"
    assert biometric["external_id"] == "123"


@pytest.mark.asyncio
async def test_student_enroll_confirm_fails_without_resolvable_external_id(monkeypatch):
    db = _FakeDb()

    monkeypatch.setattr(tolletus, "get_db", lambda: db)
    monkeypatch.setattr(tolletus, "_resolve_client", lambda: _FakeTolletusClient("   "))
    monkeypatch.setattr(
        tolletus, "encrypt_template", lambda template: f"enc:{template}"
    )
    monkeypatch.setattr(
        tolletus, "log_event", lambda *_args, **_kwargs: None, raising=False
    )

    with pytest.raises(HTTPException) as exc_info:
        await tolletus.enroll_confirm(
            TolletusEnrollConfirmIn(
                student_id="std_1",
                device_id="dev_1",
                template="tpl-data",
            ),
            owner={"owner_id": "own_1"},
        )

    student = await db.students.find_one({"student_id": "std_1", "owner_id": "own_1"})

    assert exc_info.value.status_code == 502
    assert "external_id" in exc_info.value.detail
    assert student.get("biometria_id") is None
    assert db.biometrics.docs == []
