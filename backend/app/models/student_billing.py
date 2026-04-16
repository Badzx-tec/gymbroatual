from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

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
DurationUnit = Literal["days", "months"]


def _normalize_duration_payload(values: dict, *, days_key: str) -> dict:
    raw_unit = values.get("duration_unit")
    raw_value = values.get("duration_value")
    raw_days = values.get(days_key)

    unit = str(raw_unit or "").strip().lower() or None
    if unit and unit not in {"days", "months"}:
        raise ValueError("duration_unit invalida")

    if raw_value is None and raw_days is None and raw_unit is None:
        return values

    if raw_value is None:
        if raw_days is None:
            raise ValueError("duration_value obrigatoria quando duration_unit informado")
        raw_value = raw_days
        unit = unit or "days"
    elif unit is None:
        unit = "days"

    try:
        duration_value = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError("duration_value invalido") from exc
    if duration_value < 1:
        raise ValueError("duration_value invalido")

    normalized_unit = unit or "days"
    values["duration_unit"] = normalized_unit
    values["duration_value"] = duration_value
    values[days_key] = duration_value if normalized_unit == "days" else duration_value * 30
    return values


class ContractCreateIn(BaseModel):
    student_id: str
    plan_id: str | None = None
    amount: float | None = Field(default=None, gt=0)
    discount_amount: float = Field(default=0, ge=0)
    duration_unit: DurationUnit | None = None
    duration_value: int | None = Field(default=None, ge=1, le=3650)
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

    @model_validator(mode="before")
    @classmethod
    def normalize_duration_fields(cls, values):
        if not isinstance(values, dict):
            return values
        return _normalize_duration_payload(values, days_key="duration_days")


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
    duration_unit: DurationUnit | None = None
    duration_value: int | None = Field(default=None, ge=1, le=3650)
    duration_days: int | None = Field(default=None, ge=1, le=3650)
    start_at: datetime | None = None
    end_at: datetime | None = None
    create_charge: bool = True
    amount: float | None = Field(default=None, gt=0)
    notes: str | None = Field(default=None, max_length=240)

    @model_validator(mode="before")
    @classmethod
    def normalize_duration_fields(cls, values):
        if not isinstance(values, dict):
            return values
        return _normalize_duration_payload(values, days_key="duration_days")


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
    duration_unit: DurationUnit | None = None
    duration_value: int | None = Field(default=None, ge=1, le=3650)
    duration_days: int | None = Field(default=None, ge=1, le=3650)
    create_initial_charge: bool = True
    notes: str | None = Field(default=None, max_length=240)

    @model_validator(mode="before")
    @classmethod
    def normalize_duration_fields(cls, values):
        if not isinstance(values, dict):
            return values
        return _normalize_duration_payload(values, days_key="duration_days")


class ContractAdjustValidityIn(BaseModel):
    end_at: datetime
    reason: str | None = Field(default=None, max_length=240)


class ContractAdjustBillingIn(BaseModel):
    due_at: datetime | None = None
    billing_day: int | None = Field(default=None, ge=1, le=28)
    update_open_charges: bool = True
    reason: str | None = Field(default=None, max_length=240)

    @model_validator(mode="after")
    def validate_change_request(self):
        if self.due_at is None and self.billing_day is None:
            raise ValueError("Informe due_at e/ou billing_day")
        return self


class ContractArchiveIn(BaseModel):
    reason: str = Field(min_length=3, max_length=240)


class ContractRestoreIn(BaseModel):
    reason: str | None = Field(default=None, max_length=240)


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
    duration_unit: DurationUnit = "days"
    duration_value: int = 30
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
    is_archived: bool = False
    archived_at: datetime | None = None
    archived_reason: str | None = None
    archived_by_actor_id: str | None = None
    archived_by_role: str | None = None
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
