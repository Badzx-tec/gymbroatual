from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ContractStatus = Literal["active", "past_due", "canceled", "expired"]
ChargeStatus = Literal["open", "paid", "overdue", "canceled"]
PaymentMethod = Literal["pix", "card", "cash", "boleto", "other"]
ChargeCleanupScope = Literal["pending", "overdue"]


class ContractCreateIn(BaseModel):
    student_id: str
    plan_id: str | None = None
    amount: float | None = Field(default=None, gt=0)
    duration_days: int | None = Field(default=None, ge=1, le=3650)
    start_at: datetime | None = None
    auto_renew: bool = False
    notes: str | None = None
    create_initial_charge: bool = True


class ContractOut(BaseModel):
    contract_id: str
    owner_id: str
    gym_id: str
    student_id: str
    student_name: str
    plan_id: str | None = None
    plan_name: str | None = None
    amount: float
    currency: str = "BRL"
    duration_days: int
    current_period_start: datetime
    current_period_end: datetime
    status: ContractStatus
    auto_renew: bool
    notes: str | None = None
    canceled_at: datetime | None = None
    last_payment_at: datetime | None = None
    last_charge_id: str | None = None
    created_at: datetime
    updated_at: datetime


class ChargeCreateIn(BaseModel):
    amount: float | None = Field(default=None, gt=0)
    due_at: datetime | None = None
    notes: str | None = None


class ChargeMarkPaidIn(BaseModel):
    paid_at: datetime | None = None
    payment_method: PaymentMethod = "other"
    amount_received: float | None = Field(default=None, gt=0)
    external_reference: str | None = None
    extend_contract: bool = True


class ChargeCleanupIn(BaseModel):
    status_filter: ChargeCleanupScope = "pending"
    due_before: datetime | None = None
    reason: str | None = Field(default=None, max_length=200)


class ChargeOut(BaseModel):
    charge_id: str
    contract_id: str
    owner_id: str
    gym_id: str
    student_id: str
    amount: float
    currency: str = "BRL"
    due_at: datetime
    status: ChargeStatus
    paid_at: datetime | None = None
    payment_method: PaymentMethod | None = None
    amount_received: float | None = None
    external_reference: str | None = None
    notes: str | None = None
    period_start: datetime | None = None
    period_end: datetime | None = None
    created_at: datetime
    updated_at: datetime


class BillingOverviewOut(BaseModel):
    total_contracts: int
    active_contracts: int
    past_due_contracts: int
    expiring_next_7d: int
    overdue_charges: int
    open_charges: int
    month_received_amount: float


class ChargeCleanupOut(BaseModel):
    contract_id: str
    cleaned_count: int
    status_filter: ChargeCleanupScope
    due_before: datetime | None = None
    contract_status: ContractStatus
    charge_ids: list[str] = Field(default_factory=list)
