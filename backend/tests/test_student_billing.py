from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.core.deps import require_roles
from app.models.student_billing import (
    ChargeCleanupIn,
    ChargeMarkPaidIn,
    ChargeMarkUnpaidIn,
    ContractCreateIn,
)
from app.routes import student_billing
from app.services.student_contracts import refresh_contract_state


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
        self.student_billing_reconcile_runs = FakeCollection([])


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
    start_at = datetime.now(timezone.utc) + timedelta(days=30)
    payload = ContractCreateIn(student_id="std_1", plan_id="pln_1", start_at=start_at)

    result = await student_billing.create_contract(payload=payload, actor=actor)
    contract = result["contract"]
    charge = result["initial_charge"]
    updated_student = await db.students.find_one({"owner_id": "own_1", "student_id": "std_1"})

    assert contract["plan_name"] == "Mensal"
    assert contract["status"] == "active"
    assert contract["manual_end_override"] is False
    assert contract["dunning_level"] == 0
    assert contract["grace_until"] is None
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
    refreshed, _, _ = await refresh_contract_state(db, contract)

    assert contract["manual_end_override"] is True
    assert contract["current_period_end"] == manual_end
    assert refreshed["current_period_end"] == manual_end
    assert len(refreshed.get("manual_overrides") or []) >= 1


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
async def test_mark_charge_unpaid_reverts_paid_charge_and_contract_status(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    now = datetime.now(timezone.utc)
    contract = {
        "contract_id": "ctr_unpay",
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
        "current_period_end": now + timedelta(days=10),
        "contract_status": "active",
        "financial_status": "paid",
        "access_status": "allowed",
        "status": "active",
        "auto_renew": False,
        "notes": None,
        "canceled_at": None,
        "last_payment_at": now - timedelta(days=1),
        "last_charge_id": "chg_paid_unpay",
        "created_at": now - timedelta(days=20),
        "updated_at": now - timedelta(days=1),
    }
    db.student_contracts.docs.append(contract)
    db.student_charges.docs.append(
        {
            "charge_id": "chg_paid_unpay",
            "contract_id": "ctr_unpay",
            "owner_id": "own_1",
            "gym_id": "gym_1",
            "student_id": "std_1",
            "amount": 149.9,
            "currency": "BRL",
            "due_at": now - timedelta(days=5),
            "status": "paid",
            "paid_at": now - timedelta(days=1),
            "payment_method": "pix",
            "amount_received": 149.9,
            "external_reference": None,
            "notes": None,
            "period_start": now - timedelta(days=20),
            "period_end": now + timedelta(days=10),
            "created_at": now - timedelta(days=5),
            "updated_at": now - timedelta(days=1),
        }
    )

    actor = {"owner_id": "own_1", "gym_id": "gym_1", "role": "MANAGER"}
    updated_charge = await student_billing.mark_charge_unpaid(
        charge_id="chg_paid_unpay",
        payload=ChargeMarkUnpaidIn(reason="teste"),
        actor=actor,
    )

    updated_contract = await db.student_contracts.find_one(
        {"owner_id": "own_1", "contract_id": "ctr_unpay"}
    )
    updated_student = await db.students.find_one({"owner_id": "own_1", "student_id": "std_1"})

    assert updated_charge["status"] == "overdue"
    assert updated_charge["paid_at"] is None
    assert updated_contract["financial_status"] == "overdue"
    assert updated_contract["status"] == "past_due"
    assert updated_student["status"] == "inativo"
    assert updated_student["auto_status_source"] == "financeiro_inadimplente"
    assert any(item["event_type"] == "charge_payment_reverted" for item in db.student_billing_events.docs)


@pytest.mark.asyncio
async def test_sync_projection_auto_inactivates_student_on_financial_block(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)
    now = datetime.now(timezone.utc)

    contract = {
        "owner_id": "own_1",
        "student_id": "std_1",
        "plan_id": "pln_1",
        "current_period_end": now + timedelta(days=7),
        "contract_status": "active",
        "financial_status": "overdue",
        "access_status": "blocked",
        "grace_until": None,
        "next_retry_at": None,
        "dunning_level": 1,
    }

    await student_billing._sync_student_contract_projection(contract)
    updated_student = await db.students.find_one({"owner_id": "own_1", "student_id": "std_1"})

    assert updated_student["status"] == "inativo"
    assert updated_student["auto_status_source"] == "financeiro_inadimplente"
    assert updated_student["contract_access_status"] == "blocked"
    assert updated_student["contract_financial_status"] == "overdue"


@pytest.mark.asyncio
async def test_sync_projection_reactivates_only_financial_auto_inactive(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)
    now = datetime.now(timezone.utc)

    db.students.docs[0]["status"] = "inativo"
    db.students.docs[0]["auto_status_source"] = "financeiro_inadimplente"

    paid_contract = {
        "owner_id": "own_1",
        "student_id": "std_1",
        "plan_id": "pln_1",
        "current_period_end": now + timedelta(days=30),
        "contract_status": "active",
        "financial_status": "paid",
        "access_status": "allowed",
        "grace_until": None,
        "next_retry_at": None,
        "dunning_level": 0,
    }

    await student_billing._sync_student_contract_projection(paid_contract)
    updated_student = await db.students.find_one({"owner_id": "own_1", "student_id": "std_1"})
    assert updated_student["status"] == "ativo"
    assert updated_student.get("auto_status_source") is None

    db.students.docs[0]["status"] = "inativo"
    db.students.docs[0]["auto_status_source"] = None

    await student_billing._sync_student_contract_projection(paid_contract)
    manually_inactive = await db.students.find_one({"owner_id": "own_1", "student_id": "std_1"})
    assert manually_inactive["status"] == "inativo"
    assert manually_inactive.get("auto_status_source") is None


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


@pytest.mark.asyncio
async def test_reconcile_marks_overdue_and_starts_grace(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    now = datetime.now(timezone.utc)
    contract = {
        "contract_id": "ctr_reconcile_1",
        "owner_id": "own_1",
        "gym_id": "gym_1",
        "student_id": "std_1",
        "student_name": "Aluno Teste",
        "plan_id": "pln_1",
        "plan_name": "Mensal",
        "amount": 149.9,
        "currency": "BRL",
        "duration_days": 30,
        "billing_cycle": "monthly",
        "billing_day": 1,
        "manual_end_override": False,
        "current_period_start": now - timedelta(days=15),
        "current_period_end": now + timedelta(days=15),
        "next_billing_at": now - timedelta(days=1),
        "contract_status": "active",
        "financial_status": "pending",
        "access_status": "allowed",
        "status": "active",
        "auto_renew": True,
        "grace_until": None,
        "dunning_level": 0,
        "next_retry_at": None,
        "manual_overrides": [],
        "scheduled_actions": [],
        "freeze_periods": [],
        "created_at": now - timedelta(days=20),
        "updated_at": now - timedelta(days=1),
    }
    db.student_contracts.docs.append(contract)
    db.student_charges.docs.append(
        {
            "charge_id": "chg_reconcile_open",
            "contract_id": "ctr_reconcile_1",
            "owner_id": "own_1",
            "gym_id": "gym_1",
            "student_id": "std_1",
            "amount": 149.9,
            "currency": "BRL",
            "due_at": now - timedelta(days=1),
            "status": "open",
            "retry_count": 0,
            "created_at": now - timedelta(days=2),
            "updated_at": now - timedelta(days=2),
        }
    )

    actor = {"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"}
    result = await student_billing.run_reconcile(limit=500, actor=actor)
    summary = result["summary"]

    refreshed_contract = await db.student_contracts.find_one(
        {"owner_id": "own_1", "contract_id": "ctr_reconcile_1"}
    )
    refreshed_charge = await db.student_charges.find_one(
        {"owner_id": "own_1", "charge_id": "chg_reconcile_open"}
    )

    assert summary["charge_overdue_marked"] == 1
    assert result.get("run_id")
    assert result.get("history_persisted") is True
    assert refreshed_charge["status"] == "overdue"
    assert refreshed_contract["financial_status"] == "overdue"
    assert refreshed_contract["status"] == "past_due"
    assert refreshed_contract["access_status"] == "grace_period"
    assert refreshed_contract["grace_until"] is not None
    assert int(refreshed_contract.get("dunning_level") or 0) >= 1
    assert len(db.student_billing_reconcile_runs.docs) == 1
    assert db.student_billing_reconcile_runs.docs[0]["owner_id"] == "own_1"
    assert db.student_billing_reconcile_runs.docs[0]["summary"]["charge_overdue_marked"] == 1


@pytest.mark.asyncio
async def test_reconcile_blocks_access_after_grace_expiration(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    now = datetime.now(timezone.utc)
    expired_grace = now - timedelta(days=1)
    contract = {
        "contract_id": "ctr_reconcile_2",
        "owner_id": "own_1",
        "gym_id": "gym_1",
        "student_id": "std_1",
        "student_name": "Aluno Teste",
        "plan_id": "pln_1",
        "plan_name": "Mensal",
        "amount": 149.9,
        "currency": "BRL",
        "duration_days": 30,
        "billing_cycle": "monthly",
        "billing_day": 1,
        "manual_end_override": False,
        "current_period_start": now - timedelta(days=10),
        "current_period_end": now + timedelta(days=20),
        "next_billing_at": now - timedelta(days=10),
        "contract_status": "active",
        "financial_status": "overdue",
        "access_status": "grace_period",
        "status": "past_due",
        "auto_renew": False,
        "grace_until": expired_grace,
        "dunning_level": 1,
        "next_retry_at": now - timedelta(days=1),
        "manual_overrides": [],
        "scheduled_actions": [],
        "freeze_periods": [],
        "created_at": now - timedelta(days=50),
        "updated_at": now - timedelta(days=2),
    }
    db.student_contracts.docs.append(contract)
    db.student_charges.docs.append(
        {
            "charge_id": "chg_reconcile_overdue",
            "contract_id": "ctr_reconcile_2",
            "owner_id": "own_1",
            "gym_id": "gym_1",
            "student_id": "std_1",
            "amount": 149.9,
            "currency": "BRL",
            "due_at": now - timedelta(days=10),
            "status": "overdue",
            "created_at": now - timedelta(days=10),
            "updated_at": now - timedelta(days=10),
        }
    )

    actor = {"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"}
    result = await student_billing.run_reconcile(limit=500, actor=actor)

    refreshed_contract = await db.student_contracts.find_one(
        {"owner_id": "own_1", "contract_id": "ctr_reconcile_2"}
    )
    assert refreshed_contract["access_status"] == "blocked"
    assert refreshed_contract["status"] == "past_due"
    assert result["summary"]["grace_expired_access_blocked"] >= 1


@pytest.mark.asyncio
async def test_reconcile_requires_owner_or_manager_role():
    dep = require_roles("OWNER", "MANAGER")
    with pytest.raises(HTTPException) as exc:
        await dep({"actor_type": "employee", "role": "RECEPTION", "owner_id": "own_1"})
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_list_reconcile_runs_is_owner_scoped_and_sorted(monkeypatch):
    db = FakeDb()
    now = datetime.now(timezone.utc)
    db.student_billing_reconcile_runs.docs.extend(
        [
            {
                "run_id": "sbr_old",
                "owner_id": "own_1",
                "gym_id": "gym_1",
                "actor_type": "employee",
                "actor_role": "MANAGER",
                "actor_id": "emp_1",
                "limit": 100,
                "summary": {
                    "limit": 100,
                    "open_charges_scanned": 3,
                    "charge_overdue_marked": 1,
                    "contracts_processed": 2,
                    "contracts_updated": 1,
                    "dunning_step_advanced": 1,
                    "grace_started": 1,
                    "grace_expired_access_blocked": 0,
                },
                "history_persisted": True,
                "started_at": now - timedelta(minutes=10),
                "finished_at": now - timedelta(minutes=10) + timedelta(seconds=2),
                "duration_ms": 2000,
            },
            {
                "run_id": "sbr_new",
                "owner_id": "own_1",
                "gym_id": "gym_1",
                "actor_type": "employee",
                "actor_role": "OWNER",
                "actor_id": "own_1",
                "limit": 100,
                "summary": {
                    "limit": 100,
                    "open_charges_scanned": 8,
                    "charge_overdue_marked": 4,
                    "contracts_processed": 4,
                    "contracts_updated": 3,
                    "dunning_step_advanced": 2,
                    "grace_started": 1,
                    "grace_expired_access_blocked": 1,
                },
                "history_persisted": True,
                "started_at": now - timedelta(minutes=1),
                "finished_at": now - timedelta(minutes=1) + timedelta(seconds=3),
                "duration_ms": 3000,
            },
            {
                "run_id": "sbr_other_owner",
                "owner_id": "own_2",
                "gym_id": "gym_2",
                "actor_type": "employee",
                "actor_role": "OWNER",
                "actor_id": "own_2",
                "limit": 100,
                "summary": {
                    "limit": 100,
                    "open_charges_scanned": 1,
                    "charge_overdue_marked": 1,
                    "contracts_processed": 1,
                    "contracts_updated": 1,
                    "dunning_step_advanced": 1,
                    "grace_started": 0,
                    "grace_expired_access_blocked": 0,
                },
                "history_persisted": True,
                "started_at": now,
                "finished_at": now + timedelta(seconds=1),
                "duration_ms": 1000,
            },
        ]
    )
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    actor = {"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"}
    result = await student_billing.list_reconcile_runs(limit=10, actor=actor)

    assert len(result) == 2
    assert result[0]["run_id"] == "sbr_new"
    assert result[1]["run_id"] == "sbr_old"
    assert all(item["owner_id"] == "own_1" for item in result)


@pytest.mark.asyncio
async def test_contract_detail_redacts_internal_fields_for_reception(monkeypatch):
    db = FakeDb()
    now = datetime.now(timezone.utc)
    db.student_contracts.docs.append(
        {
            "contract_id": "ctr_detail",
            "owner_id": "own_1",
            "gym_id": "gym_1",
            "student_id": "std_1",
            "student_name": "Aluno Teste",
            "plan_id": "pln_1",
            "plan_name": "Mensal",
            "amount": 149.9,
            "currency": "BRL",
            "duration_days": 30,
            "billing_cycle": "monthly",
            "billing_day": 1,
            "manual_end_override": False,
            "current_period_start": now - timedelta(days=5),
            "current_period_end": now + timedelta(days=25),
            "next_billing_at": now + timedelta(days=25),
            "contract_status": "active",
            "financial_status": "pending",
            "access_status": "allowed",
            "status": "active",
            "auto_renew": True,
            "notes": "visivel",
            "internal_notes": "segredo interno",
            "manual_overrides": [{"field": "amount", "before": 100, "after": 149.9}],
            "scheduled_actions": [],
            "freeze_periods": [],
            "created_at": now - timedelta(days=5),
            "updated_at": now - timedelta(days=1),
        }
    )
    db.student_billing_events.docs.append(
        {
            "event_id": "evt_detail_1",
            "owner_id": "own_1",
            "gym_id": "gym_1",
            "contract_id": "ctr_detail",
            "event_type": "contract_updated",
            "actor_id": "emp_secret",
            "created_at": now,
        }
    )
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    reception_actor = {"owner_id": "own_1", "gym_id": "gym_1", "role": "RECEPTION"}
    reception_detail = await student_billing.get_contract_detail(
        contract_id="ctr_detail",
        actor=reception_actor,
    )

    assert "internal_notes" not in reception_detail["contract"]
    assert "manual_overrides" not in reception_detail["contract"]
    assert "actor_id" not in reception_detail["events"][0]

    manager_actor = {"owner_id": "own_1", "gym_id": "gym_1", "role": "MANAGER"}
    manager_detail = await student_billing.get_contract_detail(
        contract_id="ctr_detail",
        actor=manager_actor,
    )
    assert manager_detail["contract"]["internal_notes"] == "segredo interno"
    assert manager_detail["events"][0]["actor_id"] == "emp_secret"
