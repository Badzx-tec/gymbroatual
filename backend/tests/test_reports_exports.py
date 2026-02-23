from datetime import datetime, timezone

import pytest
from starlette.responses import StreamingResponse

from app.routes import legacy


class FakeCursor:
    def __init__(self, docs):
        self.docs = [dict(item) for item in docs]

    def sort(self, field, direction):
        reverse = direction == -1
        self.docs.sort(key=lambda item: item.get(field), reverse=reverse)
        return self

    async def to_list(self, _limit):
        return self.docs


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = [dict(item) for item in (docs or [])]

    def find(self, query, _projection=None):
        filtered = [item for item in self.docs if all(item.get(k) == v for k, v in query.items())]
        return FakeCursor(filtered)


class FakeDb:
    def __init__(self):
        now = datetime(2026, 2, 23, 15, 0, tzinfo=timezone.utc)
        self.students = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "student_id": "std_1",
                    "nome": "Aluno 1",
                    "email": None,
                    "cpf": "123.456.789-00",
                    "telefone": "31999999999",
                    "plano_id": "plano_1",
                    "status": "ativo",
                    "data_vencimento": now.date(),
                    "created_at": now,
                }
            ]
        )
        self.access_logs = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "created_at": now,
                    "subject_type": "student",
                    "student_name": "Aluno 1",
                    "autorizado": True,
                    "motivo": "ok",
                    "method": "rfid",
                }
            ]
        )
        self.invoices = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "invoice_id": "inv_1",
                    "period_label": "2026-02",
                    "status": "paid",
                    "amount": 139.9,
                    "created_at": now,
                    "paid_at": now,
                }
            ]
        )
        self.student_charges = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "charge_id": "chg_1",
                    "status": "open",
                    "amount": 120.0,
                    "due_at": now,
                    "paid_at": None,
                    "created_at": now,
                }
            ]
        )


@pytest.mark.asyncio
async def test_export_students_excel_returns_stream(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(legacy, "get_db", lambda: db)

    response = await legacy.export_students_excel(actor={"owner_id": "own_1", "gym_id": "gym_1"})

    assert isinstance(response, StreamingResponse)
    assert response.status_code == 200
    assert "alunos_gymbro.xlsx" in response.headers.get("content-disposition", "")


@pytest.mark.asyncio
async def test_export_students_pdf_returns_stream(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(legacy, "get_db", lambda: db)

    response = await legacy.export_students_pdf(actor={"owner_id": "own_1", "gym_id": "gym_1"})

    assert isinstance(response, StreamingResponse)
    assert response.status_code == 200
    assert response.media_type == "application/pdf"
    assert "alunos_gymbro.pdf" in response.headers.get("content-disposition", "")


@pytest.mark.asyncio
async def test_export_access_and_financial_excel_return_stream(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(legacy, "get_db", lambda: db)

    access_response = await legacy.export_access_excel(actor={"owner_id": "own_1", "gym_id": "gym_1"})
    financial_response = await legacy.export_financial_excel(
        actor={"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"}
    )

    assert isinstance(access_response, StreamingResponse)
    assert isinstance(financial_response, StreamingResponse)
    assert "acessos_gymbro.xlsx" in access_response.headers.get("content-disposition", "")
    assert "financeiro_gymbro.xlsx" in financial_response.headers.get("content-disposition", "")
