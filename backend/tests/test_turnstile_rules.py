import re
from datetime import datetime, timedelta, timezone

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


def test_turnstile_access_allows_grace_period_even_if_plan_expired():
    now = datetime(2026, 2, 20, 10, 0, tzinfo=timezone.utc)
    student = {
        "status": "ativo",
        "contract_access_status": "grace_period",
        "contract_grace_until": now + timedelta(days=2),
        "plan_expires_at": now - timedelta(days=1),
    }
    allow, reason, details = _evaluate_student_access(student, now)
    assert allow is True
    assert reason == "ok"
    assert details["rule"] == "grace_period"


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

    async def update_one(self, query, update, upsert=False):
        for item in self.docs:
            if _matches_query(item, query):
                for key, value in update.get("$set", {}).items():
                    item[key] = value
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

    def find(self, query, _projection=None):
        filtered = [doc for doc in self.docs if _matches_query(doc, query)]
        return _FakeCursor(filtered)

    async def count_documents(self, query):
        return sum(1 for doc in self.docs if _matches_query(doc, query))

    def aggregate(self, pipeline):
        items = list(self.docs)
        for stage in pipeline:
            if "$match" in stage:
                items = [doc for doc in items if _matches_query(doc, stage["$match"])]
                continue
            if "$group" in stage:
                group = stage["$group"]
                key_ref = str(group.get("_id") or "")
                key_name = key_ref[1:] if key_ref.startswith("$") else key_ref
                buckets: dict = {}
                for doc in items:
                    bucket_key = doc.get(key_name)
                    buckets[bucket_key] = int(buckets.get(bucket_key, 0)) + 1
                items = [{"_id": key, "count": value} for key, value in buckets.items()]
                continue
            if "$sort" in stage:
                field, direction = next(iter(stage["$sort"].items()))
                items = sorted(
                    items, key=lambda doc: doc.get(field), reverse=int(direction) < 0
                )
                continue
            if "$limit" in stage:
                items = items[: int(stage["$limit"])]
        return _FakeCursor(items)


class _FakeCursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, field, direction):
        self.docs = sorted(
            self.docs, key=lambda doc: doc.get(field), reverse=int(direction) < 0
        )
        return self

    def limit(self, limit):
        self.docs = self.docs[: int(limit)]
        return self

    async def to_list(self, limit):
        return list(self.docs[: int(limit)])


def _matches_query(doc: dict, query: dict) -> bool:
    for key, value in query.items():
        if key == "$or":
            if not any(_matches_query(doc, part) for part in value):
                return False
            continue
        if key == "$and":
            if not all(_matches_query(doc, part) for part in value):
                return False
            continue
        if isinstance(value, dict):
            actual = doc.get(key)
            for op, expected in value.items():
                if op == "$gte":
                    if actual is None or actual < expected:
                        return False
                elif op == "$gt":
                    if actual is None or actual <= expected:
                        return False
                elif op == "$lte":
                    if actual is None or actual > expected:
                        return False
                elif op == "$lt":
                    if actual is None or actual >= expected:
                        return False
                elif op == "$in":
                    if actual not in set(expected):
                        return False
                elif op == "$ne":
                    if actual == expected:
                        return False
                elif op == "$regex":
                    if actual is None or re.search(expected, str(actual)) is None:
                        return False
                else:
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
        self.owners = _FakeCollection([])
        self.students = _FakeCollection([])
        self.biometrics = _FakeCollection([])
        self.employees = _FakeCollection(
            [
                {
                    "employee_id": "emp_1",
                    "owner_id": "own_1",
                    "gym_id": "gym_1",
                    "name": "Recepcao",
                    "is_active": True,
                    "matricula": "FUNC0001",
                    "tag_rfid": "RFID-EMP-1",
                    "biometria_id": "BIO-EMP-1",
                    "keypad_code": "1234",
                }
            ]
        )
        self.access_logs = _FakeCollection([])
        self.turnstile_events = _FakeCollection([])
        self.turnstile_devices = _FakeCollection([])
        self.turnstile_security_events = _FakeCollection([])
        self.catraca_control_state = _FakeCollection([])


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


@pytest.mark.asyncio
async def test_turnstile_decision_allows_rfid_method_on_exit(monkeypatch):
    db = _FakeDb()

    async def fake_authenticate(*_args, **_kwargs):
        return (
            {"device_id": "dev_1", "owner_id": "own_1", "gym_id": "gym_1"},
            {
                "device_id": "dev_1",
                "method": "rfid",
                "credential": "RFID-EMP-1",
                "direction": "exit",
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
    assert decision["direction"] == "exit"
    assert db.access_logs.inserted[-1]["reason"] == "ok"
    assert db.access_logs.inserted[-1]["subject_type"] == "employee"


@pytest.mark.asyncio
async def test_turnstile_decision_matches_only_biometry_field(monkeypatch):
    db = _FakeDb()

    async def fake_authenticate(*_args, **_kwargs):
        return (
            {"device_id": "dev_1", "owner_id": "own_1", "gym_id": "gym_1"},
            {
                "device_id": "dev_1",
                "method": "biometry",
                "credential": "RFID-EMP-1",
                "direction": "entry",
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

    assert decision["allow"] is False
    assert db.access_logs.inserted[-1]["reason"] == "credential_not_found"
    assert db.access_logs.inserted[-1]["employee_id"] is None


@pytest.mark.asyncio
async def test_turnstile_decision_denies_when_credential_missing_on_exit(monkeypatch):
    db = _FakeDb()

    async def fake_authenticate(*_args, **_kwargs):
        return (
            {"device_id": "dev_1", "owner_id": "own_1", "gym_id": "gym_1"},
            {
                "device_id": "dev_1",
                "method": "biometry",
                "credential": "",
                "direction": "exit",
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

    assert decision["allow"] is False
    assert decision["message"] == "Use uma credencial valida para entrar e sair"
    assert db.access_logs.inserted[-1]["reason"] == "credential_required"
    assert db.access_logs.inserted[-1]["direction"] == "exit"


@pytest.mark.asyncio
async def test_turnstile_event_records_unauthorized_passage(monkeypatch):
    db = _FakeDb()

    async def fake_authenticate(*_args, **_kwargs):
        return (
            {"device_id": "dev_1", "owner_id": "own_1", "gym_id": "gym_1"},
            {
                "device_id": "dev_1",
                "method": "passage",
                "credential": "exit:42",
                "direction": "exit",
            },
        )

    monkeypatch.setattr(turnstiles, "get_db", lambda: db)
    monkeypatch.setattr(turnstiles, "_authenticate_gateway_request", fake_authenticate)
    monkeypatch.setattr(turnstiles, "log_event", lambda *_args, **_kwargs: None)

    response = await turnstiles.turnstile_event(
        payload={
            "event_type": "passage",
            "decision": False,
            "reason": "passage_without_authorization",
            "message": "Passagem sem credencial previa",
        },
        request=_DummyRequest(),
        x_device_token=None,
    )

    assert response["message"] == "Evento recebido"
    assert db.turnstile_events.inserted[-1]["reason"] == "passage_without_authorization"
    assert db.access_logs.inserted[-1]["reason"] == "passage_without_authorization"
    assert db.access_logs.inserted[-1]["decision"] == "deny"


@pytest.mark.asyncio
async def test_turnstile_decision_identifies_owner_credentials(monkeypatch):
    db = _FakeDb()
    db.owners.docs.append(
        {
            "owner_id": "own_1",
            "name": "Dono",
            "biometria_id": "BIO-OWN-1",
        }
    )

    async def fake_authenticate(*_args, **_kwargs):
        return (
            {"device_id": "dev_1", "owner_id": "own_1", "gym_id": "gym_1"},
            {
                "device_id": "dev_1",
                "method": "biometry",
                "credential": "BIO-OWN-1",
                "direction": "entry",
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
    assert db.access_logs.inserted[-1]["subject_type"] == "owner"
    assert db.access_logs.inserted[-1]["subject_name"] == "Dono"


@pytest.mark.asyncio
async def test_turnstile_control_state_can_lock_entry_for_employee(monkeypatch):
    db = _FakeDb()
    db.catraca_control_state.docs.append(
        {
            "owner_id": "own_1",
            "subject_controls": {
                "student": {"entry_locked": False, "exit_locked": False},
                "employee": {"entry_locked": True, "exit_locked": False},
                "owner": {"entry_locked": False, "exit_locked": False},
            },
        }
    )

    async def fake_authenticate(*_args, **_kwargs):
        return (
            {"device_id": "dev_1", "owner_id": "own_1", "gym_id": "gym_1"},
            {
                "device_id": "dev_1",
                "method": "biometry",
                "credential": "BIO-EMP-1",
                "direction": "entry",
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

    assert decision["allow"] is False
    assert decision["allow_entry"] is False
    assert decision["allow_exit"] is True
    assert db.access_logs.inserted[-1]["reason"] == "turnstile_direction_locked"


@pytest.mark.asyncio
async def test_turnstile_access_logs_accepts_filters(monkeypatch):
    now = datetime.now(timezone.utc)
    db = _FakeDb()
    db.access_logs = _FakeCollection(
        [
            {
                "access_id": "acc_1",
                "owner_id": "own_1",
                "decision": "allow",
                "subject_type": "student",
                "reason": "ok",
                "device_id": "dev_1",
                "credential": "1234567890",
                "created_at": now - timedelta(minutes=10),
            },
            {
                "access_id": "acc_2",
                "owner_id": "own_1",
                "decision": "deny",
                "subject_type": "student",
                "reason": "contract_access_blocked",
                "device_id": "dev_1",
                "credential": "555544443333",
                "created_at": now - timedelta(minutes=5),
            },
            {
                "access_id": "acc_3",
                "owner_id": "own_1",
                "decision": "deny",
                "subject_type": "employee",
                "reason": "employee_inactive",
                "device_id": "dev_2",
                "credential": "9988",
                "created_at": now - timedelta(minutes=2),
            },
        ]
    )
    monkeypatch.setattr(turnstiles, "get_db", lambda: db)

    result = await turnstiles.list_access_logs(
        limit=50,
        decision="deny",
        reason="contract_access_blocked",
        subject_type="student",
        device_id="dev_1",
        since_minutes=60,
        actor={"owner_id": "own_1"},
    )

    assert len(result) == 1
    assert result[0]["access_id"] == "acc_2"
    assert "credential" not in result[0]
    assert result[0]["credential_masked"] == "********3333"


@pytest.mark.asyncio
async def test_turnstile_access_logs_accepts_owner_subject_type(monkeypatch):
    now = datetime.now(timezone.utc)
    db = _FakeDb()
    db.access_logs = _FakeCollection(
        [
            {
                "access_id": "acc_1",
                "owner_id": "own_1",
                "decision": "allow",
                "subject_type": "owner",
                "reason": "ok",
                "device_id": "dev_1",
                "credential": "OWN001",
                "created_at": now - timedelta(minutes=4),
            },
            {
                "access_id": "acc_2",
                "owner_id": "own_1",
                "decision": "allow",
                "subject_type": "employee",
                "reason": "ok",
                "device_id": "dev_1",
                "credential": "EMP001",
                "created_at": now - timedelta(minutes=2),
            },
        ]
    )
    monkeypatch.setattr(turnstiles, "get_db", lambda: db)

    result = await turnstiles.list_access_logs(
        limit=50,
        decision="allow",
        reason="",
        subject_type="owner",
        device_id="dev_1",
        since_minutes=60,
        actor={"owner_id": "own_1"},
    )

    assert len(result) == 1
    assert result[0]["subject_type"] == "owner"


@pytest.mark.asyncio
async def test_turnstile_access_summary_includes_grace_and_device_health(monkeypatch):
    now = datetime.now(timezone.utc)
    db = _FakeDb()
    db.access_logs = _FakeCollection(
        [
            {
                "access_id": "acc_1",
                "owner_id": "own_1",
                "decision": "allow",
                "reason": "ok",
                "created_at": now - timedelta(minutes=10),
            },
            {
                "access_id": "acc_2",
                "owner_id": "own_1",
                "decision": "deny",
                "reason": "contract_access_blocked",
                "created_at": now - timedelta(minutes=8),
            },
            {
                "access_id": "acc_3",
                "owner_id": "own_1",
                "decision": "deny",
                "reason": "contract_access_blocked",
                "created_at": now - timedelta(hours=3),
            },
        ]
    )
    db.turnstile_devices = _FakeCollection(
        [
            {
                "device_id": "dev_1",
                "owner_id": "own_1",
                "last_seen_at": now - timedelta(minutes=2),
                "blocked_until": None,
            },
            {
                "device_id": "dev_2",
                "owner_id": "own_1",
                "last_seen_at": now - timedelta(minutes=20),
                "blocked_until": now + timedelta(minutes=30),
            },
        ]
    )
    db.students = _FakeCollection(
        [
            {
                "student_id": "stu_1",
                "owner_id": "own_1",
                "status": "ativo",
                "access_blocked": False,
                "contract_access_status": "grace_period",
            },
            {
                "student_id": "stu_2",
                "owner_id": "own_1",
                "status": "ativo",
                "access_blocked": True,
                "contract_access_status": "allowed",
            },
        ]
    )
    db.turnstile_security_events = _FakeCollection(
        [
            {
                "event_id": "sec_1",
                "owner_id": "own_1",
                "event": "auth_failure",
                "created_at": now - timedelta(minutes=30),
            }
        ]
    )
    monkeypatch.setattr(turnstiles, "get_db", lambda: db)

    summary = await turnstiles.get_access_summary(
        window_minutes=60,
        actor={"owner_id": "own_1"},
    )

    assert summary["window"]["total"] == 2
    assert summary["window"]["deny"] == 1
    assert summary["devices"]["total"] == 2
    assert summary["devices"]["online_5m"] == 1
    assert summary["devices"]["blocked"] == 1
    assert summary["grace_students"] == 1
    assert summary["blocked_students"] == 1
    assert summary["gateway_auth_failures_1h"] == 1
    assert summary["deny_reasons"][0]["reason"] == "contract_access_blocked"


@pytest.mark.asyncio
async def test_turnstile_decision_updates_operational_usage_for_allowed_student(
    monkeypatch,
):
    db = _FakeDb()
    db.students = _FakeCollection(
        [
            {
                "student_id": "std_1",
                "owner_id": "own_1",
                "gym_id": "gym_1",
                "nome": "Aluno Teste",
                "status": "ativo",
                "biometria_id": "BIO-STU-1",
                "contract_access_status": "allowed",
            }
        ]
    )

    async def fake_authenticate(*_args, **_kwargs):
        return (
            {"device_id": "dev_1", "owner_id": "own_1", "gym_id": "gym_1"},
            {
                "device_id": "dev_1",
                "method": "biometry",
                "credential": "BIO-STU-1",
                "direction": "entry",
            },
        )

    async def identity_refresh(student, now):
        return student

    monkeypatch.setattr(turnstiles, "get_db", lambda: db)
    monkeypatch.setattr(turnstiles, "_authenticate_gateway_request", fake_authenticate)
    monkeypatch.setattr(
        turnstiles, "_refresh_student_contract_snapshot", identity_refresh
    )
    monkeypatch.setattr(turnstiles, "log_event", lambda *_args, **_kwargs: None)

    decision = await turnstiles.turnstile_decision(
        payload={},
        request=_DummyRequest(),
        x_device_token=None,
    )

    updated_student = await db.students.find_one(
        {"owner_id": "own_1", "student_id": "std_1"}
    )
    assert decision["allow"] is True
    assert updated_student["operational_usage_status"] == "active_recent"
    assert updated_student.get("last_real_usage_at") is not None


@pytest.mark.asyncio
async def test_turnstile_decision_finds_student_by_biometrics_external_id_fallback(
    monkeypatch,
):
    db = _FakeDb()
    db.students = _FakeCollection(
        [
            {
                "student_id": "std_1",
                "owner_id": "own_1",
                "gym_id": "gym_1",
                "nome": "Aluno Fallback",
                "status": "ativo",
                "contract_access_status": "allowed",
            }
        ]
    )
    db.biometrics = _FakeCollection(
        [
            {
                "owner_id": "own_1",
                "subject_type": "student",
                "subject_id": "std_1",
                "external_id": "BIO-FALLBACK-1",
            }
        ]
    )

    async def fake_authenticate(*_args, **_kwargs):
        return (
            {"device_id": "dev_1", "owner_id": "own_1", "gym_id": "gym_1"},
            {
                "device_id": "dev_1",
                "method": "biometry",
                "credential": "BIO-FALLBACK-1",
                "direction": "entry",
            },
        )

    async def identity_refresh(student, now):
        return student

    monkeypatch.setattr(turnstiles, "get_db", lambda: db)
    monkeypatch.setattr(turnstiles, "_authenticate_gateway_request", fake_authenticate)
    monkeypatch.setattr(
        turnstiles, "_refresh_student_contract_snapshot", identity_refresh
    )
    monkeypatch.setattr(turnstiles, "log_event", lambda *_args, **_kwargs: None)

    decision = await turnstiles.turnstile_decision(
        payload={},
        request=_DummyRequest(),
        x_device_token=None,
    )

    assert decision["allow"] is True
    assert db.access_logs.inserted[-1]["subject_type"] == "student"
    assert db.access_logs.inserted[-1]["subject_id"] == "std_1"
    assert db.access_logs.inserted[-1]["reason_detail"]["fallback_used"] is True


@pytest.mark.asyncio
async def test_turnstile_decision_normalizes_numeric_biometry_before_lookup(
    monkeypatch,
):
    db = _FakeDb()
    db.students = _FakeCollection(
        [
            {
                "student_id": "std_1",
                "owner_id": "own_1",
                "gym_id": "gym_1",
                "nome": "Aluno Numerico",
                "status": "ativo",
                "biometria_id": "123",
                "contract_access_status": "allowed",
            }
        ]
    )

    async def fake_authenticate(*_args, **_kwargs):
        return (
            {"device_id": "dev_1", "owner_id": "own_1", "gym_id": "gym_1"},
            {
                "device_id": "dev_1",
                "method": "biometry",
                "credential": " 000123 ",
                "direction": "entry",
            },
        )

    async def identity_refresh(student, now):
        return student

    monkeypatch.setattr(turnstiles, "get_db", lambda: db)
    monkeypatch.setattr(turnstiles, "_authenticate_gateway_request", fake_authenticate)
    monkeypatch.setattr(
        turnstiles, "_refresh_student_contract_snapshot", identity_refresh
    )
    monkeypatch.setattr(turnstiles, "log_event", lambda *_args, **_kwargs: None)

    decision = await turnstiles.turnstile_decision(
        payload={},
        request=_DummyRequest(),
        x_device_token=None,
    )

    assert decision["allow"] is True
    assert db.access_logs.inserted[-1]["subject_id"] == "std_1"
    assert (
        db.access_logs.inserted[-1]["reason_detail"]["lookup_path"]
        == "students.biometria_id"
    )


@pytest.mark.asyncio
async def test_turnstile_decision_fallback_still_respects_contract_block(monkeypatch):
    db = _FakeDb()
    db.students = _FakeCollection(
        [
            {
                "student_id": "std_1",
                "owner_id": "own_1",
                "gym_id": "gym_1",
                "nome": "Aluno Bloqueado",
                "status": "ativo",
                "contract_access_status": "blocked",
                "contract_status": "active",
                "contract_financial_status": "overdue",
            }
        ]
    )
    db.biometrics = _FakeCollection(
        [
            {
                "owner_id": "own_1",
                "subject_type": "student",
                "subject_id": "std_1",
                "external_id": "000123",
            }
        ]
    )

    async def fake_authenticate(*_args, **_kwargs):
        return (
            {"device_id": "dev_1", "owner_id": "own_1", "gym_id": "gym_1"},
            {
                "device_id": "dev_1",
                "method": "biometry",
                "credential": "123",
                "direction": "entry",
            },
        )

    async def identity_refresh(student, now):
        return student

    monkeypatch.setattr(turnstiles, "get_db", lambda: db)
    monkeypatch.setattr(turnstiles, "_authenticate_gateway_request", fake_authenticate)
    monkeypatch.setattr(
        turnstiles, "_refresh_student_contract_snapshot", identity_refresh
    )
    monkeypatch.setattr(turnstiles, "log_event", lambda *_args, **_kwargs: None)

    decision = await turnstiles.turnstile_decision(
        payload={},
        request=_DummyRequest(),
        x_device_token=None,
    )

    assert decision["allow"] is False
    assert db.access_logs.inserted[-1]["reason"] == "contract_access_blocked"
    assert db.access_logs.inserted[-1]["reason_detail"]["fallback_used"] is True


@pytest.mark.asyncio
async def test_turnstile_decision_allows_barcode_method(monkeypatch):
    db = _FakeDb()

    async def fake_authenticate(*_args, **_kwargs):
        return (
            {"device_id": "dev_1", "owner_id": "own_1", "gym_id": "gym_1"},
            {
                "device_id": "dev_1",
                "method": "barcode",
                "credential": "func0001",
                "direction": "entry",
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
    assert db.access_logs.inserted[-1]["subject_type"] == "employee"


@pytest.mark.asyncio
async def test_turnstile_decision_allows_keypad_method(monkeypatch):
    db = _FakeDb()

    async def fake_authenticate(*_args, **_kwargs):
        return (
            {"device_id": "dev_1", "owner_id": "own_1", "gym_id": "gym_1"},
            {
                "device_id": "dev_1",
                "method": "keypad",
                "credential": "1234",
                "direction": "entry",
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
    assert db.access_logs.inserted[-1]["subject_type"] == "employee"


@pytest.mark.asyncio
async def test_manual_release_flow_for_daily_student_is_claimed_and_acknowledged(
    monkeypatch,
):
    db = _FakeDb()
    now = datetime.now(timezone.utc)
    db.students = _FakeCollection(
        [
            {
                "student_id": "std_daily",
                "owner_id": "own_1",
                "gym_id": "gym_1",
                "nome": "Aluno Diario",
                "status": "ativo",
                "contract_access_status": "allowed",
            }
        ]
    )
    db.student_contracts = _FakeCollection(
        [
            {
                "contract_id": "ctr_daily",
                "owner_id": "own_1",
                "gym_id": "gym_1",
                "student_id": "std_daily",
                "student_name": "Aluno Diario",
                "duration_days": 1,
                "contract_status": "active",
                "financial_status": "paid",
                "access_status": "allowed",
                "current_period_start": now - timedelta(hours=1),
                "current_period_end": now + timedelta(hours=2),
                "created_at": now - timedelta(hours=2),
            }
        ]
    )
    db.catraca_commands = _FakeCollection([])
    db.audit_logs = _FakeCollection([])

    async def identity_refresh(student, now):
        return student

    async def fake_gateway_auth(*_args, **_kwargs):
        return {"device_id": "dev_1", "owner_id": "own_1", "gym_id": "gym_1"}

    async def fake_latest_contract(*, owner_id, student_id):
        assert owner_id == "own_1"
        assert student_id == "std_daily"
        return db.student_contracts.docs[0]

    monkeypatch.setattr(turnstiles, "get_db", lambda: db)
    monkeypatch.setattr(
        turnstiles, "_refresh_student_contract_snapshot", identity_refresh
    )
    monkeypatch.setattr(
        turnstiles, "_authenticate_gateway_device_channel", fake_gateway_auth
    )
    monkeypatch.setattr(
        turnstiles, "_load_latest_student_contract", fake_latest_contract
    )
    monkeypatch.setattr(turnstiles, "log_event", lambda *_args, **_kwargs: None)

    created = await turnstiles.create_manual_turnstile_release(
        payload=turnstiles.ManualReleaseCreateIn(
            student_id="std_daily",
            direction="entry",
            reason="aluno diario sem biometria",
        ),
        actor={
            "owner_id": "own_1",
            "gym_id": "gym_1",
            "role": "RECEPTION",
            "actor_type": "employee",
            "employee_id": "emp_1",
        },
    )

    pulled = await turnstiles.pull_manual_turnstile_release(
        device_id="dev_1",
        request=_DummyRequest(),
        x_device_token="token",
    )
    acknowledged = await turnstiles.acknowledge_manual_turnstile_release(
        device_id="dev_1",
        release_id=created["cmd_id"],
        payload={"status": "executed", "success": True},
        request=_DummyRequest(),
        x_device_token="token",
    )

    command = await db.catraca_commands.find_one({"cmd_id": created["cmd_id"]})
    assert created["status"] == "pending"
    assert pulled["release_id"] == created["cmd_id"]
    assert pulled["direction"] == "entry"
    assert acknowledged["status"] == "executed"
    assert command["status"] == "executed"
    assert len(db.audit_logs.docs) == 1
