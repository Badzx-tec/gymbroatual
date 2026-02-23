from datetime import datetime, timezone

import pytest

from app.routes import turnstiles
from app.routes.turnstiles import _evaluate_employee_access, _evaluate_student_access


def test_turnstile_access_denied_when_manual_block():
    now = datetime(2026, 2, 22, 10, 0, tzinfo=timezone.utc)
    student = {"status": "ativo", "access_blocked": True}
    allow, reason, _details = _evaluate_student_access(student, now)
    assert allow is False
    assert reason == "student_manual_block"


def test_turnstile_access_denied_when_outside_weekday():
    now = datetime(2026, 2, 22, 10, 0, tzinfo=timezone.utc)  # sunday (6)
    student = {"status": "ativo", "allowed_weekdays": [0, 1, 2, 3, 4]}
    allow, reason, _details = _evaluate_student_access(student, now)
    assert allow is False
    assert reason == "outside_allowed_weekday"


def test_turnstile_access_allowed_when_rules_pass():
    now = datetime(2026, 2, 20, 10, 0, tzinfo=timezone.utc)  # friday (4)
    student = {
        "status": "ativo",
        "allowed_weekdays": [0, 1, 2, 3, 4, 5, 6],
        "allowed_time_start": "08:00",
        "allowed_time_end": "22:00",
    }
    allow, reason, _details = _evaluate_student_access(student, now)
    assert allow is True
    assert reason == "ok"


def test_turnstile_employee_access_allowed_when_rules_pass():
    now = datetime(2026, 2, 20, 10, 0, tzinfo=timezone.utc)
    employee = {
        "is_active": True,
        "allowed_weekdays": [0, 1, 2, 3, 4, 5, 6],
        "allowed_time_start": "08:00",
        "allowed_time_end": "22:00",
    }
    allow, reason, _details = _evaluate_employee_access(employee, now)
    assert allow is True
    assert reason == "ok"


def test_turnstile_employee_access_denied_when_inactive():
    now = datetime(2026, 2, 20, 10, 0, tzinfo=timezone.utc)
    allow, reason, _details = _evaluate_employee_access({"is_active": False}, now)
    assert allow is False
    assert reason == "employee_inactive"


class _FakeCollection:
    def __init__(self, docs=None):
        self.docs = docs or []
        self.inserted = []

    async def find_one(self, query, _projection=None):
        for doc in self.docs:
            if _matches_query(doc, query):
                return doc
        return None

    async def insert_one(self, doc):
        self.inserted.append(doc)
        self.docs.append(doc)

    async def update_one(self, _query, _update):
        return None


def _matches_query(doc: dict, query: dict) -> bool:
    for key, value in query.items():
        if key == "$or":
            if not any(_matches_query(doc, part) for part in value):
                return False
            continue
        if doc.get(key) != value:
            return False
    return True


class _FakeDb:
    def __init__(self):
        self.subscriptions = _FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "status": "active",
                    "current_period_end": datetime(2099, 1, 1, tzinfo=timezone.utc),
                }
            ]
        )
        self.students = _FakeCollection([])
        self.employees = _FakeCollection(
            [
                {
                    "employee_id": "emp_1",
                    "owner_id": "own_1",
                    "gym_id": "gym_1",
                    "name": "Recepcao",
                    "is_active": True,
                    "biometria_id": "BIO-EMP-1",
                }
            ]
        )
        self.access_logs = _FakeCollection([])


class _DummyClient:
    host = "127.0.0.1"


class _DummyRequest:
    headers = {}
    client = _DummyClient()


@pytest.mark.asyncio
async def test_turnstile_decision_allows_employee_credentials(monkeypatch):
    db = _FakeDb()

    async def fake_authenticate(*_args, **_kwargs):
        return (
            {"device_id": "dev_1", "owner_id": "own_1", "gym_id": "gym_1"},
            {
                "device_id": "dev_1",
                "method": "biometry",
                "credential": "BIO-EMP-1",
            },
        )

    monkeypatch.setattr(turnstiles, "get_db", lambda: db)
    monkeypatch.setattr(turnstiles, "_authenticate_gateway_request", fake_authenticate)
    monkeypatch.setattr(turnstiles, "log_event", lambda *_args, **_kwargs: None)

    decision = await turnstiles.turnstile_decision(
        payload={},
        request=_DummyRequest(),
        x_device_token=None,
    )

    assert decision["allow"] is True
    assert db.access_logs.inserted[-1]["employee_id"] == "emp_1"
    assert db.access_logs.inserted[-1]["subject_type"] == "employee"
