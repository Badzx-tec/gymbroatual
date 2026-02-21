from datetime import datetime
from typing import Literal

from pydantic import BaseModel

SubscriptionStatus = Literal["trialing", "active", "past_due", "canceled", "expired"]


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
