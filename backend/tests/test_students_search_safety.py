import pytest

from app.routes import students


class FakeCursor:
    def __init__(self, docs):
        self.docs = docs
        self.sort_field = None
        self.sort_direction = None

    def sort(self, field, direction):
        self.sort_field = field
        self.sort_direction = direction
        return self

    async def to_list(self, _limit):
        return list(self.docs)


class FakeStudentsCollection:
    def __init__(self):
        self.last_query = None
        self.last_cursor = None

    def find(self, query, _projection=None):
        self.last_query = query
        self.last_cursor = FakeCursor([])
        return self.last_cursor


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


@pytest.mark.asyncio
async def test_students_list_uses_alphabetical_sort(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(students, "get_db", lambda: db)

    await students.list_students(
        search="",
        status="",
        owner={"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"},
    )

    assert db.students.last_cursor is not None
    assert db.students.last_cursor.sort_field == "nome"
    assert db.students.last_cursor.sort_direction == 1
