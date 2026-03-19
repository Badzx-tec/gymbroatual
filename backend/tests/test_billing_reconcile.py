from datetime import datetime, timezone
from types import SimpleNamespace

import httpx
import pytest

from app.services import billing_reconcile


def test_map_mp_preapproval_status():
    assert billing_reconcile.map_mp_preapproval_status("authorized") == "active"
    assert billing_reconcile.map_mp_preapproval_status("active") == "active"
    assert billing_reconcile.map_mp_preapproval_status("pending") == "past_due"
    assert billing_reconcile.map_mp_preapproval_status("paused") == "canceled"
    assert billing_reconcile.map_mp_preapproval_status("cancelled") == "canceled"
    assert billing_reconcile.map_mp_preapproval_status("expired") == "expired"


class UpdateResult:
    def __init__(self, matched_count: int):
        self.matched_count = matched_count


class FakeCursor:
    def __init__(self, docs):
        self.docs = [dict(item) for item in docs]
        self._limit = len(self.docs)

    def limit(self, value: int):
        self._limit = value
        return self

    async def to_list(self, _length: int):
        return self.docs[: self._limit]


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = [dict(item) for item in (docs or [])]

    def find(self, query, _projection=None):
        docs = [doc for doc in self.docs if _matches(doc, query)]
        return FakeCursor(docs)

    async def update_one(self, query, update):
        for doc in self.docs:
            if _matches(doc, query):
                for key, value in update.get("$set", {}).items():
                    doc[key] = value
                return UpdateResult(1)
        return UpdateResult(0)

    async def insert_one(self, doc):
        self.docs.append(dict(doc))


class FakeDb:
    def __init__(self):
        self.subscriptions = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "provider": "mercadopago",
                    "mp_preapproval_id": "pref_123",
                    "status": "past_due",
                    "updated_at": datetime(2026, 3, 1, tzinfo=timezone.utc),
                }
            ]
        )
        self.billing_events = FakeCollection([])
        self.subscription_events = FakeCollection([])


class FakeResponse:
    def __init__(self, *, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return dict(self._payload)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "request failed",
                request=httpx.Request("GET", "https://api.mercadopago.com"),
                response=httpx.Response(self.status_code),
            )


class FakeAsyncClient:
    def __init__(self, *_args, **_kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url, headers=None, params=None):
        if "/preapproval/" in url:
            return FakeResponse(status_code=404, payload={})
        if url.endswith("/v1/payments/search"):
            assert params["external_reference"] == "own_1"
            return FakeResponse(
                status_code=200,
                payload={
                    "results": [
                        {
                            "id": "pay_1",
                            "status": "approved",
                            "external_reference": "own_1",
                            "date_approved": "2026-03-07T10:30:00Z",
                        }
                    ]
                },
            )
        raise AssertionError(f"Unexpected URL {url}")


class FakeAsyncClientInvalidPreapprovalNoPayment(FakeAsyncClient):
    async def get(self, url, headers=None, params=None):
        if "/preapproval/" in url:
            return FakeResponse(status_code=404, payload={})
        if url.endswith("/v1/payments/search"):
            return FakeResponse(status_code=200, payload={"results": []})
        raise AssertionError(f"Unexpected URL {url}")


class FakeAsyncClientShouldNotBeCalled(FakeAsyncClient):
    async def get(self, url, headers=None, params=None):
        raise AssertionError(f"Reconcile should have skipped the HTTP call for {url}")


def _matches(doc, query):
    for key, expected in query.items():
        if isinstance(expected, dict) and "$nin" in expected:
            if doc.get(key) in expected["$nin"]:
                return False
            continue
        if doc.get(key) != expected:
            return False
    return True


@pytest.mark.asyncio
async def test_reconcile_recovers_active_status_from_recent_payment(monkeypatch):
    db = FakeDb()
    settings = SimpleNamespace(
        mp_access_token="token_123",
        billing_reconcile_batch_size=50,
    )

    monkeypatch.setattr(billing_reconcile, "get_db", lambda: db)
    monkeypatch.setattr(billing_reconcile, "get_settings", lambda: settings)
    monkeypatch.setattr(billing_reconcile.httpx, "AsyncClient", FakeAsyncClient)

    summary = await billing_reconcile.reconcile_subscriptions(owner_id="own_1", limit=1)

    assert summary["updated"] == 1
    assert db.subscriptions.docs[0]["status"] == "active"
    assert db.subscriptions.docs[0]["current_period_end"] is not None
    assert db.billing_events.docs[0]["action"] == "reconcile_payment_search"


@pytest.mark.asyncio
async def test_reconcile_skips_invalid_preapproval_without_logging_error(monkeypatch):
    db = FakeDb()
    settings = SimpleNamespace(
        mp_access_token="token_123",
        billing_reconcile_batch_size=50,
    )
    observed_events = []

    monkeypatch.setattr(billing_reconcile, "get_db", lambda: db)
    monkeypatch.setattr(billing_reconcile, "get_settings", lambda: settings)
    monkeypatch.setattr(
        billing_reconcile.httpx,
        "AsyncClient",
        FakeAsyncClientInvalidPreapprovalNoPayment,
    )
    monkeypatch.setattr(
        billing_reconcile,
        "log_event",
        lambda name, **kwargs: observed_events.append((name, kwargs)),
    )

    summary = await billing_reconcile.reconcile_subscriptions(owner_id="own_1", limit=1)

    assert summary == {"processed": 1, "updated": 0, "failed": 0, "skipped": 1}
    assert db.subscriptions.docs[0]["status"] == "past_due"
    assert db.subscriptions.docs[0]["meta.last_reconcile"]["status"] == (
        "invalid_preapproval_reference"
    )
    assert db.subscriptions.docs[0]["meta.invalid_preapproval_reference"]["http_status"] == 404
    assert db.billing_events.docs == []
    assert observed_events == []


@pytest.mark.asyncio
async def test_reconcile_skips_previously_marked_invalid_preapproval(monkeypatch):
    db = FakeDb()
    db.subscriptions.docs[0]["meta"] = {
        "invalid_preapproval_reference": {
            "preapproval_id": "pref_123",
            "http_status": 404,
        }
    }
    settings = SimpleNamespace(
        mp_access_token="token_123",
        billing_reconcile_batch_size=50,
    )

    monkeypatch.setattr(billing_reconcile, "get_db", lambda: db)
    monkeypatch.setattr(billing_reconcile, "get_settings", lambda: settings)
    monkeypatch.setattr(
        billing_reconcile.httpx,
        "AsyncClient",
        FakeAsyncClientShouldNotBeCalled,
    )

    summary = await billing_reconcile.reconcile_subscriptions(owner_id="own_1", limit=1)

    assert summary == {"processed": 1, "updated": 0, "failed": 0, "skipped": 1}
