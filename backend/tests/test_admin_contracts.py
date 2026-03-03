from datetime import datetime, timedelta, timezone
import re

import pytest

from app.models.student_billing import ContractCancelIn
from app.routes import admin_contracts, student_billing


class UpdateResult:
    def __init__(self, matched_count: int, modified_count: int):
        self.matched_count = matched_count
        self.modified_count = modified_count


class FakeCursor:
    def __init__(self, docs):
        self.docs = [dict(item) for item in docs]
        self._skip = 0
        self._limit = len(self.docs)

    def sort(self, field, direction):
        reverse = int(direction) == -1
        self.docs.sort(key=lambda item: item.get(field), reverse=reverse)
        return self

    def skip(self, amount):
        self._skip = int(amount or 0)
        return self

    def limit(self, amount):
        self._limit = int(amount or 0)
        return self

    async def to_list(self, _limit):
        start = max(self._skip, 0)
        end = start + self._limit
        return self.docs[start:end]


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = [dict(item) for item in (docs or [])]

    def find(self, query, _projection=None):
        return FakeCursor([item for item in self.docs if _matches(item, query)])

    async def count_documents(self, query):
        return sum(1 for item in self.docs if _matches(item, query))

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_one(self, query, update, upsert=False):
        for doc in self.docs:
            if _matches(doc, query):
                for key, value in update.get("$set", {}).items():
                    doc[key] = value
                return UpdateResult(1, 1)
        if upsert:
            base = dict(query)
            for key, value in update.get("$set", {}).items():
                base[key] = value
            self.docs.append(base)
            return UpdateResult(1, 1)
        return UpdateResult(0, 0)


class FakeDb:
    def __init__(self):
        now = datetime(2026, 3, 3, 10, 0, tzinfo=timezone.utc)
        self.student_contracts = FakeCollection(
            [
                {
                    "contract_id": "ctr_ana_2",
                    "owner_id": "own_1",
                    "gym_id": "gym_1",
                    "student_id": "std_2",
                    "student_name": "Ana Silva",
                    "plan_id": "pln_gold",
                    "plan_name": "Gold",
                    "amount": 220.0,
                    "contract_status": "active",
                    "financial_status": "pending",
                    "access_status": "allowed",
                    "current_period_start": now - timedelta(days=10),
                    "current_period_end": now + timedelta(days=20),
                    "updated_at": now - timedelta(hours=2),
                },
                {
                    "contract_id": "ctr_ana_1",
                    "owner_id": "own_1",
                    "gym_id": "gym_1",
                    "student_id": "std_1",
                    "student_name": "Ana Clara",
                    "plan_id": "pln_basic",
                    "plan_name": "Basico",
                    "amount": 150.0,
                    "contract_status": "canceled",
                    "financial_status": "failed",
                    "access_status": "blocked",
                    "current_period_start": now - timedelta(days=40),
                    "current_period_end": now - timedelta(days=10),
                    "canceled_at": now - timedelta(days=5),
                    "updated_at": now - timedelta(days=5),
                },
                {
                    "contract_id": "ctr_beto",
                    "owner_id": "own_1",
                    "gym_id": "gym_1",
                    "student_id": "std_3",
                    "student_name": "Beto Souza",
                    "plan_id": "pln_basic",
                    "plan_name": "Basico",
                    "amount": 100.0,
                    "contract_status": "active",
                    "financial_status": "paid",
                    "access_status": "allowed",
                    "current_period_start": now - timedelta(days=2),
                    "current_period_end": now + timedelta(days=29),
                    "updated_at": now - timedelta(hours=4),
                },
            ]
        )
        self.student_charges = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "contract_id": "ctr_ana_2",
                    "due_at": now + timedelta(days=5),
                    "status": "open",
                }
            ]
        )
        self.contract_audit = FakeCollection([])


def _matches(doc, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(doc, option) for option in expected):
                return False
            continue

        value = doc.get(key)
        if isinstance(expected, dict):
            regex = expected.get("$regex")
            if regex is not None:
                flags = re.IGNORECASE if str(expected.get("$options") or "").lower() == "i" else 0
                if not re.search(regex, str(value or ""), flags):
                    return False
                continue
            if "$in" in expected and value not in expected["$in"]:
                return False
            if "$gte" in expected and not (value is not None and value >= expected["$gte"]):
                return False
            if "$lte" in expected and not (value is not None and value <= expected["$lte"]):
                return False
            continue

        if value != expected:
            return False
    return True


@pytest.mark.asyncio
async def test_admin_contracts_list_filters_and_sorts(monkeypatch):
    db = FakeDb()
    actor = {"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER", "actor_type": "owner"}

    monkeypatch.setattr(admin_contracts, "get_db", lambda: db)

    async def _refresh_identity(_db, item):
        return item, [], False

    monkeypatch.setattr(student_billing, "refresh_contract_state", _refresh_identity)
    monkeypatch.setattr(student_billing, "_sanitize_contract_for_role", lambda item, role: item)

    result = await admin_contracts.list_admin_contracts(
        page=1,
        page_size=20,
        q="ana",
        sort_by="value",
        sort_dir="desc",
        status=["active", "canceled"],
        plano_id=[],
        start_date_raw=None,
        end_date_raw=None,
        expiring_in_days=None,
        pending_only=False,
        actor=actor,
    )

    assert [item["contract_id"] for item in result["data"]] == ["ctr_ana_2", "ctr_ana_1"]
    assert result["meta"]["total"] == 2
    assert "totalsByStatus" in result["meta"]
    assert "expiringSoonCount" in result["meta"]


@pytest.mark.asyncio
async def test_admin_contract_cancel_records_audit(monkeypatch):
    db = FakeDb()
    actor = {"owner_id": "own_1", "gym_id": "gym_1", "role": "MANAGER", "actor_type": "employee", "employee_id": "emp_1"}

    monkeypatch.setattr(admin_contracts, "get_db", lambda: db)

    before_contract = {
        "contract_id": "ctr_ana_2",
        "student_id": "std_2",
        "student_name": "Ana Silva",
        "plan_id": "pln_gold",
        "plan_name": "Gold",
        "amount": 220.0,
        "contract_status": "active",
        "financial_status": "pending",
        "access_status": "allowed",
        "current_period_start": datetime(2026, 2, 20, tzinfo=timezone.utc),
        "current_period_end": datetime(2026, 3, 22, tzinfo=timezone.utc),
        "updated_at": datetime(2026, 3, 3, 8, 0, tzinfo=timezone.utc),
    }

    after_contract = {
        **before_contract,
        "contract_status": "canceled",
        "access_status": "blocked",
        "updated_at": datetime(2026, 3, 3, 10, 0, tzinfo=timezone.utc),
    }

    async def _load_contract(contract_id, _actor, refresh=True):
        assert contract_id == "ctr_ana_2"
        return before_contract

    async def _cancel_contract(contract_id, payload, actor):
        assert contract_id == "ctr_ana_2"
        assert payload.mode == "immediate"
        assert actor["owner_id"] == "own_1"
        return after_contract

    monkeypatch.setattr(student_billing, "_load_contract_for_owner", _load_contract)
    monkeypatch.setattr(student_billing, "cancel_contract", _cancel_contract)

    result = await admin_contracts.cancel_admin_contract(
        contract_id="ctr_ana_2",
        payload=ContractCancelIn(mode="immediate", reason="teste"),
        actor=actor,
    )

    assert result["contract"]["contract_status"] == "canceled"
    assert result["audit_id"].startswith("ca_")
    assert len(db.contract_audit.docs) == 1
    assert db.contract_audit.docs[0]["action"] == "cancel"
    assert db.contract_audit.docs[0]["before"]["contract_status"] == "active"
    assert db.contract_audit.docs[0]["after"]["contract_status"] == "canceled"
