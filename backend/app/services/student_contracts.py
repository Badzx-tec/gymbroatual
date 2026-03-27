import secrets
from datetime import datetime, timedelta

from app.core.config import get_settings
from app.core.time import UTC, add_sao_paulo_calendar_months, coerce_datetime_utc

TERMINAL_CONTRACT_STATUSES = {"canceled", "expired", "ended"}
MANAGEABLE_CONTRACT_STATUSES = {
    "draft",
    "pending_activation",
    "active",
    "frozen",
    "scheduled_cancel",
    "scheduled_freeze",
}
ACTIVE_LIKE_CONTRACT_STATUSES = {
    "pending_activation",
    "active",
    "frozen",
    "scheduled_cancel",
    "scheduled_freeze",
}
AUTO_STATUS_SOURCE_FINANCIAL = "financeiro_inadimplente"
MIN_CONTRACT_AMOUNT = 0.01
DEFAULT_DURATION_DAYS = 30
DEFAULT_DURATION_UNIT = "days"


def student_billing_grace_days() -> int:
    settings = get_settings()
    return max(0, int(getattr(settings, "student_billing_grace_days", 3) or 3))


def student_billing_retry_offsets_days() -> list[int]:
    settings = get_settings()
    raw = str(getattr(settings, "student_billing_retry_offsets_days", "1,3,7") or "1,3,7")
    parsed: list[int] = []
    for token in raw.split(","):
        item = token.strip()
        if not item:
            continue
        try:
            value = int(item)
        except ValueError:
            continue
        if value > 0:
            parsed.append(value)
    if not parsed:
        return [1, 3, 7]
    return sorted(set(parsed))


def clean_doc(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    sanitized = dict(doc)
    sanitized.pop("_id", None)
    return sanitized


def money_value(value, *, default: float = 0.0) -> float:
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return round(float(default), 2)


def utc_now() -> datetime:
    return datetime.now(UTC)


def normalize_duration_unit(value) -> str:
    raw = str(value or "").strip().lower()
    if raw == "months":
        return "months"
    return DEFAULT_DURATION_UNIT


def resolve_duration_fields(
    *,
    duration_unit=None,
    duration_value=None,
    duration_days=None,
    default_days: int | None = DEFAULT_DURATION_DAYS,
) -> tuple[str, int]:
    if duration_value is None:
        if duration_days is not None:
            duration_value = duration_days
            duration_unit = duration_unit or "days"
        else:
            duration_value = default_days or DEFAULT_DURATION_DAYS
            duration_unit = duration_unit or DEFAULT_DURATION_UNIT
    unit = normalize_duration_unit(duration_unit)
    safe_value = max(1, int(duration_value or 1))
    return unit, safe_value


def duration_days_compatibility(
    *,
    start: datetime | None,
    duration_unit: str,
    duration_value: int,
) -> int:
    if normalize_duration_unit(duration_unit) == "days":
        return max(1, int(duration_value or 1))
    if not start:
        return max(1, int(duration_value or 1) * 30)
    computed_end = period_end(
        start,
        duration_unit=duration_unit,
        duration_value=duration_value,
    )
    return max(1, int((computed_end - start).total_seconds() // 86400))


def billing_cycle_from_duration_fields(*, duration_unit: str, duration_value: int) -> str:
    normalized_unit = normalize_duration_unit(duration_unit)
    safe_value = max(1, int(duration_value or 1))
    if normalized_unit == "months":
        if safe_value == 1:
            return "monthly"
        if safe_value == 3:
            return "quarterly"
        if safe_value == 6:
            return "semiannual"
        if safe_value == 12:
            return "annual"
        return "custom_days"
    return billing_cycle_from_duration(safe_value)


def period_end(
    start: datetime,
    duration_days: int | None = None,
    *,
    duration_unit: str | None = None,
    duration_value: int | None = None,
) -> datetime:
    safe_start = coerce_datetime_utc(start) or utc_now()
    resolved_unit, resolved_value = resolve_duration_fields(
        duration_unit=duration_unit,
        duration_value=duration_value,
        duration_days=duration_days,
    )
    if resolved_unit == "months":
        shifted = add_sao_paulo_calendar_months(safe_start, resolved_value)
        return shifted or safe_start
    return safe_start + timedelta(days=resolved_value)


def resolve_contract_amounts(
    *,
    base_amount,
    discount_amount=0.0,
) -> tuple[float, float, float]:
    gross = money_value(base_amount)
    discount = money_value(discount_amount)
    if gross <= 0:
        raise ValueError("Valor base do contrato invalido")
    if discount < 0:
        raise ValueError("Desconto invalido")
    net = money_value(gross - discount)
    if net < MIN_CONTRACT_AMOUNT:
        raise ValueError("Desconto nao pode zerar ou negativar o contrato")
    return gross, discount, net


def sync_contract_amount_fields(contract: dict) -> dict:
    normalized = dict(contract)
    current_amount = money_value(normalized.get("amount"))
    base_amount = normalized.get("original_amount")
    discount_amount = normalized.get("discount_amount")

    if base_amount is None:
        base_amount = current_amount
    if discount_amount is None:
        discount_amount = max(0.0, money_value(base_amount) - current_amount)

    gross = money_value(base_amount, default=current_amount)
    discount = max(0.0, money_value(discount_amount))
    net = money_value(gross - discount)

    if net < MIN_CONTRACT_AMOUNT:
        if current_amount >= MIN_CONTRACT_AMOUNT:
            net = current_amount
            gross = max(gross, net)
            discount = max(0.0, money_value(gross - net))
        else:
            gross = max(gross, MIN_CONTRACT_AMOUNT)
            discount = 0.0
            net = gross

    normalized["original_amount"] = gross
    normalized["discount_amount"] = discount
    normalized["amount"] = net
    return normalized


def billing_cycle_from_duration(duration_days: int | None) -> str:
    days = int(duration_days or 0)
    if days == 30:
        return "monthly"
    if days == 90:
        return "quarterly"
    if days == 180:
        return "semiannual"
    if days in {360, 365}:
        return "annual"
    return "custom_days"


def legacy_status(contract_status: str, financial_status: str) -> str:
    normalized_contract = str(contract_status or "").lower()
    normalized_financial = str(financial_status or "").lower()
    if normalized_contract == "canceled":
        return "canceled"
    if normalized_contract in {"expired", "ended"}:
        return "expired"
    if normalized_financial in {"overdue", "failed"}:
        return "past_due"
    return "active"


def contract_status_from_legacy(legacy: str) -> str:
    normalized = str(legacy or "").lower()
    if normalized == "canceled":
        return "canceled"
    if normalized == "expired":
        return "expired"
    return "active"


def financial_status_from_legacy(legacy: str) -> str:
    normalized = str(legacy or "").lower()
    if normalized == "past_due":
        return "overdue"
    if normalized in {"canceled", "expired"}:
        return "pending"
    return "paid"


def infer_access_status(
    contract_status: str,
    financial_status: str,
    *,
    now: datetime,
    grace_until: datetime | None = None,
) -> str:
    normalized_contract = str(contract_status or "").lower()
    normalized_financial = str(financial_status or "").lower()
    if normalized_contract in {"canceled", "expired", "ended"}:
        return "blocked"
    if normalized_contract == "frozen":
        return "suspended"
    if normalized_financial in {"overdue", "failed"}:
        if grace_until and grace_until >= now:
            return "grace_period"
        return "blocked"
    return "allowed"


def derive_student_operational_status(
    *,
    current_status: str | None,
    current_auto_source: str | None,
    contract_access_status: str | None,
    contract_financial_status: str | None,
) -> tuple[str, str | None]:
    normalized_status = str(current_status or "ativo").strip().lower()
    if normalized_status != "inativo":
        normalized_status = "ativo"

    normalized_auto_source = str(current_auto_source or "").strip().lower() or None
    normalized_access = str(contract_access_status or "").strip().lower()
    normalized_financial = str(contract_financial_status or "").strip().lower()

    delinquent_blocked = normalized_access in {"blocked", "suspended"} and normalized_financial in {
        "overdue",
        "failed",
    }
    if delinquent_blocked:
        # Only control status automatically when the student is active or already controlled by finance.
        if normalized_status == "ativo" or normalized_auto_source == AUTO_STATUS_SOURCE_FINANCIAL:
            return "inativo", AUTO_STATUS_SOURCE_FINANCIAL
        return normalized_status, normalized_auto_source

    back_in_good_standing = normalized_access in {"allowed", "grace_period"} and normalized_financial not in {
        "overdue",
        "failed",
    }
    if back_in_good_standing and normalized_auto_source == AUTO_STATUS_SOURCE_FINANCIAL:
        return "ativo", None

    return normalized_status, normalized_auto_source


def _close_open_freeze_period(contract: dict, *, resumed_at: datetime):
    for item in reversed(contract.get("freeze_periods", [])):
        if not item.get("resumed_at"):
            item["resumed_at"] = resumed_at
            return


def _apply_scheduled_actions(contract: dict, *, now: datetime) -> list[dict]:
    applied: list[dict] = []
    actions = []
    for raw_action in list(contract.get("scheduled_actions", [])):
        action = dict(raw_action)
        action_status = str(action.get("status") or "pending").lower()
        effective_at = coerce_datetime_utc(action.get("effective_at"))
        action_type = str(action.get("action_type") or "").lower()
        if action_status != "pending" or not effective_at or not action_type:
            actions.append(action)
            continue
        if effective_at > now:
            actions.append(action)
            continue

        action["status"] = "applied"
        action["applied_at"] = now
        if action_type == "cancel":
            if str(contract.get("contract_status") or "").lower() not in TERMINAL_CONTRACT_STATUSES:
                contract["contract_status"] = "canceled"
                contract["cancel_reason"] = action.get("reason") or contract.get("cancel_reason")
                contract["canceled_at"] = effective_at
                contract["ended_at"] = effective_at
                contract["auto_renew"] = False
                applied.append(
                    {
                        "event_type": "contract_canceled_scheduled",
                        "payload": {
                            "effective_at": effective_at.isoformat(),
                            "reason": action.get("reason"),
                        },
                    }
                )
        elif action_type == "freeze":
            if str(contract.get("contract_status") or "").lower() in {
                "active",
                "pending_activation",
                "scheduled_freeze",
            }:
                freeze_end_at = coerce_datetime_utc(action.get("freeze_end_at"))
                contract["contract_status"] = "frozen"
                contract["freeze_reason"] = action.get("reason") or contract.get("freeze_reason")
                contract["frozen_from"] = effective_at
                contract["frozen_until"] = freeze_end_at
                contract["extend_end_by_frozen_days"] = bool(
                    action.get("extend_end_by_frozen_days", True)
                )
                freeze_period = {
                    "started_at": effective_at,
                    "resume_expected_at": freeze_end_at,
                    "resumed_at": None,
                    "reason": action.get("reason"),
                    "source": "scheduled",
                }
                contract.setdefault("freeze_periods", []).append(freeze_period)
                applied.append(
                    {
                        "event_type": "contract_frozen_scheduled",
                        "payload": {
                            "effective_at": effective_at.isoformat(),
                            "freeze_end_at": freeze_end_at.isoformat() if freeze_end_at else None,
                            "reason": action.get("reason"),
                        },
                    }
                )
        actions.append(action)

    contract["scheduled_actions"] = actions
    return applied


def normalize_contract_document(contract: dict, *, now: datetime | None = None) -> tuple[dict, list[dict], bool]:
    current_now = now or utc_now()
    normalized = dict(contract)
    original = dict(contract)
    events: list[dict] = []

    start = coerce_datetime_utc(
        normalized.get("current_period_start") or normalized.get("start_at") or normalized.get("created_at")
    ) or current_now
    duration_unit, duration_value = resolve_duration_fields(
        duration_unit=normalized.get("duration_unit"),
        duration_value=normalized.get("duration_value"),
        duration_days=normalized.get("duration_days"),
        default_days=normalized.get("duration_days") or DEFAULT_DURATION_DAYS,
    )
    duration_days = duration_days_compatibility(
        start=start,
        duration_unit=duration_unit,
        duration_value=duration_value,
    )
    end = coerce_datetime_utc(normalized.get("current_period_end") or normalized.get("end_at"))
    if not end:
        end = period_end(
            start,
            duration_unit=duration_unit,
            duration_value=duration_value,
        )

    legacy = str(normalized.get("status") or "").lower()
    contract_status = str(normalized.get("contract_status") or contract_status_from_legacy(legacy)).lower()
    financial_status = str(
        normalized.get("financial_status") or financial_status_from_legacy(legacy)
    ).lower()

    normalized.setdefault(
        "billing_cycle",
        billing_cycle_from_duration_fields(
            duration_unit=duration_unit,
            duration_value=duration_value,
        ),
    )
    normalized.setdefault("billing_day", min(max(start.day, 1), 28))
    normalized.setdefault("manual_overrides", [])
    normalized.setdefault("scheduled_actions", [])
    normalized.setdefault("freeze_periods", [])
    normalized.setdefault("auto_renew", False)
    normalized.setdefault("amount", float(normalized.get("amount") or 0))
    normalized.setdefault("original_amount", normalized.get("amount"))
    normalized.setdefault("discount_amount", 0.0)
    normalized.setdefault("currency", "BRL")
    normalized.setdefault("duration_unit", duration_unit)
    normalized.setdefault("duration_value", duration_value)
    normalized.setdefault("duration_days", duration_days)
    normalized.setdefault("manual_end_override", bool(normalized.get("manual_end_override", False)))
    normalized.setdefault("grace_until", None)
    normalized.setdefault("dunning_level", 0)
    normalized.setdefault("next_retry_at", None)
    normalized.setdefault("schema_version", 2)
    normalized.setdefault("migrated_from_contract_id", None)

    normalized["current_period_start"] = start
    normalized["current_period_end"] = end
    normalized["duration_unit"] = duration_unit
    normalized["duration_value"] = duration_value
    normalized["duration_days"] = duration_days
    normalized["contract_status"] = contract_status
    normalized["financial_status"] = financial_status
    normalized = sync_contract_amount_fields(normalized)

    events.extend(_apply_scheduled_actions(normalized, now=current_now))
    contract_status = str(normalized.get("contract_status") or contract_status).lower()

    if contract_status == "pending_activation" and start <= current_now:
        normalized["contract_status"] = "active"
        contract_status = "active"
        events.append(
            {
                "event_type": "contract_activated",
                "payload": {"activated_at": current_now.isoformat()},
            }
        )

    frozen_until = coerce_datetime_utc(normalized.get("frozen_until"))
    frozen_from = coerce_datetime_utc(normalized.get("frozen_from"))
    if contract_status == "frozen" and frozen_until and current_now >= frozen_until:
        if bool(normalized.get("extend_end_by_frozen_days", True)) and frozen_from:
            frozen_days = max(0, (frozen_until.date() - frozen_from.date()).days)
            normalized["current_period_end"] = normalized["current_period_end"] + timedelta(
                days=frozen_days
            )
        normalized["contract_status"] = "active"
        normalized["frozen_from"] = None
        normalized["frozen_until"] = None
        _close_open_freeze_period(normalized, resumed_at=frozen_until)
        contract_status = "active"
        events.append(
            {
                "event_type": "contract_resumed_auto",
                "payload": {"resumed_at": frozen_until.isoformat()},
            }
        )

    if (
        contract_status in {"active", "pending_activation", "scheduled_cancel", "scheduled_freeze"}
        and normalized["current_period_end"] < current_now
        and not bool(normalized.get("auto_renew"))
    ):
        normalized["contract_status"] = "expired"
        normalized["ended_at"] = normalized.get("ended_at") or normalized["current_period_end"]
        contract_status = "expired"
        events.append(
            {
                "event_type": "contract_expired",
                "payload": {"ended_at": normalized["ended_at"].isoformat()},
            }
        )

    grace_until = coerce_datetime_utc(normalized.get("grace_until"))
    normalized["access_status"] = infer_access_status(
        normalized["contract_status"],
        normalized["financial_status"],
        now=current_now,
        grace_until=grace_until,
    )
    normalized["status"] = legacy_status(
        normalized["contract_status"],
        normalized["financial_status"],
    )

    if normalized.get("next_billing_at") is None:
        normalized["next_billing_at"] = normalized["current_period_end"]

    changed = normalized != original
    return normalized, events, changed


async def compute_financial_status(
    db,
    *,
    owner_id: str,
    contract_id: str,
    now: datetime | None = None,
) -> str:
    current_now = now or utc_now()
    if not hasattr(db, "student_charges"):
        return "pending"
    failed = await db.student_charges.find_one(
        {"owner_id": owner_id, "contract_id": contract_id, "status": "failed"},
        {"_id": 0, "charge_id": 1},
    )
    if failed:
        return "failed"

    overdue = await db.student_charges.find_one(
        {
            "owner_id": owner_id,
            "contract_id": contract_id,
            "$or": [
                {"status": "overdue"},
                {"status": "open", "due_at": {"$lt": current_now}},
                {"status": "partially_paid", "due_at": {"$lt": current_now}},
            ],
        },
        {"_id": 0, "charge_id": 1},
    )
    if overdue:
        return "overdue"

    partial = await db.student_charges.find_one(
        {"owner_id": owner_id, "contract_id": contract_id, "status": "partially_paid"},
        {"_id": 0, "charge_id": 1},
    )
    if partial:
        return "partially_paid"

    pending = await db.student_charges.find_one(
        {"owner_id": owner_id, "contract_id": contract_id, "status": "open"},
        {"_id": 0, "charge_id": 1},
    )
    if pending:
        return "pending"

    paid = await db.student_charges.find_one(
        {"owner_id": owner_id, "contract_id": contract_id, "status": "paid"},
        {"_id": 0, "charge_id": 1},
    )
    if paid:
        return "paid"

    refunded = await db.student_charges.find_one(
        {"owner_id": owner_id, "contract_id": contract_id, "status": "refunded"},
        {"_id": 0, "charge_id": 1},
    )
    if refunded:
        return "refunded"
    return "pending"


async def compute_next_billing_at(
    db,
    *,
    owner_id: str,
    contract_id: str,
) -> datetime | None:
    if not hasattr(db, "student_charges"):
        return None
    cursor = (
        db.student_charges.find(
            {
                "owner_id": owner_id,
                "contract_id": contract_id,
                "status": {"$in": ["open", "overdue", "partially_paid"]},
            },
            {"_id": 0, "due_at": 1},
        )
        .sort("due_at", 1)
        .limit(1)
    )
    items = await cursor.to_list(1)
    if not items:
        return None
    return coerce_datetime_utc(items[0].get("due_at"))


async def compute_dunning_snapshot(
    db,
    *,
    owner_id: str,
    contract_id: str,
    now: datetime | None = None,
) -> dict:
    current_now = now or utc_now()
    if not hasattr(db, "student_charges"):
        return {"dunning_level": 0, "next_retry_at": None, "grace_until": None}

    anchor_doc = (
        await db.student_charges.find(
            {
                "owner_id": owner_id,
                "contract_id": contract_id,
                "$or": [
                    {"status": "overdue"},
                    {"status": "failed"},
                    {"status": "open", "due_at": {"$lt": current_now}},
                    {"status": "partially_paid", "due_at": {"$lt": current_now}},
                ],
            },
            {"_id": 0, "due_at": 1},
        )
        .sort("due_at", 1)
        .limit(1)
        .to_list(1)
    )
    if not anchor_doc:
        return {"dunning_level": 0, "next_retry_at": None, "grace_until": None}

    anchor_due = coerce_datetime_utc(anchor_doc[0].get("due_at")) or current_now
    days_overdue = max(0, (current_now.date() - anchor_due.date()).days)
    offsets = student_billing_retry_offsets_days()
    dunning_level = 0
    for offset in offsets:
        if days_overdue >= offset:
            dunning_level += 1
    next_retry_at = None
    if dunning_level < len(offsets):
        next_retry_at = anchor_due + timedelta(days=offsets[dunning_level])
    grace_until = anchor_due + timedelta(days=student_billing_grace_days())

    return {
        "dunning_level": dunning_level,
        "next_retry_at": next_retry_at,
        "grace_until": grace_until,
    }


async def refresh_contract_state(
    db,
    contract: dict,
    *,
    now: datetime | None = None,
    persist: bool = True,
) -> tuple[dict, list[dict], bool]:
    current_now = now or utc_now()
    normalized, events, changed = normalize_contract_document(contract, now=current_now)
    computed_financial_status = await compute_financial_status(
        db,
        owner_id=normalized["owner_id"],
        contract_id=normalized["contract_id"],
        now=current_now,
    )
    if computed_financial_status != normalized.get("financial_status"):
        normalized["financial_status"] = computed_financial_status
        changed = True

    if computed_financial_status in {"overdue", "failed"}:
        dunning = await compute_dunning_snapshot(
            db,
            owner_id=normalized["owner_id"],
            contract_id=normalized["contract_id"],
            now=current_now,
        )
        desired_level = int(dunning.get("dunning_level") or 0)
        desired_retry = coerce_datetime_utc(dunning.get("next_retry_at"))
        desired_grace = coerce_datetime_utc(dunning.get("grace_until"))
        if int(normalized.get("dunning_level") or 0) != desired_level:
            normalized["dunning_level"] = desired_level
            changed = True
        if coerce_datetime_utc(normalized.get("next_retry_at")) != desired_retry:
            normalized["next_retry_at"] = desired_retry
            changed = True
        if coerce_datetime_utc(normalized.get("grace_until")) != desired_grace:
            normalized["grace_until"] = desired_grace
            changed = True
    else:
        if int(normalized.get("dunning_level") or 0) != 0:
            normalized["dunning_level"] = 0
            changed = True
        if coerce_datetime_utc(normalized.get("next_retry_at")) is not None:
            normalized["next_retry_at"] = None
            changed = True
        if coerce_datetime_utc(normalized.get("grace_until")) is not None:
            normalized["grace_until"] = None
            changed = True

    normalized["status"] = legacy_status(
        normalized["contract_status"],
        normalized["financial_status"],
    )
    normalized["access_status"] = infer_access_status(
        normalized["contract_status"],
        normalized["financial_status"],
        now=current_now,
        grace_until=coerce_datetime_utc(normalized.get("grace_until")),
    )

    next_billing_at = await compute_next_billing_at(
        db,
        owner_id=normalized["owner_id"],
        contract_id=normalized["contract_id"],
    )
    fallback_next_billing = coerce_datetime_utc(normalized.get("current_period_end"))
    resolved_next_billing = next_billing_at or fallback_next_billing
    if resolved_next_billing != coerce_datetime_utc(normalized.get("next_billing_at")):
        normalized["next_billing_at"] = resolved_next_billing
        changed = True

    if changed:
        normalized["updated_at"] = current_now
        if persist and hasattr(db.student_contracts, "update_one"):
            await db.student_contracts.update_one(
                {"owner_id": normalized["owner_id"], "contract_id": normalized["contract_id"]},
                {"$set": normalized},
            )
    return normalized, events, changed


def append_manual_override(
    contract: dict,
    *,
    field: str,
    before,
    after,
    reason: str | None,
    actor: dict,
    now: datetime,
) -> None:
    if before == after:
        return
    contract.setdefault("manual_overrides", []).append(
        {
            "override_id": f"ovr_{secrets.token_hex(6)}",
            "field": field,
            "before": before,
            "after": after,
            "reason": reason,
            "actor_type": actor.get("actor_type"),
            "actor_role": actor.get("role"),
            "actor_id": actor.get("owner_id")
            or actor.get("employee_id")
            or actor.get("student_id"),
            "created_at": now,
        }
    )


def ensure_transition(contract: dict, *, allowed_from: set[str], action: str) -> None:
    current = str(contract.get("contract_status") or "").lower()
    if current not in allowed_from:
        allowed = ", ".join(sorted(allowed_from))
        raise ValueError(f"Nao e possivel {action} com status atual '{current}'. Permitidos: {allowed}")
