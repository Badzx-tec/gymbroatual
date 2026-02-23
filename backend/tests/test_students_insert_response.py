import pytest
from bson import BSON

from app.models.students import StudentIn
from app.routes import students


class FakeCollection:
    def __init__(self):
        self.docs = []

    async def insert_one(self, doc: dict):
        doc["_id"] = object()
        self.docs.append(dict(doc))


class FakeDb:
    def __init__(self):
        self.students = FakeCollection()
        self.measurements = FakeCollection()
        self.workouts = FakeCollection()
        self.attendance = FakeCollection()
        self.access_logs = FakeCollection()

    async def find_one(self, *_args, **_kwargs):
        return {"nome": "Aluno"}


@pytest.mark.asyncio
async def test_create_student_response_strips_mongo_id(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(students, "get_db", lambda: db)

    payload = StudentIn(nome="Aluno", email=None, status="ativo")
    owner = {"owner_id": "own_1", "gym_id": "gym_1"}
    result = await students.create_student(payload=payload, owner=owner)

    assert result["owner_id"] == "own_1"
    assert result["gym_id"] == "gym_1"
    assert "_id" not in result


def test_normalize_student_doc_data_converts_dates_for_mongo():
    payload = StudentIn(
        nome="Aluno",
        cpf="12345678901",
        data_vencimento="2026-02-23",
        data_nascimento="1990-01-01",
        status="ativo",
    )
    normalized = students._normalize_student_doc_data(payload)

    assert isinstance(normalized["data_vencimento"], students.datetime)
    assert isinstance(normalized["data_nascimento"], students.datetime)
    BSON.encode(normalized)
