import pytest
from fastapi import HTTPException

from app.core.security import hash_password
from app.models.auth import LoginIn
from app.models.billing import CheckoutOut
from app.routes import auth, billing


class FakeCollection:
    def __init__(self, docs):
        self.docs = docs

    async def find_one(self, query, _projection=None):
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in query.items()):
                return doc
        return None


class FakeDb:
    def __init__(self):
        self.owners = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "gym_id": "gym_1",
                    "name": "Owner 1",
                    "email": "owner@example.com",
                    "email_verified": True,
                    "password_hash": hash_password("secret123"),
                }
            ]
        )
        self.employees = FakeCollection([])
        self.subscriptions = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "status": "expired",
                    "trial_ends_at": None,
                    "current_period_end": None,
                    "grace_until": None,
                }
            ]
        )


class DummyClient:
    host = "127.0.0.1"


class DummyRequest:
    headers: dict = {}
    client = DummyClient()


@pytest.mark.asyncio
async def test_login_requires_payment(monkeypatch):
    db = FakeDb()

    async def fake_checkout(_owner):
        return CheckoutOut(checkout_url="https://checkout.test", preapproval_id="pre_1")

    async def bypass_rate_limit(**_kwargs):
        return None

    monkeypatch.setattr(auth, "get_db", lambda: db)
    monkeypatch.setattr(billing, "create_checkout_for_owner", fake_checkout)
    monkeypatch.setattr(auth, "enforce_rate_limit", bypass_rate_limit)

    with pytest.raises(HTTPException) as exc:
        await auth.login(
            LoginIn(email="owner@example.com", password="secret123"),
            request=DummyRequest(),
        )

    assert exc.value.status_code == 402
    assert exc.value.headers["X-Error-Code"] == "PAYMENT_REQUIRED"
    assert exc.value.headers["X-Checkout-Url"] == "https://checkout.test"
