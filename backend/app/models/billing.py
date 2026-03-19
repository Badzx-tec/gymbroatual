from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

SubscriptionStatus = Literal["trialing", "active", "past_due", "canceled", "expired"]
InvoiceStatus = Literal["draft", "open", "paid", "past_due", "canceled"]
PaymentAttemptStatus = Literal["succeeded", "failed", "pending"]
SubscriptionEventSource = Literal["webhook", "reconcile", "manual", "system", "super_admin"]


class SubscriptionStatusOut(BaseModel):
    owner_id: str
    status: SubscriptionStatus
    provider: str
    current_period_end: datetime | None = None
    last_payment_at: datetime | None = None
    grace_until: datetime | None = None
    trial_ends_at: datetime | None = None
    can_login: bool


class CheckoutOut(BaseModel):
    checkout_url: str
    preapproval_id: str | None = None


class MercadoPagoWebhookIn(BaseModel):
    id: str | None = None
    action: str | None = None
    type: str | None = None
    data: dict | None = None
    live_mode: bool | None = None


class MembershipOut(BaseModel):
    membership_id: str
    owner_id: str
    plan_code: str
    amount: float
    currency: str = "BRL"
    provider: str = "mercadopago"
    status: SubscriptionStatus
    started_at: datetime
    trial_ends_at: datetime | None = None
    current_period_start: datetime | None = None
    current_period_end: datetime | None = None
    canceled_at: datetime | None = None
    updated_at: datetime


class InvoiceOut(BaseModel):
    invoice_id: str
    owner_id: str
    period_label: str
    amount: float
    currency: str = "BRL"
    status: InvoiceStatus
    due_date: datetime
    paid_at: datetime | None = None
    provider_reference: str | None = None
    created_at: datetime
    updated_at: datetime


class PaymentAttemptOut(BaseModel):
    attempt_id: str
    owner_id: str
    invoice_id: str | None = None
    amount: float
    currency: str = "BRL"
    status: PaymentAttemptStatus
    provider: str = "mercadopago"
    provider_reference: str | None = None
    reason: str | None = None
    payload: dict | None = None
    created_at: datetime


class SubscriptionEventOut(BaseModel):
    event_id: str
    owner_id: str
    source: SubscriptionEventSource
    event_type: str
    status: str
    metadata: dict | None = None
    created_at: datetime


class BillingOverviewSummaryOut(BaseModel):
    recognized_revenue: float = 0
    outstanding_amount: float = 0
    paid_invoice_count: int = 0
    open_invoice_count: int = 0
    past_due_invoice_count: int = 0
    failed_attempt_count: int = 0
    next_invoice_due_at: datetime | None = None
    last_event_at: datetime | None = None
    action_required: bool = False


class BillingOverviewOut(BaseModel):
    subscription: SubscriptionStatusOut
    membership: MembershipOut
    invoices: list[InvoiceOut] = Field(default_factory=list)
    attempts: list[PaymentAttemptOut] = Field(default_factory=list)
    events: list[SubscriptionEventOut] = Field(default_factory=list)
    summary: BillingOverviewSummaryOut
