import pytest

from app.routes import students


class FakeCursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return list(self.docs)


class FakeStudentsCollection:
    def __init__(self):
        self.last_query = None

    def find(self, query, _projection=None):
        self.last_query = query
        return FakeCursor([])


class FakeDb:
    def __init__(self):
        self.students = FakeStudentsCollection()


@pytest.mark.asyncio
async def test_students_search_escapes_regex_meta(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(students, "get_db", lambda: db)

    await students.list_students(
        search=".*(admin)+",
        status="",
        owner={"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"},
    )

    assert db.students.last_query is not None
    assert db.students.last_query["owner_id"] == "own_1"
    assert db.students.last_query["is_employee_shadow"] == {"$ne": True}
    regex_value = db.students.last_query["$or"][0]["nome"]["$regex"]
    assert regex_value == r"\.\*\(admin\)\+"
