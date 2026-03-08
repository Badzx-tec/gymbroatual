import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.routes import billing


class UpdateResult:
    def __init__(self, matched_count: int):
        self.matched_count = matched_count


class FakeCursor:
    def __init__(self, docs: list[dict]):
        self._docs = [dict(item) for item in docs]
        self._limit = len(self._docs)

    def sort(self, field: str, direction: int):
        reverse = direction == -1
        self._docs.sort(key=lambda item: item.get(field), reverse=reverse)
        return self

    def limit(self, value: int):
        self._limit = value
        return self

    async def to_list(self, _length: int):
        return self._docs[: self._limit]


class FakeCollection:
    def __init__(self, docs: list[dict] | None = None):
        self.docs = [dict(item) for item in (docs or [])]

    async def find_one(self, query: dict, _projection=None):
        for doc in self.docs:
            if _matches(doc, query):
                return doc
        return None

    def find(self, query: dict, _projection=None):
        docs = [doc for doc in self.docs if _matches(doc, query)]
        return FakeCursor(docs)

    async def insert_one(self, doc: dict):
        self.docs.append(dict(doc))

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        doc = None
        for item in self.docs:
            if _matches(item, query):
                doc = item
                break

        if doc is None and upsert:
            doc = dict(query)
            self.docs.append(doc)
            for key, value in update.get("$setOnInsert", {}).items():
                _set_path(doc, key, value)

        if doc is None:
            return UpdateResult(0)

        for key, value in update.get("$set", {}).items():
            _set_path(doc, key, value)
        for key, value in update.get("$inc", {}).items():
            current = _get_path(doc, key) or 0
            _set_path(doc, key, current + value)

        return UpdateResult(1)


class FakeDb:
    def __init__(self):
        trial_end = datetime(2026, 2, 28, tzinfo=timezone.utc)
        self.subscriptions = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "status": "trialing",
                    "provider": "mercadopago",
                    "mp_preapproval_id": None,
                    "trial_ends_at": trial_end,
                    "current_period_end": None,
                    "last_payment_at": None,
                    "grace_until": None,
                    "updated_at": datetime(2026, 2, 22, tzinfo=timezone.utc),
                }
            ]
        )
        self.memberships = FakeCollection([])
        self.invoices = FakeCollection([])
        self.payment_attempts = FakeCollection([])
        self.subscription_events = FakeCollection([])
        self.billing_events = FakeCollection([])


class DummyClient:
    host = "127.0.0.1"


class DummyRequest:
    def __init__(self, payload: dict):
        self._payload = payload
        self.headers = {}
        self.client = DummyClient()

    async def body(self):
        return json.dumps(self._payload).encode("utf-8")

    async def json(self):
        return dict(self._payload)


class DummyAsyncClient:
    def __init__(self, *_args, **_kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _matches(doc: dict, query: dict) -> bool:
    for key, expected in query.items():
        if isinstance(expected, dict) and "$nin" in expected:
            if doc.get(key) in expected["$nin"]:
                return False
            continue
        if doc.get(key) != expected:
            return False
    return True


def _set_path(doc: dict, key: str, value):
    parts = key.split(".")
    cursor = doc
    for part in parts[:-1]:
        if part not in cursor or not isinstance(cursor[part], dict):
            cursor[part] = {}
        cursor = cursor[part]
    cursor[parts[-1]] = value


def _get_path(doc: dict, key: str):
    parts = key.split(".")
    cursor = doc
    for part in parts:
        if not isinstance(cursor, dict) or part not in cursor:
            return None
        cursor = cursor[part]
    return cursor


@pytest.mark.asyncio
async def test_checkout_webhook_populates_financial_domain(monkeypatch):
    db = FakeDb()

    async def bypass_rate_limit(**_kwargs):
        return None

    settings = SimpleNamespace(
        mp_access_token=None,
        mp_webhook_secret=None,
        frontend_base_url="http://localhost:3000",
        app_base_url="http://localhost:8000",
        subscription_monthly_amount=139.90,
        webhook_rate_limit=100,
        webhook_window_seconds=60,
    )

    monkeypatch.setattr(billing, "get_db", lambda: db)
    monkeypatch.setattr(billing, "get_settings", lambda: settings)
    monkeypatch.setattr(billing, "enforce_rate_limit", bypass_rate_limit)

    owner = {
        "owner_id": "own_1",
        "email": "owner@example.com",
        "name": "Owner Test",
    }

    checkout = await billing.create_checkout_for_owner(owner)
    assert checkout.preapproval_id == "mock_pre_own_1"
    assert "/admin/assinatura" in checkout.checkout_url

    actor = {"owner_id": "own_1", "role": "OWNER"}
    membership_before = await billing.membership(actor=actor)
    invoices_before = await billing.invoices(limit=20, actor=actor)
    attempts_before = await billing.payment_attempts(limit=20, actor=actor)
    events_before = await billing.subscription_events(limit=20, actor=actor)

    assert membership_before["status"] == "trialing"
    assert invoices_before[0]["status"] == "open"
    assert attempts_before[0]["status"] == "pending"
    assert events_before[0]["event_type"] == "checkout_created"

    webhook_payload = {
        "id": "evt_123",
        "action": "preapproval.payment",
        "type": "subscription_preapproval",
        "external_reference": "own_1",
        "data": {"id": "mock_pre_own_1", "status": "authorized"},
    }
    response = await billing.webhook_mercadopago(DummyRequest(webhook_payload), x_signature=None)
    assert response["status"] == "ok"

    updated_subscription = await db.subscriptions.find_one({"owner_id": "own_1"})
    assert updated_subscription["status"] == "active"

    invoices_after = await billing.invoices(limit=20, actor=actor)
    attempts_after = await billing.payment_attempts(limit=20, actor=actor)
    events_after = await billing.subscription_events(limit=20, actor=actor)

    assert invoices_after[0]["status"] == "paid"
    assert attempts_after[0]["status"] == "succeeded"
    assert events_after[0]["source"] == "webhook"
    assert events_after[0]["status"] == "active"


@pytest.mark.asyncio
async def test_payment_webhook_uses_payment_details_to_unlock_panel(monkeypatch):
    db = FakeDb()

    async def bypass_rate_limit(**_kwargs):
        return None

    async def fake_fetch_payment(_client, payment_id: str, _token: str):
        assert payment_id == "pay_approved_1"
        return {
            "id": payment_id,
            "status": "approved",
            "external_reference": "own_1",
            "date_approved": "2026-03-07T15:10:00Z",
        }

    settings = SimpleNamespace(
        mp_access_token="token_123",
        mp_webhook_secret=None,
        frontend_base_url="http://localhost:3000",
        app_base_url="http://localhost:8000",
        subscription_monthly_amount=139.90,
        webhook_rate_limit=100,
        webhook_window_seconds=60,
    )

    monkeypatch.setattr(billing, "get_db", lambda: db)
    monkeypatch.setattr(billing, "get_settings", lambda: settings)
    monkeypatch.setattr(billing, "enforce_rate_limit", bypass_rate_limit)
    monkeypatch.setattr(billing, "fetch_payment", fake_fetch_payment)
    monkeypatch.setattr(billing.httpx, "AsyncClient", DummyAsyncClient)

    webhook_payload = {
        "id": "evt_pay_1",
        "action": "payment.updated",
        "type": "payment",
        "data": {"id": "pay_approved_1"},
    }

    response = await billing.webhook_mercadopago(DummyRequest(webhook_payload), x_signature=None)
    assert response["status"] == "ok"

    updated_subscription = await db.subscriptions.find_one({"owner_id": "own_1"})
    assert updated_subscription["status"] == "active"
    assert updated_subscription["last_payment_at"] == datetime(2026, 3, 7, 15, 10, tzinfo=timezone.utc)

    invoices_after = await billing.invoices(limit=20, actor={"owner_id": "own_1", "role": "OWNER"})
    attempts_after = await billing.payment_attempts(limit=20, actor={"owner_id": "own_1", "role": "OWNER"})

    assert invoices_after[0]["status"] == "paid"
    assert attempts_after[0]["status"] == "succeeded"
