from datetime import datetime, timedelta, timezone

import pytest

from app.routes import gyms


class FakeCursor:
    def __init__(self, docs: list[dict]):
        self.docs = [dict(item) for item in docs]
        self._limit = len(self.docs)

    def sort(self, field: str, direction: int):
        reverse = direction == -1
        self.docs.sort(key=lambda item: item.get(field), reverse=reverse)
        return self

    def limit(self, limit: int):
        self._limit = limit
        return self

    async def to_list(self, _limit: int):
        return self.docs[: self._limit]


class FakeCollection:
    def __init__(self, docs: list[dict] | None = None):
        self.docs = [dict(item) for item in (docs or [])]

    def find(self, query: dict, _projection=None):
        return FakeCursor([item for item in self.docs if _matches(item, query)])

    async def count_documents(self, query: dict):
        return sum(1 for item in self.docs if _matches(item, query))


class FakeDb:
    def __init__(self):
        now = datetime.now(timezone.utc)
        self.students = FakeCollection(
            [
                {"owner_id": "own_1", "student_id": "std_1", "status": "ativo", "treino": "A"},
                {"owner_id": "own_1", "student_id": "std_2", "status": "ativo", "treino": ""},
                {"owner_id": "own_1", "student_id": "std_3", "status": "inativo"},
            ]
        )
        self.access_logs = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "log_id": "log_1",
                    "student_id": "std_1",
                    "student_name": "Aluno 1",
                    "autorizado": True,
                    "tipo": "rfid",
                    "timestamp": now - timedelta(minutes=30),
                    "created_at": now - timedelta(minutes=30),
                },
                {
                    "owner_id": "own_1",
                    "log_id": "log_2",
                    "student_id": "std_1",
                    "student_name": "Aluno 1",
                    "autorizado": False,
                    "tipo": "rfid",
                    "timestamp": now - timedelta(minutes=20),
                    "created_at": now - timedelta(minutes=20),
                },
                {
                    "owner_id": "own_1",
                    "log_id": "log_3",
                    "student_id": "std_2",
                    "student_name": "Aluno 2",
                    "autorizado": True,
                    "tipo": "rfid",
                    "timestamp": now - timedelta(minutes=150),
                    "created_at": now - timedelta(minutes=150),
                },
                {
                    "owner_id": "own_1",
                    "log_id": "log_4",
                    "employee_id": "emp_1",
                    "employee_name": "Funcionario 1",
                    "decision": "allow",
                    "subject_type": "employee",
                    "method": "biometry",
                    "timestamp": now - timedelta(minutes=10),
                    "created_at": now - timedelta(minutes=10),
                },
            ]
        )
        self.student_charges = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "charge_id": "chg_1",
                    "status": "paid",
                    "amount": 120.0,
                    "amount_received": None,
                    "paid_at": now - timedelta(days=10),
                },
                {
                    "owner_id": "own_1",
                    "charge_id": "chg_2",
                    "status": "paid",
                    "amount": 200.0,
                    "amount_received": 200.0,
                    "paid_at": now - timedelta(days=2),
                },
                {
                    "owner_id": "own_1",
                    "charge_id": "chg_old",
                    "status": "paid",
                    "amount": 40.0,
                    "amount_received": None,
                    "paid_at": now - timedelta(days=220),
                },
            ]
        )
        self.student_contracts = FakeCollection(
            [
                {
                    "owner_id": "own_1",
                    "contract_id": "ctr_1",
                    "status": "active",
                    "plan_name": "Mensal",
                    "amount": 200.0,
                },
                {
                    "owner_id": "own_1",
                    "contract_id": "ctr_2",
                    "status": "past_due",
                    "plan_name": "VIP",
                    "amount": 150.0,
                },
            ]
        )


def _matches(doc: dict, query: dict) -> bool:
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(doc, option) for option in expected):
                return False
            continue

        value = doc.get(key)
        if isinstance(expected, dict):
            for op, op_value in expected.items():
                if op == "$lt" and not (value is not None and value < op_value):
                    return False
                if op == "$lte" and not (value is not None and value <= op_value):
                    return False
                if op == "$gt" and not (value is not None and value > op_value):
                    return False
                if op == "$gte" and not (value is not None and value >= op_value):
                    return False
                if op == "$in" and value not in op_value:
                    return False
                if op == "$exists":
                    exists = key in doc and doc.get(key) is not None
                    if bool(op_value) != exists:
                        return False
            continue

        if value != expected:
            return False
    return True


@pytest.mark.asyncio
async def test_dashboard_returns_kpis_and_recent_accesses(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(gyms, "get_db", lambda: db)

    stats = await gyms.dashboard(owner={"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"})

    assert stats["total_alunos"] == 3
    assert stats["alunos_ativos"] == 2
    assert stats["alunos_inativos"] == 1
    assert stats["alunos_sem_treino"] == 2
    assert stats["faturamento_mensal"] == 320.0
    assert stats["ocupacao_atual"] == 2
    assert len(stats["ultimos_acessos"]) >= 1


@pytest.mark.asyncio
async def test_dashboard_hides_revenue_for_reception(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(gyms, "get_db", lambda: db)

    stats = await gyms.dashboard(owner={"owner_id": "own_1", "gym_id": "gym_1", "role": "RECEPTION"})
    charts = await gyms.dashboard_charts(
        owner={"owner_id": "own_1", "gym_id": "gym_1", "role": "RECEPTION"}
    )

    assert stats["faturamento_mensal"] is None
    assert charts["receita_por_plano"] == []
    assert charts["receita_mensal"] == []
    assert len(charts["acessos_por_hora"]) == 24


@pytest.mark.asyncio
async def test_dashboard_charts_returns_aggregated_series(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(gyms, "get_db", lambda: db)

    charts = await gyms.dashboard_charts(
        owner={"owner_id": "own_1", "gym_id": "gym_1", "role": "OWNER"}
    )

    assert len(charts["receita_por_plano"]) == 2
    assert charts["receita_por_plano"][0]["valor"] >= charts["receita_por_plano"][1]["valor"]
    assert len(charts["acessos_por_hora"]) == 24
    assert len(charts["receita_mensal"]) == 6
    assert round(sum(item["valor"] for item in charts["receita_mensal"]), 2) == 320.0
