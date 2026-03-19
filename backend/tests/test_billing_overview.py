from datetime import UTC, datetime, timedelta

import pytest

from app.models.billing import (
    BillingOverviewOut,
    BillingOverviewSummaryOut,
    SubscriptionStatusOut,
)
from app.routes import billing


class FakeCursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, field, direction):
        reverse = direction == -1
        self.docs.sort(key=lambda item: item.get(field), reverse=reverse)
        return self

    def limit(self, size):
        self.docs = self.docs[:size]
        return self

    async def to_list(self, length):
        if length is None:
            return list(self.docs)
        return list(self.docs[:length])


class FakeCollection:
    def __init__(self, docs):
        self.docs = list(docs)

    def find(self, query, projection=None):
        docs = [self._project(doc, projection) for doc in self.docs if self._matches(doc, query)]
        return FakeCursor(docs)

    async def count_documents(self, query):
        return sum(1 for doc in self.docs if self._matches(doc, query))

    def aggregate(self, pipeline):
        docs = list(self.docs)
        for stage in pipeline:
            if "$match" in stage:
                docs = [doc for doc in docs if self._matches(doc, stage["$match"])]
            elif "$group" in stage:
                grouped = {}
                for doc in docs:
                    key_expr = stage["$group"]["_id"]
                    if isinstance(key_expr, str) and key_expr.startswith("$"):
                        key = doc.get(key_expr[1:])
                    else:
                        key = key_expr
                    bucket = grouped.setdefault(
                        key,
                        {"_id": key, "count": 0, "amount_total": 0.0},
                    )
                    bucket["count"] += 1
                    bucket["amount_total"] += float(doc.get("amount") or 0)
                docs = list(grouped.values())
        return FakeCursor(docs)

    @staticmethod
    def _project(doc, projection):
        if not projection:
            return dict(doc)
        return {
            key: value
            for key, value in doc.items()
            if projection.get(key, 1) and key != "_id"
        }

    @staticmethod
    def _matches(doc, query):
        for key, value in query.items():
            current = doc.get(key)
            if isinstance(value, dict):
                if "$in" in value and current not in value["$in"]:
                    return False
            elif current != value:
                return False
        return True


class FakeDb:
    def __init__(self, *, invoices, attempts, events):
        self.invoices = FakeCollection(invoices)
        self.payment_attempts = FakeCollection(attempts)
        self.subscription_events = FakeCollection(events)


@pytest.mark.asyncio
async def test_build_billing_overview_summarizes_financial_state(monkeypatch):
    now = datetime(2026, 3, 6, 12, 0, tzinfo=UTC)
    db = FakeDb(
        invoices=[
            {
                "invoice_id": "inv_paid",
                "owner_id": "own_1",
                "period_label": "2026-01",
                "amount": 139.9,
                "status": "paid",
                "due_date": now - timedelta(days=30),
                "paid_at": now - timedelta(days=28),
                "created_at": now - timedelta(days=35),
                "updated_at": now - timedelta(days=28),
            },
            {
                "invoice_id": "inv_open",
                "owner_id": "own_1",
                "period_label": "2026-02",
                "amount": 139.9,
                "status": "open",
                "due_date": now + timedelta(days=2),
                "paid_at": None,
                "created_at": now - timedelta(days=5),
                "updated_at": now - timedelta(days=5),
            },
            {
                "invoice_id": "inv_due",
                "owner_id": "own_1",
                "period_label": "2026-03",
                "amount": 139.9,
                "status": "past_due",
                "due_date": now - timedelta(days=1),
                "paid_at": None,
                "created_at": now - timedelta(days=2),
                "updated_at": now - timedelta(days=1),
            },
        ],
        attempts=[
            {
                "attempt_id": "att_failed",
                "owner_id": "own_1",
                "amount": 139.9,
                "status": "failed",
                "created_at": now - timedelta(hours=6),
            },
            {
                "attempt_id": "att_ok",
                "owner_id": "own_1",
                "amount": 139.9,
                "status": "succeeded",
                "created_at": now - timedelta(days=7),
            },
        ],
        events=[
            {
                "event_id": "evt_recent",
                "owner_id": "own_1",
                "source": "manual",
                "event_type": "checkout_created",
                "status": "trialing",
                "created_at": now - timedelta(hours=3),
            },
            {
                "event_id": "evt_old",
                "owner_id": "own_1",
                "source": "webhook",
                "event_type": "payment_failed",
                "status": "past_due",
                "created_at": now - timedelta(days=1),
            },
        ],
    )

    async def fake_subscription_status(_owner_id):
        return SubscriptionStatusOut(
            owner_id="own_1",
            status="past_due",
            provider="mercadopago",
            current_period_end=now + timedelta(days=30),
            last_payment_at=now - timedelta(days=28),
            grace_until=now + timedelta(days=2),
            trial_ends_at=None,
            can_login=False,
        )

    async def fake_sync_membership(_owner_id, **_kwargs):
        return {
            "membership_id": "mem_1",
            "owner_id": "own_1",
            "plan_code": "owner_monthly",
            "amount": 139.9,
            "currency": "BRL",
            "provider": "mercadopago",
            "status": "past_due",
            "started_at": now - timedelta(days=90),
            "trial_ends_at": None,
            "current_period_start": now - timedelta(days=30),
            "current_period_end": now + timedelta(days=30),
            "canceled_at": None,
            "updated_at": now,
        }

    monkeypatch.setattr(billing, "get_db", lambda: db)
    monkeypatch.setattr(billing, "_subscription_status", fake_subscription_status)
    monkeypatch.setattr(billing, "_sync_membership", fake_sync_membership)

    overview = await billing._build_billing_overview(
        "own_1",
        invoice_limit=2,
        attempt_limit=2,
        event_limit=2,
    )

    assert overview.summary.paid_invoice_count == 1
    assert overview.summary.open_invoice_count == 1
    assert overview.summary.past_due_invoice_count == 1
    assert overview.summary.failed_attempt_count == 1
    assert overview.summary.recognized_revenue == pytest.approx(139.9)
    assert overview.summary.outstanding_amount == pytest.approx(279.8)
    assert overview.summary.next_invoice_due_at == now - timedelta(days=1)
    assert overview.summary.last_event_at == now - timedelta(hours=3)
    assert overview.summary.action_required is True
    assert len(overview.invoices) == 2
    assert overview.invoices[0].invoice_id == "inv_due"
    assert overview.attempts[0].attempt_id == "att_failed"


@pytest.mark.asyncio
async def test_build_billing_overview_accepts_super_admin_and_normalizes_legacy_sources(
    monkeypatch,
):
    now = datetime(2026, 3, 6, 12, 0, tzinfo=UTC)
    db = FakeDb(
        invoices=[],
        attempts=[],
        events=[
            {
                "event_id": "evt_super_admin",
                "owner_id": "own_1",
                "source": "super_admin",
                "event_type": "manual_grace_granted",
                "status": "past_due",
                "metadata": {"reason": "ajuste"},
                "created_at": now,
            },
            {
                "event_id": "evt_legacy",
                "owner_id": "own_1",
                "source": "legacy_job",
                "event_type": "legacy_sync",
                "status": "past_due",
                "created_at": now - timedelta(minutes=5),
            },
        ],
    )

    async def fake_subscription_status(_owner_id):
        return SubscriptionStatusOut(
            owner_id="own_1",
            status="past_due",
            provider="mercadopago",
            current_period_end=now + timedelta(days=30),
            last_payment_at=None,
            grace_until=now + timedelta(days=2),
            trial_ends_at=None,
            can_login=False,
        )

    async def fake_sync_membership(_owner_id, **_kwargs):
        return {
            "membership_id": "mem_1",
            "owner_id": "own_1",
            "plan_code": "owner_monthly",
            "amount": 139.9,
            "currency": "BRL",
            "provider": "mercadopago",
            "status": "past_due",
            "started_at": now - timedelta(days=30),
            "trial_ends_at": None,
            "current_period_start": now - timedelta(days=30),
            "current_period_end": now + timedelta(days=30),
            "canceled_at": None,
            "updated_at": now,
        }

    monkeypatch.setattr(billing, "get_db", lambda: db)
    monkeypatch.setattr(billing, "_subscription_status", fake_subscription_status)
    monkeypatch.setattr(billing, "_sync_membership", fake_sync_membership)

    overview = await billing._build_billing_overview(
        "own_1",
        invoice_limit=2,
        attempt_limit=2,
        event_limit=2,
    )

    assert overview.events[0].source == "super_admin"
    assert overview.events[0].event_type == "manual_grace_granted"
    assert overview.events[1].source == "system"
    assert overview.events[1].metadata["original_source"] == "legacy_job"


@pytest.mark.asyncio
async def test_billing_overview_refreshes_before_returning(monkeypatch):
    calls = {"reconcile": 0, "build": 0}

    async def fake_reconcile(owner_id, limit):
        calls["reconcile"] += 1
        assert owner_id == "own_1"
        assert limit == 1
        return {"updated": 1}

    async def fake_build(owner_id, **kwargs):
        calls["build"] += 1
        assert owner_id == "own_1"
        assert kwargs == {"invoice_limit": 8, "attempt_limit": 6, "event_limit": 4}
        return BillingOverviewOut(
            subscription=SubscriptionStatusOut(
                owner_id="own_1",
                status="active",
                provider="mercadopago",
                current_period_end=None,
                last_payment_at=None,
                grace_until=None,
                trial_ends_at=None,
                can_login=True,
            ),
            membership={
                "membership_id": "mem_1",
                "owner_id": "own_1",
                "plan_code": "owner_monthly",
                "amount": 139.9,
                "currency": "BRL",
                "provider": "mercadopago",
                "status": "active",
                "started_at": datetime(2026, 1, 1, tzinfo=UTC),
                "trial_ends_at": None,
                "current_period_start": None,
                "current_period_end": None,
                "canceled_at": None,
                "updated_at": datetime(2026, 3, 6, tzinfo=UTC),
            },
            summary=BillingOverviewSummaryOut(),
        )

    monkeypatch.setattr(billing, "reconcile_subscriptions", fake_reconcile)
    monkeypatch.setattr(billing, "_build_billing_overview", fake_build)

    result = await billing.billing_overview(
        invoice_limit=8,
        attempt_limit=6,
        event_limit=4,
        refresh=True,
        actor={"owner_id": "own_1", "role": "OWNER"},
    )

    assert calls == {"reconcile": 1, "build": 1}
    assert result.subscription.status == "active"
