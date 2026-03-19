from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

LegacyContractStatus = Literal["active", "past_due", "canceled", "expired"]
ContractLifecycleStatus = Literal[
    "draft",
    "pending_activation",
    "active",
    "frozen",
    "scheduled_cancel",
    "scheduled_freeze",
    "canceled",
    "expired",
    "ended",
]
FinancialStatus = Literal[
    "paid",
    "pending",
    "overdue",
    "failed",
    "refunded",
    "partially_paid",
]
AccessStatus = Literal["allowed", "blocked", "grace_period", "suspended"]
ChargeStatus = Literal["open", "paid", "overdue", "canceled", "failed", "refunded", "partially_paid"]
PaymentMethod = Literal["pix", "card", "cash", "boleto", "transfer", "debit", "other"]
ChargeCleanupScope = Literal["pending", "overdue"]
BillingCycle = Literal["monthly", "quarterly", "semiannual", "annual", "custom_days"]
CancelMode = Literal["immediate", "end_of_cycle", "scheduled"]
ChangePlanMode = Literal["new_contract", "in_place"]


class ContractCreateIn(BaseModel):
    student_id: str
    plan_id: str | None = None
    amount: float | None = Field(default=None, gt=0)
    discount_amount: float = Field(default=0, ge=0)
    duration_days: int | None = Field(default=None, ge=1, le=3650)
    billing_cycle: BillingCycle = "custom_days"
    billing_day: int | None = Field(default=None, ge=1, le=28)
    start_at: datetime | None = None
    end_at: datetime | None = None
    auto_renew: bool = False
    payment_method: PaymentMethod | None = None
    notes: str | None = Field(default=None, max_length=1000)
    internal_notes: str | None = Field(default=None, max_length=2000)
    terms_version: str | None = Field(default=None, max_length=100)
    terms_accepted: bool = False
    create_initial_charge: bool = True
    replace_active_contract: bool = False


class ContractUpdateIn(BaseModel):
    amount: float | None = Field(default=None, gt=0)
    discount_amount: float | None = Field(default=None, ge=0)
    end_at: datetime | None = None
    auto_renew: bool | None = None
    billing_day: int | None = Field(default=None, ge=1, le=28)
    payment_method: PaymentMethod | None = None
    notes: str | None = Field(default=None, max_length=1000)
    internal_notes: str | None = Field(default=None, max_length=2000)
    manual_override_reason: str | None = Field(default=None, max_length=240)


class ContractRenewIn(BaseModel):
    duration_days: int | None = Field(default=None, ge=1, le=3650)
    start_at: datetime | None = None
    end_at: datetime | None = None
    create_charge: bool = True
    amount: float | None = Field(default=None, gt=0)
    notes: str | None = Field(default=None, max_length=240)


class ContractFreezeIn(BaseModel):
    start_at: datetime | None = None
    end_at: datetime
    reason: str | None = Field(default=None, max_length=240)
    pause_charges: bool = True
    extend_end_by_frozen_days: bool = True


class ContractResumeIn(BaseModel):
    resume_at: datetime | None = None
    reason: str | None = Field(default=None, max_length=240)


class ContractCancelIn(BaseModel):
    mode: CancelMode = "immediate"
    effective_at: datetime | None = None
    reason: str | None = Field(default=None, max_length=240)
    cancel_recurrence_only: bool = False


class ContractChangePlanIn(BaseModel):
    new_plan_id: str
    mode: ChangePlanMode = "new_contract"
    effective_at: datetime | None = None
    amount: float | None = Field(default=None, gt=0)
    duration_days: int | None = Field(default=None, ge=1, le=3650)
    create_initial_charge: bool = True
    notes: str | None = Field(default=None, max_length=240)


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
    original_amount: float | None = None
    discount_amount: float = 0
    duration_days: int | None = None
    billing_cycle: BillingCycle
    billing_day: int | None = None
    manual_end_override: bool = False
    current_period_start: datetime
    current_period_end: datetime
    next_billing_at: datetime | None = None
    contract_status: ContractLifecycleStatus
    financial_status: FinancialStatus
    access_status: AccessStatus
    status: LegacyContractStatus
    auto_renew: bool
    payment_method: PaymentMethod | None = None
    notes: str | None = None
    internal_notes: str | None = None
    grace_until: datetime | None = None
    dunning_level: int = 0
    next_retry_at: datetime | None = None
    cancel_reason: str | None = None
    freeze_reason: str | None = None
    canceled_at: datetime | None = None
    ended_at: datetime | None = None
    last_payment_at: datetime | None = None
    last_charge_id: str | None = None
    migrated_from_contract_id: str | None = None
    manual_overrides: list[dict] = Field(default_factory=list)
    scheduled_actions: list[dict] = Field(default_factory=list)
    freeze_periods: list[dict] = Field(default_factory=list)
    terms_version: str | None = None
    terms_accepted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ChargeCreateIn(BaseModel):
    amount: float | None = Field(default=None, gt=0)
    due_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=400)
    status: ChargeStatus | None = None


class ChargeMarkPaidIn(BaseModel):
    paid_at: datetime | None = None
    payment_method: PaymentMethod = "other"
    amount_received: float | None = Field(default=None, gt=0)
    external_reference: str | None = None
    extend_contract: bool = False


class ChargeMarkUnpaidIn(BaseModel):
    reason: str | None = Field(default=None, max_length=200)


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
    retry_count: int = 0
    last_retry_at: datetime | None = None
    failure_reason: str | None = None
    notes: str | None = None
    period_start: datetime | None = None
    period_end: datetime | None = None
    created_at: datetime
    updated_at: datetime


class BillingOverviewOut(BaseModel):
    total_contracts: int
    active_contracts: int
    frozen_contracts: int
    scheduled_actions: int
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
    contract_status: ContractLifecycleStatus
    charge_ids: list[str] = Field(default_factory=list)


class ReconcileSummaryOut(BaseModel):
    limit: int
    open_charges_scanned: int
    charge_overdue_marked: int
    contracts_processed: int
    contracts_updated: int
    dunning_step_advanced: int
    grace_started: int
    grace_expired_access_blocked: int


class ReconcileRunOut(BaseModel):
    run_id: str
    owner_id: str
    gym_id: str | None = None
    actor_type: str = "system"
    actor_role: str = "SYSTEM"
    actor_id: str | None = None
    limit: int
    summary: ReconcileSummaryOut
    history_persisted: bool = True
    started_at: datetime
    finished_at: datetime
    duration_ms: int = 0
