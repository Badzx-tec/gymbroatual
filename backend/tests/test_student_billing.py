from datetime import datetime, timedelta, timezone

import pytest

from app.models.student_billing import ChargeCleanupIn, ChargeMarkPaidIn, ContractCreateIn
from app.routes import student_billing


class UpdateResult:
    def __init__(self, matched_count: int, modified_count: int):
        self.matched_count = matched_count
        self.modified_count = modified_count


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
    def __init__(self, docs: list[dict] | None = None):
        self.docs = [dict(item) for item in (docs or [])]

    async def find_one(self, query: dict, _projection=None):
        for doc in self.docs:
            if _matches(doc, query):
                return doc
        return None

    def find(self, query: dict, _projection=None):
        return FakeCursor([item for item in self.docs if _matches(item, query)])

    async def insert_one(self, doc: dict):
        self.docs.append(dict(doc))

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        target = None
        for doc in self.docs:
            if _matches(doc, query):
                target = doc
                break

        if target is None and not upsert:
            return UpdateResult(0, 0)

        if target is None and upsert:
            target = dict(query)
            self.docs.append(target)
            for key, value in update.get("$setOnInsert", {}).items():
                _set_value(target, key, value)

        for key, value in update.get("$set", {}).items():
            _set_value(target, key, value)
        for key, value in update.get("$inc", {}).items():
            current = _get_value(target, key) or 0
            _set_value(target, key, current + value)

        return UpdateResult(1, 1)

    async def update_many(self, query: dict, update: dict):
        matched = 0
        for doc in self.docs:
            if _matches(doc, query):
                matched += 1
                for key, value in update.get("$set", {}).items():
                    _set_value(doc, key, value)
                for key, value in update.get("$inc", {}).items():
                    current = _get_value(doc, key) or 0
                    _set_value(doc, key, current + value)
        return UpdateResult(matched, matched)

    async def count_documents(self, query: dict):
        return sum(1 for item in self.docs if _matches(item, query))


class FakeDb:
    def __init__(self):
        now = datetime(2026, 2, 22, 12, 0, tzinfo=timezone.utc)
        self.students = FakeCollection(
            [
                {
                    "student_id": "std_1",
                    "owner_id": "own_1",
                    "gym_id": "gym_1",
                    "nome": "Aluno Teste",
                    "status": "ativo",
                    "updated_at": now,
                }
            ]
        )
        self.plans = FakeCollection(
            [
                {
                    "plan_id": "pln_1",
                    "owner_id": "own_1",
                    "nome": "Mensal",
                    "valor": 149.9,
                    "duracao_dias": 30,
                }
            ]
        )
        self.student_contracts = FakeCollection([])
        self.student_charges = FakeCollection([])
        self.student_billing_events = FakeCollection([])


def _set_value(doc: dict, key: str, value):
    parts = key.split(".")
    cursor = doc
    for part in parts[:-1]:
        if part not in cursor or not isinstance(cursor[part], dict):
            cursor[part] = {}
        cursor = cursor[part]
    cursor[parts[-1]] = value


def _get_value(doc: dict, key: str):
    parts = key.split(".")
    cursor = doc
    for part in parts:
        if not isinstance(cursor, dict) or part not in cursor:
            return None
        cursor = cursor[part]
    return cursor


def _matches(doc: dict, query: dict) -> bool:
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(doc, option) for option in expected):
                return False
            continue

        value = _get_value(doc, key) if "." in key else doc.get(key)
        if isinstance(expected, dict):
            for op, op_value in expected.items():
                if op == "$lt" and not (value is not None and value < op_value):
                    return False
                if op == "$lte" and not (value is not None and value <= op_value):
                    return False
                if op == "$gt" and not (value is not None and value > op_value):
                    return False
                if op == "$gte" and not (value is not None and value >= op_value):
                    return False
                if op == "$in" and value not in op_value:
                    return False
            continue

        if value != expected:
            return False
    return True


@pytest.mark.asyncio
async def test_create_contract_with_plan_creates_initial_charge_and_updates_student(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    actor = {"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"}
    start_at = datetime(2026, 3, 1, 0, 0, tzinfo=timezone.utc)
    payload = ContractCreateIn(student_id="std_1", plan_id="pln_1", start_at=start_at)

    result = await student_billing.create_contract(payload=payload, actor=actor)
    contract = result["contract"]
    charge = result["initial_charge"]
    updated_student = await db.students.find_one({"owner_id": "own_1", "student_id": "std_1"})

    assert contract["plan_name"] == "Mensal"
    assert contract["status"] == "active"
    assert contract["manual_end_override"] is False
    assert contract["current_period_end"] == start_at + timedelta(days=30)
    assert charge["status"] == "open"
    assert updated_student["plano_id"] == "pln_1"
    assert updated_student["plan_expires_at"] == contract["current_period_end"]


@pytest.mark.asyncio
async def test_create_contract_respects_manual_period_end_override(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    actor = {"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"}
    start_at = datetime(2026, 4, 1, 0, 0, tzinfo=timezone.utc)
    manual_end = datetime(2026, 5, 20, 0, 0, tzinfo=timezone.utc)
    payload = ContractCreateIn(
        student_id="std_1",
        plan_id="pln_1",
        start_at=start_at,
        end_at=manual_end,
    )

    result = await student_billing.create_contract(payload=payload, actor=actor)
    contract = result["contract"]

    assert contract["manual_end_override"] is True
    assert contract["current_period_end"] == manual_end


@pytest.mark.asyncio
async def test_mark_charge_paid_extends_contract_period(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    now = datetime.now(timezone.utc)
    old_end = now + timedelta(days=10)
    contract = {
        "contract_id": "ctr_test",
        "owner_id": "own_1",
        "gym_id": "gym_1",
        "student_id": "std_1",
        "student_name": "Aluno Teste",
        "plan_id": "pln_1",
        "plan_name": "Mensal",
        "amount": 149.9,
        "currency": "BRL",
        "duration_days": 30,
        "current_period_start": now - timedelta(days=20),
        "current_period_end": old_end,
        "status": "past_due",
        "auto_renew": False,
        "notes": None,
        "canceled_at": None,
        "last_payment_at": None,
        "last_charge_id": None,
        "created_at": now - timedelta(days=20),
        "updated_at": now - timedelta(days=1),
    }
    db.student_contracts.docs.append(contract)
    db.student_charges.docs.append(
        {
            "charge_id": "chg_test",
            "contract_id": "ctr_test",
            "owner_id": "own_1",
            "gym_id": "gym_1",
            "student_id": "std_1",
            "amount": 149.9,
            "currency": "BRL",
            "due_at": now - timedelta(days=1),
            "status": "overdue",
            "paid_at": None,
            "payment_method": None,
            "amount_received": None,
            "external_reference": None,
            "notes": None,
            "period_start": now - timedelta(days=20),
            "period_end": old_end,
            "created_at": now - timedelta(days=1),
            "updated_at": now - timedelta(days=1),
        }
    )

    actor = {"owner_id": "own_1", "gym_id": "gym_1", "role": "MANAGER"}
    paid = await student_billing.mark_charge_paid(
        charge_id="chg_test",
        payload=ChargeMarkPaidIn(payment_method="card", extend_contract=True),
        actor=actor,
    )

    updated_contract = await db.student_contracts.find_one(
        {"owner_id": "own_1", "contract_id": "ctr_test"}
    )
    updated_student = await db.students.find_one({"owner_id": "own_1", "student_id": "std_1"})

    assert paid["status"] == "paid"
    assert paid["payment_method"] == "card"
    assert updated_contract["status"] == "active"
    assert updated_contract["current_period_end"] > old_end
    assert updated_student["plan_expires_at"] == updated_contract["current_period_end"]


@pytest.mark.asyncio
async def test_cleanup_contract_charges_cancels_pending_and_records_event(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    now = datetime.now(timezone.utc)
    contract = {
        "contract_id": "ctr_cleanup",
        "owner_id": "own_1",
        "gym_id": "gym_1",
        "student_id": "std_1",
        "student_name": "Aluno Teste",
        "plan_id": "pln_1",
        "plan_name": "Mensal",
        "amount": 149.9,
        "currency": "BRL",
        "duration_days": 30,
        "current_period_start": now - timedelta(days=15),
        "current_period_end": now + timedelta(days=15),
        "status": "past_due",
        "auto_renew": False,
        "notes": None,
        "canceled_at": None,
        "last_payment_at": None,
        "last_charge_id": "chg_overdue",
        "created_at": now - timedelta(days=20),
        "updated_at": now - timedelta(days=1),
    }
    db.student_contracts.docs.append(contract)
    db.student_charges.docs.extend(
        [
            {
                "charge_id": "chg_open",
                "contract_id": "ctr_cleanup",
                "owner_id": "own_1",
                "gym_id": "gym_1",
                "student_id": "std_1",
                "amount": 149.9,
                "currency": "BRL",
                "due_at": now + timedelta(days=5),
                "status": "open",
                "paid_at": None,
                "payment_method": None,
                "amount_received": None,
                "external_reference": None,
                "notes": None,
                "period_start": now - timedelta(days=15),
                "period_end": now + timedelta(days=15),
                "created_at": now,
                "updated_at": now,
            },
            {
                "charge_id": "chg_overdue",
                "contract_id": "ctr_cleanup",
                "owner_id": "own_1",
                "gym_id": "gym_1",
                "student_id": "std_1",
                "amount": 149.9,
                "currency": "BRL",
                "due_at": now - timedelta(days=3),
                "status": "overdue",
                "paid_at": None,
                "payment_method": None,
                "amount_received": None,
                "external_reference": None,
                "notes": None,
                "period_start": now - timedelta(days=15),
                "period_end": now + timedelta(days=15),
                "created_at": now - timedelta(days=4),
                "updated_at": now - timedelta(days=3),
            },
            {
                "charge_id": "chg_paid",
                "contract_id": "ctr_cleanup",
                "owner_id": "own_1",
                "gym_id": "gym_1",
                "student_id": "std_1",
                "amount": 149.9,
                "currency": "BRL",
                "due_at": now - timedelta(days=20),
                "status": "paid",
                "paid_at": now - timedelta(days=20),
                "payment_method": "card",
                "amount_received": 149.9,
                "external_reference": None,
                "notes": None,
                "period_start": now - timedelta(days=45),
                "period_end": now - timedelta(days=15),
                "created_at": now - timedelta(days=45),
                "updated_at": now - timedelta(days=20),
            },
        ]
    )

    actor = {"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"}
    result = await student_billing.cleanup_contract_charges(
        contract_id="ctr_cleanup",
        payload=ChargeCleanupIn(status_filter="pending", reason="test_cleanup"),
        actor=actor,
    )

    assert result.cleaned_count == 2
    assert set(result.charge_ids) == {"chg_open", "chg_overdue"}
    assert result.contract_status == "active"

    open_charge = await db.student_charges.find_one({"charge_id": "chg_open", "owner_id": "own_1"})
    overdue_charge = await db.student_charges.find_one(
        {"charge_id": "chg_overdue", "owner_id": "own_1"}
    )
    paid_charge = await db.student_charges.find_one({"charge_id": "chg_paid", "owner_id": "own_1"})

    assert open_charge["status"] == "canceled"
    assert overdue_charge["status"] == "canceled"
    assert paid_charge["status"] == "paid"
    assert any(item["event_type"] == "charges_cleaned" for item in db.student_billing_events.docs)
