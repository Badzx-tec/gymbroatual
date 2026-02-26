from datetime import datetime, timezone

import pytest

from app.routes import legacy


class FakeCursor:
    def __init__(self, docs):
        self.docs = [dict(item) for item in docs]

    def sort(self, field, direction):
        reverse = direction == -1
        self.docs.sort(key=lambda item: item.get(field), reverse=reverse)
        return self

    def limit(self, limit):
        self.docs = self.docs[:limit]
        return self

    async def to_list(self, _limit):
        return self.docs


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = [dict(item) for item in (docs or [])]

    def find(self, query, _projection=None):
        filtered = []
        for item in self.docs:
            if all(item.get(k) == v for k, v in query.items()):
                filtered.append(item)
        return FakeCursor(filtered)


class FakeDb:
    def __init__(self):
        now = datetime(2026, 2, 26, 16, 0, tzinfo=timezone.utc)
        self.billing_events = FakeCollection(
            [
                {"owner_id": "own_1", "event_id": "ev_1", "received_at": now},
                {"owner_id": "own_2", "event_id": "ev_2", "received_at": now},
            ]
        )


@pytest.mark.asyncio
async def test_webhook_logs_are_owner_scoped(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(legacy, "get_db", lambda: db)

    result = await legacy.webhook_logs(
        limit=50,
        actor={"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"},
    )

    assert len(result) == 1
    assert result[0]["owner_id"] == "own_1"
    assert result[0]["event_id"] == "ev_1"
