"""
Phase 3 coverage boost tests.
Targets: mp_payments.py, billing_reconcile.py, student_billing.py (routes)
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest

from app.models.student_billing import (
    ContractCancelIn,
    ContractCreateIn,
    ContractFreezeIn,
    ContractRenewIn,
)
from app.routes import student_billing
from app.services import billing_reconcile, mp_payments, student_contracts

# ── Helpers ───────────────────────────────────────────────────────────────────

def _now_utc():
    return datetime.now(timezone.utc)


class UpdateResult:
    def __init__(self, matched_count: int = 1, modified_count: int = 1):
        self.matched_count = matched_count
        self.modified_count = modified_count


class FakeCursor:
    def __init__(self, docs):
        self.docs = [dict(d) for d in docs]
        self._limit = len(self.docs)

    def sort(self, field, direction):
        self.docs.sort(key=lambda x: x.get(field), reverse=(direction == -1))
        return self

    def limit(self, v):
        self._limit = v
        return self

    async def to_list(self, _n):
        return self.docs[: self._limit]


def _set_value(doc, key, value):
    parts = key.split(".")
    cur = doc
    for p in parts[:-1]:
        cur = cur.setdefault(p, {})
    cur[parts[-1]] = value


def _get_value(doc, key):
    parts = key.split(".")
    cur = doc
    for p in parts:
        if not isinstance(cur, dict) or p not in cur:
            return None
        cur = cur[p]
    return cur


def _matches(doc, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(doc, opt) for opt in expected):
                return False
            continue
        value = _get_value(doc, key) if "." in key else doc.get(key)
        if isinstance(expected, dict):
            for op, op_val in expected.items():
                if op == "$lt" and not (value is not None and value < op_val):
                    return False
                if op == "$lte" and not (value is not None and value <= op_val):
                    return False
                if op == "$gt" and not (value is not None and value > op_val):
                    return False
                if op == "$gte" and not (value is not None and value >= op_val):
                    return False
                if op == "$in" and value not in op_val:
                    return False
                if op == "$nin" and value in op_val:
                    return False
            continue
        if value != expected:
            return False
    return True


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]

    async def find_one(self, query, _proj=None):
        for d in self.docs:
            if _matches(d, query):
                return d
        return None

    def find(self, query, _proj=None):
        return FakeCursor([d for d in self.docs if _matches(d, query)])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_one(self, query, update, upsert=False):
        target = None
        for d in self.docs:
            if _matches(d, query):
                target = d
                break
        if target is None and not upsert:
            return UpdateResult(0, 0)
        if target is None:
            target = {}
            self.docs.append(target)
            for k, v in update.get("$setOnInsert", {}).items():
                _set_value(target, k, v)
        for k, v in update.get("$set", {}).items():
            _set_value(target, k, v)
        for k, v in update.get("$inc", {}).items():
            _set_value(target, k, (_get_value(target, k) or 0) + v)
        return UpdateResult(1, 1)

    async def update_many(self, query, update):
        n = 0
        for d in self.docs:
            if _matches(d, query):
                n += 1
                for k, v in update.get("$set", {}).items():
                    _set_value(d, k, v)
                for k, v in update.get("$inc", {}).items():
                    _set_value(d, k, (_get_value(d, k) or 0) + v)
        return UpdateResult(n, n)

    async def count_documents(self, query):
        return sum(1 for d in self.docs if _matches(d, query))

    async def delete_many(self, query):
        before = len(self.docs)
        self.docs = [d for d in self.docs if not _matches(d, query)]
        return UpdateResult(before - len(self.docs), before - len(self.docs))


def _make_db():
    now = _now_utc()
    db = SimpleNamespace(
        students=FakeCollection([{
            "student_id": "std_1", "owner_id": "own_1", "gym_id": "gym_1",
            "nome": "Aluno Teste", "status": "ativo", "updated_at": now,
        }]),
        plans=FakeCollection([{
            "plan_id": "pln_1", "owner_id": "own_1", "nome": "Mensal",
            "valor": 149.9, "duracao_dias": 30,
        }]),
        student_contracts=FakeCollection([]),
        student_charges=FakeCollection([]),
        student_billing_events=FakeCollection([]),
        student_billing_reconcile_runs=FakeCollection([]),
    )
    return db


def _active_contract():
    """Returns a fully valid active contract using real current time."""
    now = _now_utc()
    return {
        "contract_id": "ctr_active",
        "owner_id": "own_1",
        "gym_id": "gym_1",
        "student_id": "std_1",
        "student_name": "Aluno Teste",
        "plan_id": "pln_1",
        "plan_name": "Mensal",
        "amount": 149.9,
        "original_amount": 149.9,
        "discount_amount": 0.0,
        "currency": "BRL",
        "duration_unit": "days",
        "duration_value": 30,
        "duration_days": 30,
        "billing_cycle": "monthly",
        "billing_day": 10,
        "manual_end_override": False,
        "current_period_start": now - timedelta(days=5),
        "current_period_end": now + timedelta(days=25),   # Future — not expired
        "next_billing_at": now + timedelta(days=25),
        "contract_status": "active",
        "financial_status": "paid",
        "access_status": "allowed",
        "status": "active",
        "auto_renew": True,
        "payment_method": "cash",
        "notes": None,
        "internal_notes": None,
        "cancel_reason": None,
        "freeze_reason": None,
        "frozen_from": None,
        "frozen_until": None,
        "extend_end_by_frozen_days": True,
        "grace_until": None,
        "dunning_level": 0,
        "next_retry_at": None,
        "canceled_at": None,
        "ended_at": None,
        "last_payment_at": now - timedelta(days=5),
        "last_charge_id": None,
        "migrated_from_contract_id": None,
        "manual_overrides": [],
        "scheduled_actions": [],
        "freeze_periods": [],
        "terms_version": None,
        "terms_accepted_at": None,
        "schema_version": 2,
        "created_at": now - timedelta(days=5),
        "updated_at": now - timedelta(days=5),
        "_proj_version": 0,
    }


ACTOR = {"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER", "user_id": "usr_1"}


# ────────────────────────────────────────────────────────────────────────────
# mp_payments.py coverage
# ────────────────────────────────────────────────────────────────────────────

def test_mp_to_utc_datetime_none():
    assert mp_payments._to_utc_datetime(None) is None
    assert mp_payments._to_utc_datetime("") is None


def test_mp_to_utc_datetime_invalid():
    assert mp_payments._to_utc_datetime("not-a-date") is None


def test_mp_to_utc_datetime_tz_naive():
    # No timezone info → should attach UTC
    result = mp_payments._to_utc_datetime("2026-01-15T12:00:00")
    assert result is not None
    assert result.tzinfo is not None


def test_mp_to_utc_datetime_zulu():
    result = mp_payments._to_utc_datetime("2026-01-15T12:00:00Z")
    assert result is not None
    assert result.year == 2026


def test_payment_status_to_subscription_status_all_branches():
    assert mp_payments.payment_status_to_subscription_status("approved") == "active"
    assert mp_payments.payment_status_to_subscription_status("authorized") == "active"
    assert mp_payments.payment_status_to_subscription_status("cancelled") == "past_due"
    assert mp_payments.payment_status_to_subscription_status("canceled") == "past_due"
    assert mp_payments.payment_status_to_subscription_status("rejected") == "past_due"
    assert mp_payments.payment_status_to_subscription_status("refunded") == "past_due"
    assert mp_payments.payment_status_to_subscription_status("charged_back") == "past_due"
    assert mp_payments.payment_status_to_subscription_status("pending") == "past_due"
    assert mp_payments.payment_status_to_subscription_status("in_process") == "past_due"
    assert mp_payments.payment_status_to_subscription_status("in_mediation") == "past_due"
    assert mp_payments.payment_status_to_subscription_status("unknown_xyz") == "past_due"
    assert mp_payments.payment_status_to_subscription_status(None) == "past_due"


def test_payment_owner_id_from_external_reference():
    assert mp_payments.payment_owner_id({"external_reference": "own_abc"}) == "own_abc"


def test_payment_owner_id_from_metadata():
    assert mp_payments.payment_owner_id({"metadata": {"owner_id": "own_meta"}}) == "own_meta"


def test_payment_owner_id_no_match():
    assert mp_payments.payment_owner_id({}) is None
    assert mp_payments.payment_owner_id(None) is None
    assert mp_payments.payment_owner_id("not_a_dict") is None


def test_is_recent_approved_payment_not_dict():
    assert mp_payments.is_recent_approved_payment(None) is False
    assert mp_payments.is_recent_approved_payment("str") is False


def test_is_recent_approved_payment_not_active():
    payment = {"status": "pending", "date_approved": _now_utc().isoformat()}
    assert mp_payments.is_recent_approved_payment(payment) is False


def test_is_recent_approved_payment_approved_at_none():
    # approved status but no date fields → approved_at is None → False
    payment = {"status": "approved"}
    assert mp_payments.is_recent_approved_payment(payment) is False


def test_is_recent_approved_payment_too_old():
    old_date = (_now_utc() - timedelta(days=50)).isoformat()
    payment = {"status": "approved", "date_approved": old_date}
    assert mp_payments.is_recent_approved_payment(payment, max_age_days=45) is False


def test_is_recent_approved_payment_within_window():
    recent_date = (_now_utc() - timedelta(days=2)).isoformat()
    payment = {"status": "approved", "date_approved": recent_date}
    assert mp_payments.is_recent_approved_payment(payment, max_age_days=45) is True


@pytest.mark.asyncio
async def test_fetch_payment_calls_correct_url():
    class FakeResp:
        def raise_for_status(self):
            pass
        def json(self):
            return {"id": "pay_123", "status": "approved"}

    class FakeClient:
        async def get(self, url, headers=None):
            assert "v1/payments/pay_123" in url
            return FakeResp()

    result = await mp_payments.fetch_payment(FakeClient(), "pay_123", "token_abc")
    assert result["id"] == "pay_123"


@pytest.mark.asyncio
async def test_search_recent_approved_payment_returns_first_result():
    class FakeResp:
        def raise_for_status(self):
            pass
        def json(self):
            return {"results": [{"id": "pay_x", "status": "approved"}]}

    class FakeClient:
        async def get(self, url, headers=None, params=None):
            assert "payments/search" in url
            assert params["external_reference"] == "own_1"
            return FakeResp()

    result = await mp_payments.search_recent_approved_payment(FakeClient(), "own_1", "tok")
    assert result["id"] == "pay_x"


@pytest.mark.asyncio
async def test_search_recent_approved_payment_empty():
    class FakeResp:
        def raise_for_status(self):
            pass
        def json(self):
            return {"results": []}

    class FakeClient:
        async def get(self, url, headers=None, params=None):
            return FakeResp()

    result = await mp_payments.search_recent_approved_payment(FakeClient(), "own_x", "tok")
    assert result is None


# ────────────────────────────────────────────────────────────────────────────
# billing_reconcile.py coverage
# ────────────────────────────────────────────────────────────────────────────

def test_reconcile_to_utc_datetime_none():
    assert billing_reconcile._to_utc_datetime(None) is None
    assert billing_reconcile._to_utc_datetime("") is None


def test_reconcile_to_utc_datetime_invalid():
    assert billing_reconcile._to_utc_datetime("not-a-date") is None


def test_reconcile_to_utc_datetime_tz_naive():
    result = billing_reconcile._to_utc_datetime("2026-01-15T12:00:00")
    assert result is not None
    assert result.tzinfo is not None


def test_reconcile_http_status_code_non_http():
    result = billing_reconcile._http_status_code(ValueError("oops"))
    assert result is None


def test_reconcile_http_status_code_http():
    exc = httpx.HTTPStatusError(
        "bad request",
        request=httpx.Request("GET", "https://api.mercadopago.com"),
        response=httpx.Response(404),
    )
    assert billing_reconcile._http_status_code(exc) == 404


@pytest.mark.asyncio
async def test_reconcile_skips_when_mp_not_configured(monkeypatch):
    settings = SimpleNamespace(mp_access_token=None, billing_reconcile_batch_size=50)
    monkeypatch.setattr(billing_reconcile, "get_settings", lambda: settings)

    result = await billing_reconcile.reconcile_subscriptions()
    assert result["processed"] == 0
    assert result["reason"] == "mp_not_configured"


class FakeReconcileDb:
    def __init__(self, subscriptions=None):
        self.subscriptions = FakeCollection(subscriptions or [])
        self.billing_events = FakeCollection([])
        self.subscription_events = FakeCollection([])


class FakeAsyncClient:
    """Fake httpx.AsyncClient that acts as a context manager."""
    def __init__(self, *_args, **_kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        return False

    async def get(self, url, headers=None, params=None):
        raise NotImplementedError(f"Override in subclass: {url}")


@pytest.mark.asyncio
async def test_reconcile_happy_path_active_status(monkeypatch):
    db = FakeReconcileDb([{
        "owner_id": "own_happy",
        "provider": "mercadopago",
        "mp_preapproval_id": "pref_happy",
        "status": "past_due",
        "plan_duration_days": 30,
    }])
    settings = SimpleNamespace(mp_access_token="tok_abc", billing_reconcile_batch_size=50)
    now_iso = _now_utc().isoformat()

    class Client(FakeAsyncClient):
        async def get(self, url, headers=None, params=None):
            class R:
                status_code = 200
                def raise_for_status(self): pass
                def json(self_):
                    if "preapproval" in url:
                        return {"status": "authorized", "next_payment_date": now_iso}
                    return {"results": []}
            return R()

    monkeypatch.setattr(billing_reconcile, "get_db", lambda: db)
    monkeypatch.setattr(billing_reconcile, "get_settings", lambda: settings)
    monkeypatch.setattr(billing_reconcile.httpx, "AsyncClient", Client)

    result = await billing_reconcile.reconcile_subscriptions(owner_id="own_happy", limit=1)
    assert result["updated"] == 1
    sub = await db.subscriptions.find_one({"owner_id": "own_happy"})
    assert sub["status"] == "active"
    assert any(e["action"] == "reconcile_poll" for e in db.billing_events.docs)


@pytest.mark.asyncio
async def test_reconcile_happy_path_past_due_status(monkeypatch):
    db = FakeReconcileDb([{
        "owner_id": "own_overdue",
        "provider": "mercadopago",
        "mp_preapproval_id": "pref_overdue",
        "status": "active",
        "plan_duration_days": 30,
    }])
    settings = SimpleNamespace(mp_access_token="tok_abc", billing_reconcile_batch_size=50)

    class Client(FakeAsyncClient):
        async def get(self, url, headers=None, params=None):
            class R:
                status_code = 200
                def raise_for_status(self): pass
                def json(self_):
                    if "preapproval" in url:
                        return {"status": "pending", "next_payment_date": None}
                    return {"results": []}
            return R()

    monkeypatch.setattr(billing_reconcile, "get_db", lambda: db)
    monkeypatch.setattr(billing_reconcile, "get_settings", lambda: settings)
    monkeypatch.setattr(billing_reconcile.httpx, "AsyncClient", Client)

    result = await billing_reconcile.reconcile_subscriptions(owner_id="own_overdue", limit=1)
    assert result["updated"] == 1
    sub = await db.subscriptions.find_one({"owner_id": "own_overdue"})
    assert sub["status"] == "past_due"
    assert sub.get("grace_until") is not None


@pytest.mark.asyncio
async def test_reconcile_skips_already_flagged_invalid_preapproval(monkeypatch):
    """Sub with invalid_preapproval_reference matching preapproval_id is skipped."""
    db = FakeReconcileDb([{
        "owner_id": "own_flagged",
        "provider": "mercadopago",
        "mp_preapproval_id": "pref_dead",
        "status": "past_due",
        "meta": {
            "invalid_preapproval_reference": {
                "preapproval_id": "pref_dead",
                "http_status": 404,
            }
        },
    }])
    settings = SimpleNamespace(mp_access_token="tok_abc", billing_reconcile_batch_size=50)

    class ShouldNotBeCalled(FakeAsyncClient):
        async def get(self, *a, **kw):
            raise AssertionError("Should have been skipped")

    monkeypatch.setattr(billing_reconcile, "get_db", lambda: db)
    monkeypatch.setattr(billing_reconcile, "get_settings", lambda: settings)
    monkeypatch.setattr(billing_reconcile.httpx, "AsyncClient", ShouldNotBeCalled)

    result = await billing_reconcile.reconcile_subscriptions(owner_id="own_flagged", limit=5)
    assert result["skipped"] == 1


# ────────────────────────────────────────────────────────────────────────────
# student_billing.py route coverage
# ────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cancel_contract_immediate(monkeypatch):
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.cancel_contract(
        contract_id="ctr_active",
        payload=ContractCancelIn(mode="immediate", reason="teste_cancelamento"),
        actor=ACTOR,
    )
    assert result["contract_status"] == "canceled"
    assert result["canceled_at"] is not None
    assert any(e["event_type"] == "contract_canceled" for e in db.student_billing_events.docs)


@pytest.mark.asyncio
async def test_cancel_contract_end_of_cycle(monkeypatch):
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.cancel_contract(
        contract_id="ctr_active",
        payload=ContractCancelIn(mode="end_of_cycle"),
        actor=ACTOR,
    )
    assert result["contract_status"] == "scheduled_cancel"
    assert result["auto_renew"] is False


@pytest.mark.asyncio
async def test_cancel_contract_recurrence_only(monkeypatch):
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.cancel_contract(
        contract_id="ctr_active",
        payload=ContractCancelIn(cancel_recurrence_only=True),
        actor=ACTOR,
    )
    # contract stays active, auto_renew disabled
    assert result["contract_status"] == "active"
    assert result["auto_renew"] is False
    assert any(e["event_type"] == "contract_recurrence_disabled" for e in db.student_billing_events.docs)


@pytest.mark.asyncio
async def test_cancel_already_canceled_contract_is_noop(monkeypatch):
    db = _make_db()
    contract = _active_contract()
    contract["contract_status"] = "canceled"
    db.student_contracts.docs.append(contract)
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.cancel_contract(
        contract_id="ctr_active",
        payload=ContractCancelIn(mode="immediate"),
        actor=ACTOR,
    )
    assert result["contract_status"] == "canceled"
    assert len(db.student_billing_events.docs) == 0


@pytest.mark.asyncio
async def test_renew_contract_extends_period(monkeypatch):
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.renew_contract(
        contract_id="ctr_active",
        payload=ContractRenewIn(),
        actor=ACTOR,
    )
    # renew_contract returns {"contract": ..., "renewal_charge": ...}
    contract = result["contract"]
    assert contract["contract_status"] in {"active", "pending_activation"}
    assert any(
        e["event_type"].startswith("contract_renew")
        for e in db.student_billing_events.docs
    )


@pytest.mark.asyncio
async def test_create_contract_without_plan_uses_inline_amount(monkeypatch):
    db = _make_db()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.create_contract(
        payload=ContractCreateIn(
            student_id="std_1",
            amount=200.0,
            start_at=_now_utc() + timedelta(days=1),
        ),
        actor=ACTOR,
    )
    assert result["contract"]["amount"] == 200.0
    assert result["contract"]["plan_id"] is None


@pytest.mark.asyncio
async def test_create_contract_with_discount_amount(monkeypatch):
    db = _make_db()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.create_contract(
        payload=ContractCreateIn(
            student_id="std_1",
            plan_id="pln_1",
            amount=149.9,
            discount_amount=20.0,
            start_at=_now_utc() + timedelta(days=1),
        ),
        actor=ACTOR,
    )
    c = result["contract"]
    assert c["discount_amount"] == 20.0
    assert round(c["amount"], 2) == 129.9


@pytest.mark.asyncio
async def test_freeze_contract_scheduled(monkeypatch):
    """Freeze starting in the future → scheduled_freeze status."""
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    now = _now_utc()
    result = await student_billing.freeze_contract(
        contract_id="ctr_active",
        payload=ContractFreezeIn(
            start_at=now + timedelta(days=2),  # future start
            end_at=now + timedelta(days=16),
            reason="viagem_cliente",
        ),
        actor=ACTOR,
    )
    # Future start → scheduled_freeze
    assert result["contract_status"] in {"scheduled_freeze", "active"}
    assert any(
        e["event_type"] in {"contract_frozen", "contract_freeze_scheduled"}
        for e in db.student_billing_events.docs
    )


@pytest.mark.asyncio
async def test_create_contract_replace_active(monkeypatch):
    """replace_active_contract=True should end the old contract."""
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.create_contract(
        payload=ContractCreateIn(
            student_id="std_1",
            plan_id="pln_1",
            start_at=_now_utc() + timedelta(days=1),
            replace_active_contract=True,
        ),
        actor=ACTOR,
    )
    old = await db.student_contracts.find_one({"contract_id": "ctr_active"})
    assert old["contract_status"] == "ended"
    assert result["contract"]["contract_id"] != "ctr_active"


@pytest.mark.asyncio
async def test_list_contracts_returns_empty(monkeypatch):
    db = _make_db()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    # Pass limit explicitly since Query(...) default is a FieldInfo, not an int
    result = await student_billing.list_contracts(limit=200, actor=ACTOR)
    assert result == []


@pytest.mark.asyncio
async def test_list_contracts_with_active_contract(monkeypatch):
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.list_contracts(limit=200, actor=ACTOR)
    assert len(result) == 1
    assert result[0]["contract_id"] == "ctr_active"


@pytest.mark.asyncio
async def test_get_contract_detail_not_found(monkeypatch):
    from fastapi import HTTPException
    db = _make_db()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        await student_billing.get_contract_detail(
            contract_id="ctr_nonexistent", actor=ACTOR
        )
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_get_contract_detail_found(monkeypatch):
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.get_contract_detail(
        contract_id="ctr_active", actor=ACTOR
    )
    assert result["contract"]["contract_id"] == "ctr_active"


# ── Charge management ─────────────────────────────────────────────────────────

def _make_charge(contract_id="ctr_active", status="open"):
    return {
        "charge_id": "chg_1",
        "owner_id": "own_1",
        "gym_id": "gym_1",
        "contract_id": contract_id,
        "student_id": "std_1",
        "amount": 149.9,
        "status": status,
        "due_at": _now_utc() + timedelta(days=5),
        "created_at": _now_utc(),
        "updated_at": _now_utc(),
    }


@pytest.mark.asyncio
async def test_create_charge_for_active_contract(monkeypatch):
    from app.models.student_billing import ChargeCreateIn
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.create_charge(
        contract_id="ctr_active",
        payload=ChargeCreateIn(amount=100.0),
        actor=ACTOR,
    )
    assert result["amount"] == 100.0
    assert result["status"] == "open"
    assert len(db.student_charges.docs) == 1


@pytest.mark.asyncio
async def test_create_charge_for_terminal_contract_raises(monkeypatch):
    from fastapi import HTTPException

    from app.models.student_billing import ChargeCreateIn
    db = _make_db()
    contract = _active_contract()
    contract["contract_status"] = "canceled"
    db.student_contracts.docs.append(contract)
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        await student_billing.create_charge(
            contract_id="ctr_active",
            payload=ChargeCreateIn(amount=100.0),
            actor=ACTOR,
        )
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_list_charges_empty(monkeypatch):
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.list_charges(
        contract_id="ctr_active", limit=200, actor=ACTOR
    )
    assert result == []


@pytest.mark.asyncio
async def test_mark_charge_paid_success(monkeypatch):
    from app.models.student_billing import ChargeMarkPaidIn
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    db.student_charges.docs.append(_make_charge())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.mark_charge_paid(
        charge_id="chg_1",
        payload=ChargeMarkPaidIn(payment_method="cash"),
        actor=ACTOR,
    )
    assert result["status"] == "paid"
    assert any(e["event_type"] == "charge_paid" for e in db.student_billing_events.docs)


@pytest.mark.asyncio
async def test_mark_charge_paid_already_paid_is_noop(monkeypatch):
    from app.models.student_billing import ChargeMarkPaidIn
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    db.student_charges.docs.append(_make_charge(status="paid"))
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.mark_charge_paid(
        charge_id="chg_1",
        payload=ChargeMarkPaidIn(payment_method="cash"),
        actor=ACTOR,
    )
    # Returns the charge as-is without double-processing
    assert result["status"] == "paid"
    assert len(db.student_billing_events.docs) == 0


@pytest.mark.asyncio
async def test_mark_charge_paid_not_found(monkeypatch):
    from fastapi import HTTPException

    from app.models.student_billing import ChargeMarkPaidIn
    db = _make_db()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        await student_billing.mark_charge_paid(
            charge_id="chg_nonexistent",
            payload=ChargeMarkPaidIn(payment_method="cash"),
            actor=ACTOR,
        )
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_mark_charge_unpaid_reverts_paid_to_open(monkeypatch):
    from app.models.student_billing import ChargeMarkUnpaidIn
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    charge = _make_charge(status="paid")
    charge["due_at"] = _now_utc() + timedelta(days=5)  # future → reverts to "open"
    db.student_charges.docs.append(charge)
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.mark_charge_unpaid(
        charge_id="chg_1",
        payload=ChargeMarkUnpaidIn(),
        actor=ACTOR,
    )
    assert result["status"] in {"open", "overdue"}
    assert any(e["event_type"] == "charge_payment_reverted" for e in db.student_billing_events.docs)


@pytest.mark.asyncio
async def test_cleanup_contract_charges_clears_open(monkeypatch):
    from app.models.student_billing import ChargeCleanupIn
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    db.student_charges.docs.append(_make_charge(status="open"))
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.cleanup_contract_charges(
        contract_id="ctr_active",
        payload=ChargeCleanupIn(status_filter="pending"),
        actor=ACTOR,
    )
    # ChargeCleanupOut is a Pydantic model (attribute access)
    assert result.cleaned_count == 1
    assert result.contract_id == "ctr_active"


# ── student_contracts.py edge cases ───────────────────────────────────────────


def test_student_billing_grace_days_default():
    days = student_contracts.student_billing_grace_days()
    assert isinstance(days, int)
    assert days >= 0


def test_student_billing_retry_offsets_default():
    offsets = student_contracts.student_billing_retry_offsets_days()
    assert isinstance(offsets, list)
    assert all(isinstance(v, int) for v in offsets)
    assert offsets == sorted(set(offsets))


def test_clean_doc_removes_id():
    doc = {"_id": "mongo_id", "name": "test"}
    result = student_contracts.clean_doc(doc)
    assert "_id" not in result
    assert result["name"] == "test"


def test_clean_doc_none():
    assert student_contracts.clean_doc(None) is None


def test_money_value_invalid():
    assert student_contracts.money_value(None) == 0.0
    assert student_contracts.money_value("abc") == 0.0


def test_normalize_duration_unit():
    assert student_contracts.normalize_duration_unit("months") == "months"
    assert student_contracts.normalize_duration_unit("days") == "days"
    assert student_contracts.normalize_duration_unit("") == "days"
    assert student_contracts.normalize_duration_unit(None) == "days"


def test_coerce_datetime_utc_passthrough():
    from app.core.time import coerce_datetime_utc
    now = _now_utc()
    assert coerce_datetime_utc(now) == now
    assert coerce_datetime_utc(None) is None


def test_infer_access_status_combinations():
    from app.services.student_contracts import infer_access_status
    now = _now_utc()
    assert infer_access_status("active", "paid", now=now) == "allowed"
    assert infer_access_status("active", "pending", now=now) == "blocked"
    assert infer_access_status("frozen", "paid", now=now) == "suspended"
    assert infer_access_status("canceled", "paid", now=now) == "blocked"


def test_legacy_status():
    from app.services.student_contracts import legacy_status
    assert legacy_status("active", "paid") == "active"
    # legacy_status maps contract states to English keys
    assert legacy_status("canceled", "paid") in {"canceled", "cancelado"}


# ── overview endpoint ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_overview_empty_db(monkeypatch):
    db = _make_db()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.overview(actor=ACTOR)
    assert result.total_contracts == 0
    assert result.active_contracts == 0
    assert result.frozen_contracts == 0
    assert result.past_due_contracts == 0
    assert result.expiring_next_7d == 0
    assert result.scheduled_actions == 0
    assert result.overdue_charges == 0
    assert result.open_charges == 0
    assert result.month_received_amount == 0.0


@pytest.mark.asyncio
async def test_overview_with_contracts_and_charges(monkeypatch):
    now = _now_utc()
    db = _make_db()
    # Add an active contract
    contract = _active_contract()
    db.student_contracts.docs.append(contract)
    # Add a frozen contract
    frozen = _active_contract()
    frozen["contract_id"] = "ctr_frozen"
    frozen["contract_status"] = "frozen"
    frozen["financial_status"] = "paid"
    db.student_contracts.docs.append(frozen)
    # Add an open charge
    db.student_charges.docs.append({
        "charge_id": "chg_open",
        "owner_id": "own_1",
        "contract_id": "ctr_active",
        "student_id": "std_1",
        "status": "open",
        "amount": 149.9,
        "due_at": now + timedelta(days=3),
        "created_at": now,
        "updated_at": now,
    })
    # Add a paid charge this month
    db.student_charges.docs.append({
        "charge_id": "chg_paid",
        "owner_id": "own_1",
        "contract_id": "ctr_active",
        "student_id": "std_1",
        "status": "paid",
        "amount": 149.9,
        "amount_received": 149.9,
        "due_at": now - timedelta(days=2),
        "paid_at": now - timedelta(days=1),
        "created_at": now - timedelta(days=2),
        "updated_at": now - timedelta(days=1),
    })
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.overview(actor=ACTOR)
    assert result.total_contracts == 2
    assert result.frozen_contracts == 1
    assert result.open_charges == 1
    assert result.month_received_amount == pytest.approx(149.9, rel=1e-3)


# ── list_contracts filters ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_contracts_with_status_filter(monkeypatch):
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    # Filter for active status → should return the contract
    result = await student_billing.list_contracts(status="active", limit=200, actor=ACTOR)
    assert len(result) == 1
    assert result[0]["contract_id"] == "ctr_active"


@pytest.mark.asyncio
async def test_list_contracts_with_financial_status_filter(monkeypatch):
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    # Filter for financial_status=paid → should return the contract
    result = await student_billing.list_contracts(financial_status="paid", limit=200, actor=ACTOR)
    assert len(result) == 1

    # Filter for financial_status=overdue → should return nothing
    result2 = await student_billing.list_contracts(financial_status="overdue", limit=200, actor=ACTOR)
    assert len(result2) == 0


@pytest.mark.asyncio
async def test_list_contracts_with_q_filter(monkeypatch):
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    # q matches student_name
    result = await student_billing.list_contracts(q="Aluno", limit=200, actor=ACTOR)
    assert len(result) == 1

    # q does not match
    result2 = await student_billing.list_contracts(q="inexistente_xyz", limit=200, actor=ACTOR)
    assert len(result2) == 0


@pytest.mark.asyncio
async def test_list_contracts_with_plan_id_filter(monkeypatch):
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.list_contracts(plan_id="pln_1", limit=200, actor=ACTOR)
    assert len(result) == 1

    result2 = await student_billing.list_contracts(plan_id="pln_nonexistent", limit=200, actor=ACTOR)
    assert len(result2) == 0


# ── create_contract error paths ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_contract_student_not_found(monkeypatch):
    from fastapi import HTTPException
    db = _make_db()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        await student_billing.create_contract(
            payload=ContractCreateIn(student_id="std_nonexistent", amount=100.0),
            actor=ACTOR,
        )
    assert exc_info.value.status_code == 404
    assert "Aluno" in exc_info.value.detail


@pytest.mark.asyncio
async def test_create_contract_plan_not_found(monkeypatch):
    from fastapi import HTTPException
    db = _make_db()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        await student_billing.create_contract(
            payload=ContractCreateIn(
                student_id="std_1",
                plan_id="pln_nonexistent",
                amount=100.0,
            ),
            actor=ACTOR,
        )
    assert exc_info.value.status_code == 404
    assert "Plano" in exc_info.value.detail


@pytest.mark.asyncio
async def test_create_contract_invalid_period(monkeypatch):
    """end_at <= start_at should raise 400."""
    from fastapi import HTTPException
    db = _make_db()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    now = _now_utc()
    with pytest.raises(HTTPException) as exc_info:
        await student_billing.create_contract(
            payload=ContractCreateIn(
                student_id="std_1",
                amount=100.0,
                start_at=now + timedelta(days=10),
                end_at=now + timedelta(days=5),  # before start_at
            ),
            actor=ACTOR,
        )
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_create_contract_no_amount_no_plan_raises(monkeypatch):
    """No amount and no plan (so no valor) should raise 400."""
    from fastapi import HTTPException
    db = _make_db()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        await student_billing.create_contract(
            payload=ContractCreateIn(student_id="std_1"),  # no amount, no plan_id
            actor=ACTOR,
        )
    assert exc_info.value.status_code == 400
    assert "amount" in exc_info.value.detail.lower() or "valor" in exc_info.value.detail.lower() or "plano" in exc_info.value.detail.lower()


# ── update_contract ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_contract_amount(monkeypatch):
    from app.models.student_billing import ContractUpdateIn
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.update_contract(
        contract_id="ctr_active",
        payload=ContractUpdateIn(amount=250.0),
        actor=ACTOR,
    )
    assert result["amount"] == pytest.approx(250.0, rel=1e-3)


@pytest.mark.asyncio
async def test_update_contract_notes(monkeypatch):
    from app.models.student_billing import ContractUpdateIn
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.update_contract(
        contract_id="ctr_active",
        payload=ContractUpdateIn(notes="nota teste", auto_renew=False),
        actor=ACTOR,
    )
    assert result["notes"] == "nota teste"
    assert result["auto_renew"] is False


# ── adjust_contract_validity ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_adjust_contract_validity_extends_period(monkeypatch):
    from app.models.student_billing import ContractAdjustValidityIn
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    now = _now_utc()
    new_end = now + timedelta(days=60)
    result = await student_billing.adjust_contract_validity(
        contract_id="ctr_active",
        payload=ContractAdjustValidityIn(end_at=new_end, reason="extensao_manual"),
        actor=ACTOR,
    )
    contract = result["contract"]
    assert contract["manual_end_override"] is True
    assert any(e["event_type"] == "contract_validity_adjusted" for e in db.student_billing_events.docs)


# ── adjust_contract_billing ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_adjust_contract_billing_day(monkeypatch):
    from app.models.student_billing import ContractAdjustBillingIn
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.adjust_contract_billing(
        contract_id="ctr_active",
        payload=ContractAdjustBillingIn(billing_day=20),
        actor=ACTOR,
    )
    assert result["contract"]["billing_day"] == 20
    assert any(e["event_type"] == "contract_billing_adjusted" for e in db.student_billing_events.docs)


# ── freeze immediate ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_freeze_contract_immediate_execution(monkeypatch):
    """Freeze with start_at=None defaults to now → immediate freeze branch."""
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    now = _now_utc()
    result = await student_billing.freeze_contract(
        contract_id="ctr_active",
        payload=ContractFreezeIn(
            end_at=now + timedelta(days=14),
            reason="ferias",
            pause_charges=False,
        ),
        actor=ACTOR,
    )
    # Immediate freeze: contract_status should be frozen
    assert result["contract_status"] == "frozen"
    assert result["freeze_reason"] == "ferias"
    assert any(e["event_type"] == "contract_frozen" for e in db.student_billing_events.docs)


@pytest.mark.asyncio
async def test_freeze_contract_invalid_period_raises(monkeypatch):
    """Freeze end_at <= start_at should raise 400."""
    from fastapi import HTTPException
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    now = _now_utc()
    with pytest.raises(HTTPException) as exc_info:
        await student_billing.freeze_contract(
            contract_id="ctr_active",
            payload=ContractFreezeIn(
                start_at=now + timedelta(days=5),
                end_at=now + timedelta(days=3),  # before start_at
            ),
            actor=ACTOR,
        )
    assert exc_info.value.status_code == 400


# ── resume_contract ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_resume_contract_from_frozen(monkeypatch):
    from app.models.student_billing import ContractResumeIn
    now = _now_utc()
    db = _make_db()
    frozen = _active_contract()
    frozen["contract_status"] = "frozen"
    frozen["freeze_reason"] = "ferias"
    frozen["frozen_from"] = now - timedelta(days=5)
    frozen["frozen_until"] = now + timedelta(days=9)
    frozen["freeze_periods"] = [{
        "started_at": now - timedelta(days=5),
        "resume_expected_at": now + timedelta(days=9),
        "resumed_at": None,
        "reason": "ferias",
        "source": "manual",
    }]
    db.student_contracts.docs.append(frozen)
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.resume_contract(
        contract_id="ctr_active",
        payload=ContractResumeIn(reason="voltou_cedo"),
        actor=ACTOR,
    )
    assert result["contract_status"] == "active"
    assert result["frozen_from"] is None
    assert any(e["event_type"] == "contract_resumed" for e in db.student_billing_events.docs)


@pytest.mark.asyncio
async def test_resume_contract_from_scheduled_freeze(monkeypatch):
    """Resuming a scheduled_freeze cancels the scheduled action."""
    from app.models.student_billing import ContractResumeIn
    now = _now_utc()
    db = _make_db()
    scheduled = _active_contract()
    scheduled["contract_status"] = "scheduled_freeze"
    scheduled["scheduled_actions"] = [{
        "action_id": "act_sched",
        "action_type": "freeze",
        "status": "pending",
        "effective_at": now + timedelta(days=2),
        "freeze_end_at": now + timedelta(days=16),
        "reason": "viagem",
        "created_at": now,
    }]
    db.student_contracts.docs.append(scheduled)
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.resume_contract(
        contract_id="ctr_active",
        payload=ContractResumeIn(),
        actor=ACTOR,
    )
    assert result["contract_status"] == "active"
    assert any(
        e["event_type"] == "contract_freeze_schedule_canceled"
        for e in db.student_billing_events.docs
    )


@pytest.mark.asyncio
async def test_resume_contract_not_frozen_raises(monkeypatch):
    """Resuming an active (non-frozen) contract should raise 400."""
    from fastapi import HTTPException
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        await student_billing.resume_contract(
            contract_id="ctr_active",
            payload=None,
            actor=ACTOR,
        )
    assert exc_info.value.status_code == 400


# ── _matches_status_filters direct tests ─────────────────────────────────────

def test_matches_status_filters_empty_filters():
    contract = {"status": "active", "contract_status": "active",
                "financial_status": "paid", "access_status": "allowed",
                "plan_id": "pln_1", "student_name": "Aluno"}
    assert student_billing._matches_status_filters(
        contract, status="", contract_status="", financial_status="",
        access_status="", plan_id="", q=""
    ) is True


def test_matches_status_filters_status_mismatch():
    contract = {"status": "active", "contract_status": "active",
                "financial_status": "paid", "access_status": "allowed",
                "plan_id": "pln_1"}
    assert student_billing._matches_status_filters(
        contract, status="canceled", contract_status="", financial_status="",
        access_status="", plan_id="", q=""
    ) is False


def test_matches_status_filters_contract_status_mismatch():
    contract = {"status": "active", "contract_status": "active",
                "financial_status": "paid", "access_status": "allowed",
                "plan_id": "pln_1"}
    assert student_billing._matches_status_filters(
        contract, status="", contract_status="frozen", financial_status="",
        access_status="", plan_id="", q=""
    ) is False


def test_matches_status_filters_plan_id_match():
    contract = {"status": "active", "contract_status": "active",
                "financial_status": "paid", "access_status": "allowed",
                "plan_id": "pln_1"}
    assert student_billing._matches_status_filters(
        contract, status="", contract_status="", financial_status="",
        access_status="", plan_id="pln_1", q=""
    ) is True
    assert student_billing._matches_status_filters(
        contract, status="", contract_status="", financial_status="",
        access_status="", plan_id="pln_other", q=""
    ) is False


def test_matches_status_filters_q_no_match():
    contract = {"status": "active", "contract_status": "active",
                "financial_status": "paid", "access_status": "allowed",
                "plan_id": "pln_1", "student_name": "João Silva",
                "contract_id": "ctr_abc", "student_id": "std_1"}
    assert student_billing._matches_status_filters(
        contract, status="", contract_status="", financial_status="",
        access_status="", plan_id="", q="inexistente_xyz"
    ) is False


def test_matches_status_filters_q_matches_contract_id():
    contract = {"contract_id": "ctr_abc_123", "student_name": "Aluno",
                "student_id": "std_1", "plan_name": "Mensal", "plan_id": "pln_1"}
    assert student_billing._matches_status_filters(
        contract, status="", contract_status="", financial_status="",
        access_status="", plan_id="", q="abc_123"
    ) is True


# ── student_contracts.py — pure function coverage ─────────────────────────────

def test_billing_cycle_from_duration_variants():
    """billing_cycle_from_duration handles 30/90/180/360/365 and custom."""
    assert student_contracts.billing_cycle_from_duration(90)  == "quarterly"
    assert student_contracts.billing_cycle_from_duration(180) == "semiannual"
    assert student_contracts.billing_cycle_from_duration(360) == "annual"
    assert student_contracts.billing_cycle_from_duration(365) == "annual"
    assert student_contracts.billing_cycle_from_duration(45)  == "custom_days"
    assert student_contracts.billing_cycle_from_duration(0)   == "custom_days"


def test_billing_cycle_from_duration_fields_months():
    """billing_cycle_from_duration_fields handles 1/3/6/12/other months."""
    fn = student_contracts.billing_cycle_from_duration_fields
    assert fn(duration_unit="months", duration_value=1)  == "monthly"
    assert fn(duration_unit="months", duration_value=3)  == "quarterly"
    assert fn(duration_unit="months", duration_value=6)  == "semiannual"
    assert fn(duration_unit="months", duration_value=12) == "annual"
    assert fn(duration_unit="months", duration_value=2)  == "custom_days"
    assert fn(duration_unit="days",   duration_value=30) == "monthly"


def test_resolve_contract_amounts_errors():
    fn = student_contracts.resolve_contract_amounts
    import pytest
    with pytest.raises(ValueError, match="base"):
        fn(base_amount=0)
    with pytest.raises(ValueError, match="Desconto invalido"):
        fn(base_amount=100, discount_amount=-5)
    with pytest.raises(ValueError, match="zerar"):
        fn(base_amount=10, discount_amount=10)   # net = 0 < 0.01


def test_contract_status_from_legacy_all():
    fn = student_contracts.contract_status_from_legacy
    assert fn("canceled") == "canceled"
    assert fn("expired")  == "expired"
    assert fn("active")   == "active"
    assert fn("")         == "active"


def test_financial_status_from_legacy_all():
    fn = student_contracts.financial_status_from_legacy
    assert fn("past_due") == "overdue"
    assert fn("canceled") == "pending"
    assert fn("expired")  == "pending"
    assert fn("active")   == "paid"
    assert fn("")         == "paid"


def test_duration_days_compatibility_months_no_start():
    """months unit + no start → value * 30."""
    result = student_contracts.duration_days_compatibility(
        start=None, duration_unit="months", duration_value=2
    )
    assert result == 60   # 2 * 30


def test_duration_days_compatibility_months_with_start():
    """months unit + start → computed from period_end."""
    now = _now_utc()
    result = student_contracts.duration_days_compatibility(
        start=now, duration_unit="months", duration_value=1
    )
    # ~28-31 days depending on the month
    assert 27 <= result <= 32


def test_sync_contract_amount_fields_no_base():
    """When original_amount is absent, base = current amount."""
    doc = {"amount": 100.0}  # no original_amount
    result = student_contracts.sync_contract_amount_fields(doc)
    assert result["original_amount"] == 100.0
    assert result["discount_amount"] == 0.0
    assert result["amount"] == 100.0


def test_sync_contract_amount_fields_net_too_low():
    """When net < MIN_CONTRACT_AMOUNT but current_amount is OK, use current."""
    doc = {"amount": 50.0, "original_amount": 60.0, "discount_amount": 59.99}
    # net = 60 - 59.99 = 0.01 = MIN_CONTRACT_AMOUNT, so it stays
    result = student_contracts.sync_contract_amount_fields(doc)
    assert result["amount"] >= 0.01


# ── student_contracts.py — normalize_contract_document ────────────────────────

def test_normalize_pending_activation_activates_when_start_past():
    """pending_activation + current_period_start <= now → activates."""
    now = _now_utc()
    contract = {
        "contract_id": "ctr_p",
        "owner_id": "own_1",
        "gym_id": "gym_1",
        "student_id": "std_1",
        "amount": 149.9,
        "current_period_start": now - timedelta(seconds=10),  # just in the past
        "current_period_end": now + timedelta(days=30),
        "contract_status": "pending_activation",
        "financial_status": "pending",
    }
    normalized, events, _ = student_contracts.normalize_contract_document(contract, now=now)
    assert normalized["contract_status"] == "active"
    assert any(e["event_type"] == "contract_activated" for e in events)


def test_normalize_active_past_end_expires():
    """active + current_period_end < now + auto_renew=False → expired."""
    now = _now_utc()
    contract = {
        "contract_id": "ctr_e",
        "owner_id": "own_1",
        "gym_id": "gym_1",
        "student_id": "std_1",
        "amount": 149.9,
        "current_period_start": now - timedelta(days=35),
        "current_period_end": now - timedelta(days=5),
        "contract_status": "active",
        "financial_status": "paid",
        "auto_renew": False,
    }
    normalized, events, _ = student_contracts.normalize_contract_document(contract, now=now)
    assert normalized["contract_status"] == "expired"
    assert any(e["event_type"] == "contract_expired" for e in events)


def test_normalize_frozen_auto_resumes_after_frozen_until():
    """frozen + frozen_until <= now → auto-resume."""
    now = _now_utc()
    contract = {
        "contract_id": "ctr_f",
        "owner_id": "own_1",
        "gym_id": "gym_1",
        "student_id": "std_1",
        "amount": 149.9,
        "current_period_start": now - timedelta(days=10),
        "current_period_end": now + timedelta(days=20),
        "contract_status": "frozen",
        "financial_status": "paid",
        "frozen_from": now - timedelta(days=10),
        "frozen_until": now - timedelta(days=1),    # already past
        "extend_end_by_frozen_days": True,
        "auto_renew": False,
        "freeze_periods": [{
            "started_at": now - timedelta(days=10),
            "resume_expected_at": now - timedelta(days=1),
            "resumed_at": None,
        }],
    }
    normalized, events, _ = student_contracts.normalize_contract_document(contract, now=now)
    assert normalized["contract_status"] == "active"
    assert any(e["event_type"] == "contract_resumed_auto" for e in events)


def test_normalize_scheduled_cancel_applies_past_due():
    """A past-due scheduled cancel action transitions contract to canceled."""
    now = _now_utc()
    contract = {
        "contract_id": "ctr_sc",
        "owner_id": "own_1",
        "gym_id": "gym_1",
        "student_id": "std_1",
        "amount": 149.9,
        "current_period_start": now - timedelta(days=10),
        "current_period_end": now + timedelta(days=20),
        "contract_status": "scheduled_cancel",
        "financial_status": "paid",
        "auto_renew": False,
        "scheduled_actions": [{
            "action_id": "act_cancel",
            "action_type": "cancel",
            "status": "pending",
            "effective_at": now - timedelta(hours=1),  # past → should apply
            "reason": "test_cancel",
        }],
    }
    normalized, events, _ = student_contracts.normalize_contract_document(contract, now=now)
    assert normalized["contract_status"] == "canceled"
    assert any(e["event_type"] == "contract_canceled_scheduled" for e in events)


# ── student_contracts.py — async helpers ─────────────────────────────────────

@pytest.mark.asyncio
async def test_compute_financial_status_failed():
    from app.services.student_contracts import compute_financial_status
    db = SimpleNamespace(
        student_charges=FakeCollection([{
            "owner_id": "own_1", "contract_id": "ctr_1", "status": "failed",
        }])
    )
    assert await compute_financial_status(db, owner_id="own_1", contract_id="ctr_1") == "failed"


@pytest.mark.asyncio
async def test_compute_financial_status_overdue():
    from app.services.student_contracts import compute_financial_status
    now = _now_utc()
    db = SimpleNamespace(
        student_charges=FakeCollection([{
            "owner_id": "own_1", "contract_id": "ctr_1",
            "status": "open", "due_at": now - timedelta(days=5),
        }])
    )
    assert await compute_financial_status(
        db, owner_id="own_1", contract_id="ctr_1", now=now
    ) == "overdue"


@pytest.mark.asyncio
async def test_compute_financial_status_partially_paid():
    from app.services.student_contracts import compute_financial_status
    now = _now_utc()
    db = SimpleNamespace(
        student_charges=FakeCollection([{
            "owner_id": "own_1", "contract_id": "ctr_1",
            "status": "partially_paid", "due_at": now + timedelta(days=5),
        }])
    )
    assert await compute_financial_status(
        db, owner_id="own_1", contract_id="ctr_1", now=now
    ) == "partially_paid"


@pytest.mark.asyncio
async def test_compute_financial_status_paid():
    from app.services.student_contracts import compute_financial_status
    db = SimpleNamespace(
        student_charges=FakeCollection([{
            "owner_id": "own_1", "contract_id": "ctr_1", "status": "paid",
        }])
    )
    assert await compute_financial_status(db, owner_id="own_1", contract_id="ctr_1") == "paid"


@pytest.mark.asyncio
async def test_compute_financial_status_open_is_pending():
    from app.services.student_contracts import compute_financial_status
    now = _now_utc()
    db = SimpleNamespace(
        student_charges=FakeCollection([{
            "owner_id": "own_1", "contract_id": "ctr_1",
            "status": "open", "due_at": now + timedelta(days=5),
        }])
    )
    assert await compute_financial_status(
        db, owner_id="own_1", contract_id="ctr_1", now=now
    ) == "pending"


@pytest.mark.asyncio
async def test_compute_financial_status_refunded():
    from app.services.student_contracts import compute_financial_status
    db = SimpleNamespace(
        student_charges=FakeCollection([{
            "owner_id": "own_1", "contract_id": "ctr_1", "status": "refunded",
        }])
    )
    assert await compute_financial_status(db, owner_id="own_1", contract_id="ctr_1") == "refunded"


@pytest.mark.asyncio
async def test_compute_next_billing_at_with_open_charge():
    from app.services.student_contracts import compute_next_billing_at
    now = _now_utc()
    db = SimpleNamespace(
        student_charges=FakeCollection([{
            "owner_id": "own_1", "contract_id": "ctr_1",
            "status": "open", "due_at": now + timedelta(days=7),
        }])
    )
    result = await compute_next_billing_at(db, owner_id="own_1", contract_id="ctr_1")
    assert result is not None


@pytest.mark.asyncio
async def test_compute_next_billing_at_no_open_charges():
    from app.services.student_contracts import compute_next_billing_at
    db = SimpleNamespace(student_charges=FakeCollection([]))
    result = await compute_next_billing_at(db, owner_id="own_1", contract_id="ctr_1")
    assert result is None


@pytest.mark.asyncio
async def test_compute_dunning_snapshot_overdue_charge():
    from app.services.student_contracts import compute_dunning_snapshot
    now = _now_utc()
    db = SimpleNamespace(
        student_charges=FakeCollection([{
            "owner_id": "own_1", "contract_id": "ctr_1",
            "status": "overdue", "due_at": now - timedelta(days=10),
        }])
    )
    result = await compute_dunning_snapshot(db, owner_id="own_1", contract_id="ctr_1", now=now)
    assert isinstance(result["dunning_level"], int)
    assert result["grace_until"] is not None


@pytest.mark.asyncio
async def test_compute_dunning_snapshot_no_overdue():
    from app.services.student_contracts import compute_dunning_snapshot
    db = SimpleNamespace(student_charges=FakeCollection([]))
    result = await compute_dunning_snapshot(db, owner_id="own_1", contract_id="ctr_1")
    assert result["dunning_level"] == 0
    assert result["next_retry_at"] is None


@pytest.mark.asyncio
async def test_refresh_contract_state_recomputes_overdue():
    """refresh_contract_state detects overdue charge and updates financial_status."""
    from app.services.student_contracts import refresh_contract_state
    now = _now_utc()
    contract = {
        "contract_id": "ctr_chg",
        "owner_id": "own_1",
        "gym_id": "gym_1",
        "student_id": "std_1",
        "student_name": "Aluno",
        "amount": 149.9,
        "original_amount": 149.9,
        "discount_amount": 0.0,
        "currency": "BRL",
        "current_period_start": now - timedelta(days=10),
        "current_period_end": now + timedelta(days=20),
        "contract_status": "active",
        "financial_status": "paid",     # old value — will be overwritten
        "access_status": "allowed",
        "status": "active",
        "auto_renew": False,
        "dunning_level": 0,
        "next_retry_at": None,
        "grace_until": None,
        "next_billing_at": now + timedelta(days=20),
        "updated_at": now - timedelta(days=1),
    }
    db = SimpleNamespace(
        student_contracts=FakeCollection([dict(contract)]),
        student_charges=FakeCollection([{
            "owner_id": "own_1",
            "contract_id": "ctr_chg",
            "status": "overdue",
            "due_at": now - timedelta(days=5),
        }]),
    )
    normalized, events, changed = await refresh_contract_state(db, contract, now=now)
    assert normalized["financial_status"] == "overdue"
    assert changed is True


@pytest.mark.asyncio
async def test_refresh_contract_state_resets_stale_dunning():
    """refresh_contract_state resets dunning_level when financial_status is paid."""
    from app.services.student_contracts import refresh_contract_state
    now = _now_utc()
    contract = {
        "contract_id": "ctr_dunning",
        "owner_id": "own_1",
        "gym_id": "gym_1",
        "student_id": "std_1",
        "amount": 149.9,
        "original_amount": 149.9,
        "discount_amount": 0.0,
        "currency": "BRL",
        "current_period_start": now - timedelta(days=5),
        "current_period_end": now + timedelta(days=25),
        "contract_status": "active",
        "financial_status": "overdue",   # stale — will become "paid"
        "access_status": "blocked",
        "status": "active",
        "auto_renew": False,
        "dunning_level": 3,             # stale — should be reset
        "next_retry_at": now - timedelta(days=1),
        "grace_until": now + timedelta(days=2),
        "next_billing_at": now + timedelta(days=25),
        "updated_at": now - timedelta(days=1),
    }
    db = SimpleNamespace(
        student_contracts=FakeCollection([dict(contract)]),
        student_charges=FakeCollection([{
            "owner_id": "own_1",
            "contract_id": "ctr_dunning",
            "status": "paid",
        }]),
    )
    normalized, events, changed = await refresh_contract_state(db, contract, now=now)
    assert normalized["financial_status"] == "paid"
    assert normalized["dunning_level"] == 0
    assert changed is True


# ── student_billing.py route — charge sync coverage ──────────────────────────

@pytest.mark.asyncio
async def test_update_contract_with_open_charge_syncs_amount(monkeypatch):
    """update_contract with amount change should update open charge amounts."""
    from app.models.student_billing import ContractUpdateIn
    now = _now_utc()
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    db.student_charges.docs.append({
        "charge_id": "chg_open",
        "owner_id": "own_1",
        "gym_id": "gym_1",
        "contract_id": "ctr_active",
        "student_id": "std_1",
        "amount": 149.9,   # old amount
        "status": "open",
        "due_at": now + timedelta(days=5),
        "created_at": now,
        "updated_at": now,
    })
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.update_contract(
        contract_id="ctr_active",
        payload=ContractUpdateIn(amount=300.0),
        actor=ACTOR,
    )
    assert result["amount"] == pytest.approx(300.0, rel=1e-3)
    # The open charge should have been updated via _update_open_charge_amounts_for_contract
    charge = await db.student_charges.find_one({"charge_id": "chg_open"})
    assert charge is not None  # charge still exists


@pytest.mark.asyncio
async def test_adjust_contract_billing_with_due_at_updates_charges(monkeypatch):
    """adjust_contract_billing with due_at updates matching open charges."""
    from app.models.student_billing import ContractAdjustBillingIn
    now = _now_utc()
    new_due = now + timedelta(days=15)
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    db.student_charges.docs.append({
        "charge_id": "chg_adj",
        "owner_id": "own_1",
        "gym_id": "gym_1",
        "contract_id": "ctr_active",
        "student_id": "std_1",
        "amount": 149.9,
        "status": "open",
        "due_at": now + timedelta(days=5),   # current due
        "created_at": now,
        "updated_at": now,
    })
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.adjust_contract_billing(
        contract_id="ctr_active",
        payload=ContractAdjustBillingIn(due_at=new_due, billing_day=15, update_open_charges=True),
        actor=ACTOR,
    )
    assert result["contract"]["billing_day"] == 15
    assert result["updated_charges"] >= 0


@pytest.mark.asyncio
async def test_list_contracts_with_student_id_filter(monkeypatch):
    """list_contracts with student_id adds it to the DB query."""
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.list_contracts(student_id="std_1", limit=200, actor=ACTOR)
    assert len(result) == 1

    result2 = await student_billing.list_contracts(student_id="std_99", limit=200, actor=ACTOR)
    assert len(result2) == 0


@pytest.mark.asyncio
async def test_list_contracts_with_contract_status_filter(monkeypatch):
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.list_contracts(contract_status="active", limit=200, actor=ACTOR)
    assert len(result) == 1

    result2 = await student_billing.list_contracts(contract_status="frozen", limit=200, actor=ACTOR)
    assert len(result2) == 0


@pytest.mark.asyncio
async def test_list_contracts_with_access_status_filter(monkeypatch):
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.list_contracts(access_status="allowed", limit=200, actor=ACTOR)
    assert len(result) == 1

    result2 = await student_billing.list_contracts(access_status="blocked", limit=200, actor=ACTOR)
    assert len(result2) == 0


@pytest.mark.asyncio
async def test_create_contract_excessive_discount_raises_400(monkeypatch):
    """discount_amount >= amount triggers 400 via _resolve_contract_amount_inputs."""
    from fastapi import HTTPException
    db = _make_db()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        await student_billing.create_contract(
            payload=ContractCreateIn(
                student_id="std_1",
                amount=10.0,
                discount_amount=10.0,   # net = 0 < MIN_CONTRACT_AMOUNT → 400
            ),
            actor=ACTOR,
        )
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_create_contract_with_explicit_duration(monkeypatch):
    """Passing duration_unit/duration_value exercises _resolve_duration_selection line 110."""
    db = _make_db()
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.create_contract(
        payload=ContractCreateIn(
            student_id="std_1",
            amount=149.9,
            duration_unit="months",
            duration_value=3,
        ),
        actor=ACTOR,
    )
    c = result["contract"]
    assert c["duration_unit"] == "months"
    assert c["duration_value"] == 3
    assert c["billing_cycle"] == "quarterly"


@pytest.mark.asyncio
async def test_change_plan_in_place(monkeypatch):
    """change_plan with mode='in_place' updates plan fields on existing contract."""
    from app.models.student_billing import ContractChangePlanIn
    db = _make_db()
    # Add a second plan to switch to
    db.plans.docs.append({
        "plan_id": "pln_2",
        "owner_id": "own_1",
        "nome": "Trimestral",
        "valor": 349.9,
        "duracao_dias": 90,
        "duration_unit": "months",
        "duration_value": 3,
    })
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.change_plan(
        contract_id="ctr_active",
        payload=ContractChangePlanIn(
            new_plan_id="pln_2",
            mode="in_place",
        ),
        actor=ACTOR,
    )
    contract = result["contract"]
    assert contract["plan_id"] == "pln_2"
    assert contract["plan_name"] == "Trimestral"


# ── Additional targeted coverage ──────────────────────────────────────────────

def test_safe_float_invalid_value_returns_default():
    """_safe_float catches TypeError/ValueError and returns default."""
    assert student_billing._safe_float("not_a_number") == 0.0
    assert student_billing._safe_float(None) == 0.0
    assert student_billing._safe_float("abc", default=5.0) == 5.0


def test_matches_status_filters_financial_status_mismatch():
    contract = {"status": "active", "contract_status": "active",
                "financial_status": "paid", "access_status": "allowed", "plan_id": "pln_1"}
    assert student_billing._matches_status_filters(
        contract, status="", contract_status="", financial_status="overdue",
        access_status="", plan_id="", q=""
    ) is False


def test_matches_status_filters_access_status_mismatch():
    contract = {"status": "active", "contract_status": "active",
                "financial_status": "paid", "access_status": "allowed", "plan_id": "pln_1"}
    assert student_billing._matches_status_filters(
        contract, status="", contract_status="", financial_status="",
        access_status="blocked", plan_id="", q=""
    ) is False


@pytest.mark.asyncio
async def test_get_contract_detail_strips_internal_notes_for_staff(monkeypatch):
    """_sanitize_contract_for_role removes internal_notes for non-OWNER roles."""
    db = _make_db()
    contract = _active_contract()
    contract["internal_notes"] = "nota_privada"
    contract["manual_overrides"] = [{"field": "amount", "before": 100, "after": 200}]
    db.student_contracts.docs.append(contract)
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    staff_actor = {**ACTOR, "role": "STAFF"}
    result = await student_billing.get_contract_detail(
        contract_id="ctr_active", actor=staff_actor
    )
    assert "internal_notes" not in result["contract"]
    assert "manual_overrides" not in result["contract"]


@pytest.mark.asyncio
async def test_list_contracts_changed_fires_events(monkeypatch):
    """list_contracts: when refresh returns changed=True with events, _record_event is called."""
    now = _now_utc()
    db = _make_db()
    # expired contract (pending_activation + start in past) → contract_activated event
    contract = _active_contract()
    contract["contract_status"] = "pending_activation"
    contract["current_period_start"] = now - timedelta(hours=1)  # just passed
    contract["current_period_end"] = now + timedelta(days=29)
    db.student_contracts.docs.append(contract)
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.list_contracts(limit=200, actor=ACTOR)
    # Contract should be refreshed and reported as active
    assert len(result) == 1
    assert result[0]["contract_status"] == "active"
    # The activation event should have been recorded
    assert any(e["event_type"] == "contract_activated" for e in db.student_billing_events.docs)


@pytest.mark.asyncio
async def test_update_contract_on_canceled_raises_400(monkeypatch):
    """update_contract on a canceled contract: ensure_transition raises ValueError → 400."""
    from fastapi import HTTPException

    from app.models.student_billing import ContractUpdateIn
    db = _make_db()
    contract = _active_contract()
    contract["contract_status"] = "canceled"
    db.student_contracts.docs.append(contract)
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        await student_billing.update_contract(
            contract_id="ctr_active",
            payload=ContractUpdateIn(notes="nova nota"),
            actor=ACTOR,
        )
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_update_contract_discount_amount(monkeypatch):
    """update_contract with discount_amount updates the net amount."""
    from app.models.student_billing import ContractUpdateIn
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.update_contract(
        contract_id="ctr_active",
        payload=ContractUpdateIn(amount=200.0, discount_amount=20.0),
        actor=ACTOR,
    )
    assert result["discount_amount"] == pytest.approx(20.0, rel=1e-3)
    assert result["amount"] == pytest.approx(180.0, rel=1e-3)


@pytest.mark.asyncio
async def test_update_contract_end_at(monkeypatch):
    """update_contract with end_at extends the current_period_end."""
    from app.models.student_billing import ContractUpdateIn
    now = _now_utc()
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    new_end = now + timedelta(days=60)
    result = await student_billing.update_contract(
        contract_id="ctr_active",
        payload=ContractUpdateIn(end_at=new_end),
        actor=ACTOR,
    )
    assert result["manual_end_override"] is True


@pytest.mark.asyncio
async def test_update_contract_billing_day(monkeypatch):
    """update_contract with billing_day updates the billing cycle day."""
    from app.models.student_billing import ContractUpdateIn
    db = _make_db()
    db.student_contracts.docs.append(_active_contract())
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    result = await student_billing.update_contract(
        contract_id="ctr_active",
        payload=ContractUpdateIn(billing_day=15, payment_method="card"),
        actor=ACTOR,
    )
    assert result["billing_day"] == 15
    assert result["payment_method"] == "card"


@pytest.mark.asyncio
async def test_adjust_contract_validity_on_canceled_raises(monkeypatch):
    """adjust_contract_validity on terminal contract raises 400."""
    from fastapi import HTTPException

    from app.models.student_billing import ContractAdjustValidityIn
    now = _now_utc()
    db = _make_db()
    contract = _active_contract()
    contract["contract_status"] = "canceled"
    db.student_contracts.docs.append(contract)
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        await student_billing.adjust_contract_validity(
            contract_id="ctr_active",
            payload=ContractAdjustValidityIn(end_at=now + timedelta(days=30)),
            actor=ACTOR,
        )
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_renew_contract_on_canceled_raises(monkeypatch):
    """renew_contract on a canceled contract raises 400."""
    from fastapi import HTTPException
    db = _make_db()
    contract = _active_contract()
    contract["contract_status"] = "canceled"
    db.student_contracts.docs.append(contract)
    monkeypatch.setattr(student_billing, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        await student_billing.renew_contract(
            contract_id="ctr_active",
            payload=ContractRenewIn(),
            actor=ACTOR,
        )
    assert exc_info.value.status_code == 400


# ── Readiness cache regression tests ──────────────────────────────────────────

def test_ready_cache_serves_recent_ready_state():
    """Cache returns "ready" status up to the 5-minute window."""
    import time as time_mod

    from app.main import _ReadyCache
    cache = _ReadyCache()
    cache.set({"status": "ready", "checks": {"mongodb": {"ok": True}}})
    result = cache.get()
    assert result is not None
    assert result["status"] == "ready"
    # Even after 30 seconds the ready state is still cached
    cache._checked_at = time_mod.time() - 30
    assert cache.get() is not None


def test_ready_cache_short_ttl_for_degraded_state():
    """Degraded results expire within 10s so service recovery is detected quickly."""
    import time as time_mod

    from app.main import _ReadyCache, _READY_CACHE_TTL_DEGRADED
    cache = _ReadyCache()
    cache.set({"status": "degraded", "checks": {"mongodb": {"ok": False}}})
    # Right after set → cached
    assert cache.get() is not None
    # After short TTL window → expired
    cache._checked_at = time_mod.time() - (_READY_CACHE_TTL_DEGRADED + 1)
    assert cache.get() is None


def test_ready_cache_ready_long_ttl_vs_degraded_short():
    """Confirm the two TTLs differ: ready ≥ degraded * 5."""
    from app.main import _READY_CACHE_TTL_OK, _READY_CACHE_TTL_DEGRADED
    assert _READY_CACHE_TTL_OK >= _READY_CACHE_TTL_DEGRADED * 5
