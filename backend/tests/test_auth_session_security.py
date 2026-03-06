from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response
from starlette.requests import Request

from app.core.security import hash_password
from app.routes import auth


class FakeCursor:
    def __init__(self, docs: list[dict]):
        self.docs = [dict(item) for item in docs]
        self._limit = len(self.docs)

    def limit(self, limit: int):
        self._limit = limit
        return self

    async def to_list(self, _limit: int):
        return self.docs[: self._limit]


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = [dict(item) for item in (docs or [])]

    async def find_one(self, query: dict, _projection=None):
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in query.items()):
                return doc
        return None

    def find(self, query: dict, _projection=None):
        matched = []
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in query.items()):
                matched.append(doc)
        return FakeCursor(matched)

    async def update_one(self, query: dict, update: dict):
        doc = await self.find_one(query)
        if not doc:
            return type("Result", (), {"matched_count": 0})()
        for key, value in update.get("$set", {}).items():
            doc[key] = value
        return type("Result", (), {"matched_count": 1})()

    async def insert_one(self, doc: dict):
        self.docs.append(dict(doc))


class FakeDb:
    def __init__(self):
        now = datetime.now(timezone.utc)
        self.owners = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "gym_id": "gym_1",
                    "name": "Owner 1",
                    "email": "owner@gymbro.com",
                    "email_verified": True,
                    "password_hash": hash_password("Secret123!"),
                    "updated_at": now,
                }
            ]
        )
        self.employees = FakeCollection(
            [
                {
                    "employee_id": "emp_1",
                    "owner_id": "own_1",
                    "gym_id": "gym_1",
                    "name": "Funcionario 1",
                    "email": "shared@gymbro.com",
                    "role": "MANAGER",
                    "is_active": True,
                    "password_hash": hash_password("Secret123!"),
                },
                {
                    "employee_id": "emp_2",
                    "owner_id": "own_2",
                    "gym_id": "gym_2",
                    "name": "Funcionario 2",
                    "email": "shared@gymbro.com",
                    "role": "RECEPTION",
                    "is_active": True,
                    "password_hash": hash_password("Secret123!"),
                },
            ]
        )
        self.students = FakeCollection([])
        self.subscriptions = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "status": "active",
                    "current_period_end": now + timedelta(days=30),
                },
                {
                    "owner_id": "own_2",
                    "status": "active",
                    "current_period_end": now + timedelta(days=30),
                },
            ]
        )
        self.audit_logs = FakeCollection([])


def _build_request() -> Request:
    request = Request({"type": "http", "method": "POST", "path": "/api/auth/login", "headers": []})
    request.state.request_id = "req_test_auth"
    return request


@pytest.mark.asyncio
async def test_login_sets_cookie_and_logout_revokes_session(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(auth, "get_db", lambda: db)

    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr(auth, "_enforce_auth_rate_limit", _noop)
    monkeypatch.setattr(
        auth,
        "get_settings",
        lambda: SimpleNamespace(
            auth_login_rate_limit=10,
            auth_login_window_seconds=60,
            mp_access_token=None,
            super_admin_email=None,
            super_admin_password=None,
            session_cookie_name="gymbro_session",
            session_cookie_domain=None,
            session_cookie_path="/",
            session_cookie_secure=False,
            session_cookie_samesite="lax",
            environment="dev",
        ),
    )

    response = Response()
    result = await auth.login(
        auth.LoginIn(identifier="owner@gymbro.com", password="Secret123!"),
        _build_request(),
        response,
    )

    assert result["user"]["owner_id"] == "own_1"
    assert "gymbro_session=" in response.headers.get("set-cookie", "")

    logout_response = Response()
    await auth.logout(
        logout_response,
        Request({"type": "http", "method": "POST", "path": "/api/auth/logout", "headers": []}),
        {"owner_id": "own_1", "gym_id": "gym_1", "actor_type": "owner", "role": "OWNER"},
    )

    assert db.owners.docs[0]["session_revoked_at"] is not None
    assert "gymbro_session=" in logout_response.headers.get("set-cookie", "")
    assert [item["event"] for item in db.audit_logs.docs] == ["auth.login", "auth.logout"]


@pytest.mark.asyncio
async def test_login_employee_rejects_ambiguous_accounts(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(auth, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc:
        await auth._login_employee("shared@gymbro.com", "Secret123!")

    assert exc.value.status_code == 409
    assert "ambiguo" in exc.value.detail.lower()
