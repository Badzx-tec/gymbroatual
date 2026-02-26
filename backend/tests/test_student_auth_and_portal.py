from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.core import deps
from app.core.security import hash_password
from app.routes import auth, student_portal


class FakeCursor:
    def __init__(self, docs: list[dict]):
        self.docs = [dict(item) for item in docs]
        self._limit = len(self.docs)

    def sort(self, field: str, direction: int):
        reverse = direction == -1
        self.docs.sort(key=lambda item: item.get(field), reverse=reverse)
        return self

    def limit(self, limit: int):
        self._limit = limit
        return self

    async def to_list(self, _limit: int):
        return self.docs[: self._limit]


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = [dict(item) for item in (docs or [])]

    async def find_one(self, query: dict, _projection=None):
        for doc in self.docs:
            if _matches(doc, query):
                return doc
        return None

    def find(self, query: dict, _projection=None):
        return FakeCursor([item for item in self.docs if _matches(item, query)])


class FakeDb:
    def __init__(self):
        now = datetime(2026, 2, 20, 12, 0, tzinfo=timezone.utc)
        self.students = FakeCollection(
            [
                {
                    "student_id": "std_1",
                    "owner_id": "own_1",
                    "gym_id": "gym_1",
                    "nome": "Aluno 1",
                    "email": "aluno1@gymbro.com",
                    "cpf": "123.456.789-01",
                    "matricula": "ALU0001",
                    "status": "ativo",
                    "password_hash": hash_password("Secret123!"),
                    "auth_login_enabled": True,
                    "is_employee_shadow": False,
                    "plan_expires_at": now,
                },
                {
                    "student_id": "std_2",
                    "owner_id": "own_1",
                    "gym_id": "gym_1",
                    "nome": "Aluno 2",
                    "email": "aluno2@gymbro.com",
                    "cpf": "222.222.222-22",
                    "matricula": "ALU0002",
                    "status": "ativo",
                    "password_hash": hash_password("Other123!"),
                    "auth_login_enabled": True,
                    "is_employee_shadow": False,
                },
            ]
        )
        self.subscriptions = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "status": "active",
                    "trial_ends_at": None,
                    "current_period_end": now + timedelta(days=30),
                    "grace_until": None,
                }
            ]
        )
        self.student_contracts = FakeCollection(
            [
                {
                    "contract_id": "ctr_1",
                    "owner_id": "own_1",
                    "student_id": "std_1",
                    "status": "active",
                    "amount": 129.9,
                    "current_period_start": now,
                    "current_period_end": now,
                    "created_at": now,
                },
                {
                    "contract_id": "ctr_2",
                    "owner_id": "own_1",
                    "student_id": "std_2",
                    "status": "active",
                    "amount": 149.9,
                    "current_period_start": now,
                    "current_period_end": now,
                    "created_at": now,
                },
            ]
        )
        self.access_logs = FakeCollection(
            [
                {"log_id": "log_1", "owner_id": "own_1", "student_id": "std_1", "created_at": now},
                {"log_id": "log_2", "owner_id": "own_1", "student_id": "std_2", "created_at": now},
            ]
        )
        self.notifications = FakeCollection(
            [
                {"notif_id": "n_1", "owner_id": "own_1", "student_id": "std_1", "created_at": now},
                {"notif_id": "n_2", "owner_id": "own_1", "student_id": "std_2", "created_at": now},
            ]
        )


def _matches(doc: dict, query: dict) -> bool:
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(doc, option) for option in expected):
                return False
            continue
        value = doc.get(key)
        if isinstance(expected, dict):
            for op, op_value in expected.items():
                if op == "$ne" and value == op_value:
                    return False
                if op == "$in" and value not in op_value:
                    return False
            continue
        if value != expected:
            return False
    return True


@pytest.mark.asyncio
async def test_student_login_by_cpf_returns_student_role(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(auth, "get_db", lambda: db)

    result = await auth._login_student("12345678901", "Secret123!")

    assert result is not None
    assert result["user"]["role"] == "STUDENT"
    assert result["user"]["student_id"] == "std_1"
    assert result["token"]


@pytest.mark.asyncio
async def test_student_cannot_pass_admin_actor_guard():
    dep = deps.require_admin_actor()
    with pytest.raises(HTTPException) as exc:
        await dep({"actor_type": "student", "role": "STUDENT", "owner_id": "own_1"})
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_student_portal_returns_only_own_data(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(student_portal, "get_db", lambda: db)

    actor = {"owner_id": "own_1", "student_id": "std_1", "actor_type": "student", "role": "STUDENT"}
    response = await student_portal.student_dashboard(actor=actor)

    assert response["student"]["student_id"] == "std_1"
    assert all(item["student_id"] == "std_1" for item in response["recent_access_logs"])
    assert all(item["student_id"] == "std_1" for item in response["notifications"])
