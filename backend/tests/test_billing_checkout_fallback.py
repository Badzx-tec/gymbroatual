from types import SimpleNamespace

import pytest

from app.routes import billing, legacy


class FakeSubscriptions:
    def __init__(self):
        self.calls = []

    async def update_one(self, _query: dict, _update: dict):
        self.calls.append({"query": dict(_query), "update": dict(_update)})
        return None


class FakeDb:
    def __init__(self):
        self.subscriptions = FakeSubscriptions()


class FakeResponse:
    def __init__(self, *, status_code: int, payload: dict | None = None, text: str = ""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text
        self.is_success = 200 <= status_code < 300

    def json(self):
        return dict(self._payload)


class FakeAsyncClient:
    def __init__(self, *_args, **_kwargs):
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url: str, headers: dict, json: dict):
        self.calls.append({"url": url, "headers": headers, "json": json})
        if url.endswith("/preapproval"):
            return FakeResponse(
                status_code=400,
                text='{"message":"card_token_id is required","status":400}',
            )
        if url.endswith("/checkout/preferences"):
            return FakeResponse(
                status_code=201,
                payload={"id": "pref_123", "init_point": "https://mp.test/checkout/pref_123"},
            )
        return FakeResponse(status_code=500, text="unexpected")


class FakeAsyncClientPreapprovalPlan:
    calls = []

    def __init__(self, *_args, **_kwargs):
        self.__class__.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url: str, headers: dict, json: dict):
        self.__class__.calls.append({"url": url, "headers": headers, "json": json})
        if url.endswith("/preapproval"):
            return FakeResponse(
                status_code=201,
                payload={"id": "pre_123", "init_point": "https://mp.test/checkout/pre_123"},
            )
        return FakeResponse(status_code=500, text="unexpected")


@pytest.mark.asyncio
async def test_checkout_fallbacks_to_preference_when_preapproval_fails(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(billing, "get_db", lambda: db)
    monkeypatch.setattr(billing.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(
        billing,
        "get_settings",
        lambda: SimpleNamespace(
            mp_access_token="token_123",
            mp_preapproval_plan_id=None,
            frontend_base_url="https://gymbro.dev.br",
            app_base_url="https://gymbro.dev.br",
            subscription_monthly_amount=139.9,
        ),
    )
    monkeypatch.setattr(
        billing,
        "_sync_membership",
        lambda *_args, **_kwargs: _async_value({"amount": 139.9, "status": "trialing"}),
    )
    monkeypatch.setattr(
        billing,
        "_upsert_invoice",
        lambda *_args, **_kwargs: _async_value({"invoice_id": "inv_1"}),
    )
    monkeypatch.setattr(
        billing,
        "_record_payment_attempt",
        lambda *_args, **_kwargs: _async_value(None),
    )
    monkeypatch.setattr(
        billing,
        "_record_subscription_event",
        lambda *_args, **_kwargs: _async_value(None),
    )
    monkeypatch.setattr(billing, "log_event", lambda *_args, **_kwargs: None)

    checkout = await billing.create_checkout_for_owner(
        {"owner_id": "own_1", "email": "owner@gymbro.dev.br"}
    )

    assert checkout.preapproval_id is None
    assert checkout.checkout_url == "https://mp.test/checkout/pref_123"
    subscription_update = db.subscriptions.calls[0]["update"]["$set"]
    assert "mp_preapproval_id" not in subscription_update
    assert subscription_update["meta.last_checkout"]["mode"] == "preference"
    assert subscription_update["meta.last_checkout"]["provider_reference"] == "pref_123"


@pytest.mark.asyncio
async def test_checkout_with_preapproval_plan_records_owner_scoped_reference(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(billing, "get_db", lambda: db)
    monkeypatch.setattr(billing.httpx, "AsyncClient", FakeAsyncClientPreapprovalPlan)
    monkeypatch.setattr(
        billing,
        "get_settings",
        lambda: SimpleNamespace(
            mp_access_token="token_123",
            mp_preapproval_plan_id="plan_123",
            frontend_base_url="https://gymbro.dev.br",
            app_base_url="https://gymbro.dev.br",
            subscription_monthly_amount=139.9,
        ),
    )
    monkeypatch.setattr(
        billing,
        "_sync_membership",
        lambda *_args, **_kwargs: _async_value({"amount": 139.9, "status": "trialing"}),
    )
    monkeypatch.setattr(
        billing,
        "_upsert_invoice",
        lambda *_args, **_kwargs: _async_value({"invoice_id": "inv_1"}),
    )
    monkeypatch.setattr(
        billing,
        "_record_payment_attempt",
        lambda *_args, **_kwargs: _async_value(None),
    )
    monkeypatch.setattr(
        billing,
        "_record_subscription_event",
        lambda *_args, **_kwargs: _async_value(None),
    )
    monkeypatch.setattr(billing, "log_event", lambda *_args, **_kwargs: None)

    checkout = await billing.create_checkout_for_owner(
        {"owner_id": "own_1", "email": "owner@gymbro.dev.br"}
    )

    assert checkout.preapproval_id == "pre_123"
    assert checkout.checkout_url == "https://mp.test/checkout/pre_123"
    assert len(FakeAsyncClientPreapprovalPlan.calls) == 1

    preapproval_payload = FakeAsyncClientPreapprovalPlan.calls[0]["json"]
    assert preapproval_payload["preapproval_plan_id"] == "plan_123"
    assert preapproval_payload["external_reference"] == "own_1"
    assert preapproval_payload["metadata"] == {
        "owner_id": "own_1",
        "plan_code": "owner_monthly",
    }
    assert "auto_recurring" not in preapproval_payload

    subscription_update = db.subscriptions.calls[0]["update"]["$set"]
    assert subscription_update["mp_preapproval_id"] == "pre_123"
    assert subscription_update["meta.last_checkout"]["mode"] == "preapproval_plan"
    assert subscription_update["meta.last_checkout"]["preapproval_id"] == "pre_123"
    assert subscription_update["meta.last_checkout"]["provider_reference"] == "pre_123"


def _async_value(value):
    async def _inner(*_args, **_kwargs):
        return value

    return _inner()


@pytest.mark.asyncio
async def test_legacy_academy_checkout_forwards_payload_and_actor(monkeypatch):
    calls = {}

    async def fake_create_checkout_for_owner(owner: dict, *, plan_code: str | None = None):
        calls["owner"] = owner
        calls["plan_code"] = plan_code
        return {"checkout_url": "https://mp.test/checkout"}

    monkeypatch.setattr(
        legacy.billing_routes,
        "create_checkout_for_owner",
        fake_create_checkout_for_owner,
    )

    actor = {"owner_id": "own_1", "email": "owner@gymbro.dev.br", "role": "OWNER"}
    result = await legacy.academy_checkout({"plan_code": "owner_quarterly"}, actor)

    assert result == {"checkout_url": "https://mp.test/checkout"}
    assert calls == {"owner": actor, "plan_code": "owner_quarterly"}
