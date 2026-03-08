from datetime import datetime, timedelta, timezone

import pytest

from app.core.security import hash_password
from app.routes import auth


class FakeCollection:
    def __init__(self, docs):
        self.docs = [dict(item) for item in docs]

    async def find_one(self, query, _projection=None):
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in query.items()):
                return doc
        return None


class FakeDb:
    def __init__(self):
        now = datetime.now(timezone.utc)
        self.owners = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "gym_id": "gym_1",
                    "name": "Owner 1",
                    "email": "owner@example.com",
                    "email_verified": True,
                    "password_hash": hash_password("secret123"),
                    "branding": {
                        "theme_key": "blue",
                        "color_mode": "light",
                        "logo_data_url": None,
                    },
                }
            ]
        )
        self.gyms = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "name": "Academia Central",
                }
            ]
        )
        self.subscriptions = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "status": "active",
                    "trial_ends_at": None,
                    "current_period_end": now + timedelta(days=7),
                    "grace_until": None,
                }
            ]
        )


@pytest.mark.asyncio
async def test_owner_login_payload_includes_role_and_actor_type(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(auth, "get_db", lambda: db)

    result = await auth._login_owner("owner@example.com", "secret123")

    assert result is not None
    user_payload = (
        result["user"].model_dump()
        if hasattr(result.get("user"), "model_dump")
        else dict(result["user"])
    )
    assert user_payload["role"] == "OWNER"
    assert user_payload["actor_type"] == "owner"


@pytest.mark.asyncio
async def test_auth_me_owner_includes_role_even_without_role_in_actor():
    response = await auth.me(
        actor={
            "owner_id": "own_1",
            "gym_id": "gym_1",
            "name": "Owner 1",
            "email": "owner@example.com",
            "email_verified": True,
            "actor_type": "owner",
        }
    )

    assert response["role"] == "OWNER"
    assert response["actor_type"] == "owner"


@pytest.mark.asyncio
async def test_owner_profile_payload_includes_color_mode(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(auth, "get_db", lambda: db)

    payload = await auth._owner_profile_payload(db.owners.docs[0])

    assert payload["branding"]["theme_key"] == "blue"
    assert payload["branding"]["color_mode"] == "light"
