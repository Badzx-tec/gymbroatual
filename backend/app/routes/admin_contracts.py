import csv
import re
import secrets
from datetime import timedelta
from io import BytesIO, StringIO

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from app.core.deps import require_roles
from app.db.mongo import get_db
from app.models.student_billing import ContractCancelIn, ContractFreezeIn, ContractRenewIn
from app.services.report_exports import as_text, xlsx_response
from app.services.student_contracts import (
    ACTIVE_LIKE_CONTRACT_STATUSES,
    clean_doc,
    coerce_datetime_utc,
    utc_now,
)

from . import student_billing

router = APIRouter()

ALLOWED_SORT_FIELDS = {
    "status": "contract_status",
    "endDate": "current_period_end",
    "startDate": "current_period_start",
    "updatedAt": "updated_at",
    "value": "amount",
}

CONTRACT_STATUSES = [
    "active",
    "pending_activation",
    "frozen",
    "scheduled_cancel",
    "scheduled_freeze",
    "canceled",
    "expired",
    "ended",
]

PENDING_FINANCIAL_STATUSES = {"pending", "open", "overdue", "failed", "partially_paid"}


class AdminContractPauseIn(BaseModel):
    end_at: str | None = None
    days: int = Field(default=7, ge=1, le=180)
    reason: str | None = Field(default=None, max_length=240)
    pause_charges: bool = True
    extend_end_by_frozen_days: bool = True


def _normalize_sort(sort_by: str, sort_dir: str) -> tuple[str, int]:
    db_field = ALLOWED_SORT_FIELDS.get(str(sort_by or "").strip())
    if not db_field:
        raise HTTPException(status_code=400, detail="sortBy invalido")
    direction = str(sort_dir or "").lower().strip()
    if direction not in {"asc", "desc"}:
        raise HTTPException(status_code=400, detail="sortDir invalido")
    return db_field, -1 if direction == "desc" else 1


def _parse_iso_date(value: str | None, *, field_name: str):
    if value is None:
        return None
    parsed = coerce_datetime_utc(value)
    if not parsed:
        raise HTTPException(status_code=400, detail=f"{field_name} invalido")
    return parsed


def _merge_end_date_range(
    query: dict,
    *,
    gte=None,
    lte=None,
) -> None:
    current = query.get("current_period_end")
    merged = dict(current) if isinstance(current, dict) else {}

    if gte is not None:
        old = merged.get("$gte")
        merged["$gte"] = max(old, gte) if old is not None else gte
    if lte is not None:
        old = merged.get("$lte")
        merged["$lte"] = min(old, lte) if old is not None else lte

    if merged:
        query["current_period_end"] = merged


def _build_contract_query(
    *,
    owner_id: str,
    q: str,
    statuses: list[str],
    plan_ids: list[str],
    start_date,
    end_date,
    expiring_in_days: int | None,
    pending_only: bool,
) -> tuple[dict, dict]:
    now = utc_now()
    normalized_q = str(q or "").strip()
    if len(normalized_q) > 120:
        raise HTTPException(status_code=400, detail="q excede 120 caracteres")

    normalized_statuses = sorted(
        {
            str(item or "").strip().lower()
            for item in statuses
            if str(item or "").strip().lower() in CONTRACT_STATUSES
        }
    )
    normalized_plan_ids = sorted({str(item or "").strip() for item in plan_ids if str(item or "").strip()})

    base_query: dict = {"owner_id": owner_id}
    if normalized_statuses:
        base_query["contract_status"] = {"$in": normalized_statuses}
    if normalized_plan_ids:
        base_query["plan_id"] = {"$in": normalized_plan_ids}
    if start_date:
        base_query["current_period_start"] = {"$gte": start_date}
    if end_date:
        _merge_end_date_range(base_query, lte=end_date)
    if expiring_in_days:
        _merge_end_date_range(base_query, gte=now, lte=now + timedelta(days=int(expiring_in_days)))
    if pending_only:
        base_query["financial_status"] = {"$in": sorted(PENDING_FINANCIAL_STATUSES)}
    if normalized_q:
        escaped = re.escape(normalized_q)
        base_query["$or"] = [
            {"contract_id": {"$regex": escaped, "$options": "i"}},
            {"student_name": {"$regex": escaped, "$options": "i"}},
            {"student_id": {"$regex": escaped, "$options": "i"}},
            {"plan_name": {"$regex": escaped, "$options": "i"}},
            {"plan_id": {"$regex": escaped, "$options": "i"}},
        ]

    totals_query = dict(base_query)
    totals_query.pop("contract_status", None)
    return base_query, totals_query


def _compact_contract_view(contract: dict) -> dict:
    return {
        "contract_id": contract.get("contract_id"),
        "student_id": contract.get("student_id"),
        "student_name": contract.get("student_name"),
        "plan_id": contract.get("plan_id"),
        "plan_name": contract.get("plan_name"),
        "amount": contract.get("amount"),
        "contract_status": contract.get("contract_status"),
        "financial_status": contract.get("financial_status"),
        "access_status": contract.get("access_status"),
        "current_period_start": contract.get("current_period_start"),
        "current_period_end": contract.get("current_period_end"),
        "updated_at": contract.get("updated_at"),
    }


def _extract_contract_from_action_result(result) -> dict:
    if isinstance(result, dict) and isinstance(result.get("contract"), dict):
        return result["contract"]
    if isinstance(result, dict):
        return result
    raise HTTPException(status_code=500, detail="Retorno de acao invalido")


async def _record_contract_audit(
    *,
    actor: dict,
    contract_id: str,
    action: str,
    payload: dict,
    before: dict | None,
    after: dict | None,
) -> str:
    db = get_db()
    doc = {
        "audit_id": f"ca_{secrets.token_hex(8)}",
        "owner_id": actor["owner_id"],
        "gym_id": actor.get("gym_id"),
        "contract_id": contract_id,
        "action": action,
        "actor_type": actor.get("actor_type", "owner"),
        "actor_role": str(actor.get("role") or "").upper() or None,
        "actor_id": actor.get("employee_id") or actor.get("owner_id"),
        "payload": payload or {},
        "before": _compact_contract_view(before or {}),
        "after": _compact_contract_view(after or {}),
        "created_at": utc_now(),
    }
    await db.contract_audit.insert_one(doc)
    return doc["audit_id"]


@router.get("/contratos")
async def list_admin_contracts(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"),
    q: str = Query(default=""),
    sort_by: str = Query(default="updatedAt", alias="sortBy"),
    sort_dir: str = Query(default="desc", alias="sortDir"),
    status: list[str] = Query(default_factory=list),
    plano_id: list[str] = Query(default_factory=list, alias="planoId"),
    start_date_raw: str | None = Query(default=None, alias="startDate"),
    end_date_raw: str | None = Query(default=None, alias="endDate"),
    expiring_in_days: int | None = Query(default=None, ge=1, le=365, alias="expiringInDays"),
    pending_only: bool = Query(default=False, alias="pendingOnly"),
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    role = str(actor.get("role") or "").upper()
    start_date = _parse_iso_date(start_date_raw, field_name="startDate")
    end_date = _parse_iso_date(end_date_raw, field_name="endDate")
    if start_date and end_date and end_date < start_date:
        raise HTTPException(status_code=400, detail="endDate deve ser maior que startDate")

    sort_field, sort_direction = _normalize_sort(sort_by, sort_dir)
    query, totals_query = _build_contract_query(
        owner_id=actor["owner_id"],
        q=q,
        statuses=status,
        plan_ids=plano_id,
        start_date=start_date,
        end_date=end_date,
        expiring_in_days=expiring_in_days,
        pending_only=pending_only,
    )

    total = await db.student_contracts.count_documents(query)
    skip = (page - 1) * page_size
    docs = (
        await db.student_contracts.find(query, {"_id": 0})
        .sort(sort_field, sort_direction)
        .skip(skip)
        .limit(page_size)
        .to_list(page_size)
    )

    contracts: list[dict] = []
    for item in docs:
        refreshed, events, changed = await student_billing.refresh_contract_state(db, item)
        if changed:
            for auto_event in events:
                await student_billing._record_event(
                    owner_id=refreshed["owner_id"],
                    gym_id=refreshed["gym_id"],
                    contract_id=refreshed["contract_id"],
                    event_type=auto_event["event_type"],
                    payload=auto_event.get("payload") or {},
                    actor={"actor_type": "system", "role": "SYSTEM"},
                )
            await student_billing._sync_student_contract_projection(refreshed)
        contracts.append(student_billing._sanitize_contract_for_role(refreshed, role=role))

    contract_ids = [item.get("contract_id") for item in contracts if item.get("contract_id")]
    next_charge_due_by_contract: dict[str, object] = {}
    if contract_ids:
        open_charges = (
            await db.student_charges.find(
                {
                    "owner_id": actor["owner_id"],
                    "contract_id": {"$in": contract_ids},
                    "status": {"$in": ["open", "overdue", "partially_paid"]},
                },
                {"_id": 0, "contract_id": 1, "due_at": 1},
            )
            .sort("due_at", 1)
            .to_list(5000)
        )
        for charge in open_charges:
            contract_id = str(charge.get("contract_id") or "")
            if contract_id and contract_id not in next_charge_due_by_contract:
                next_charge_due_by_contract[contract_id] = charge.get("due_at")

    totals_by_status = {}
    for status_name in CONTRACT_STATUSES:
        totals_by_status[status_name] = await db.student_contracts.count_documents(
            {**totals_query, "contract_status": status_name}
        )

    now = utc_now()
    expiring_query = {**totals_query, "contract_status": {"$in": list(ACTIVE_LIKE_CONTRACT_STATUSES)}}
    _merge_end_date_range(expiring_query, gte=now, lte=now + timedelta(days=7))
    expiring_soon_count = await db.student_contracts.count_documents(expiring_query)
    pending_count = await db.student_contracts.count_documents(
        {**totals_query, "financial_status": {"$in": sorted(PENDING_FINANCIAL_STATUSES)}}
    )
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    canceled_month_count = await db.student_contracts.count_documents(
        {
            **totals_query,
            "contract_status": "canceled",
            "canceled_at": {"$gte": month_start},
        }
    )

    data = []
    for contract in contracts:
        normalized = clean_doc(contract) or {}
        normalized["next_charge_due_at"] = next_charge_due_by_contract.get(normalized.get("contract_id"))
        data.append(normalized)

    return {
        "data": data,
        "meta": {
            "page": page,
            "pageSize": page_size,
            "total": int(total),
            "totalsByStatus": totals_by_status,
            "expiringSoonCount": int(expiring_soon_count),
            "pendingCount": int(pending_count),
            "canceledMonthCount": int(canceled_month_count),
        },
    }


@router.get("/contratos/{contract_id}")
async def get_admin_contract_detail(
    contract_id: str,
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    role = str(actor.get("role") or "").upper()
    contract = await student_billing._load_contract_for_owner(contract_id, actor)
    charges = (
        await db.student_charges.find(
            {"owner_id": actor["owner_id"], "contract_id": contract_id},
            {"_id": 0},
        )
        .sort("due_at", -1)
        .limit(180)
        .to_list(180)
    )
    events = (
        await db.student_billing_events.find(
            {"owner_id": actor["owner_id"], "contract_id": contract_id},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(220)
        .to_list(220)
    )
    audits = (
        await db.contract_audit.find(
            {"owner_id": actor["owner_id"], "contract_id": contract_id},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(120)
        .to_list(120)
    )
    return {
        "contract": student_billing._sanitize_contract_for_role(contract, role=role),
        "charges": [clean_doc(item) for item in charges],
        "events": [student_billing._sanitize_event_for_role(item, role=role) for item in events],
        "audits": [clean_doc(item) for item in audits],
        "capabilities": {
            "can_download_pdf": True,
            "can_cancel": role in {"OWNER", "MANAGER"},
            "can_pause": role in {"OWNER", "MANAGER"},
            "can_renew": role in {"OWNER", "MANAGER", "RECEPTION"},
        },
    }


@router.post("/contratos/{contract_id}/renovar")
async def renew_admin_contract(
    contract_id: str,
    payload: ContractRenewIn | None = None,
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    request_data = payload or ContractRenewIn()
    before = await student_billing._load_contract_for_owner(contract_id, actor, refresh=False)
    result = await student_billing.renew_contract(contract_id=contract_id, payload=request_data, actor=actor)
    after = _extract_contract_from_action_result(result)
    audit_id = await _record_contract_audit(
        actor=actor,
        contract_id=contract_id,
        action="renew",
        payload=request_data.model_dump(exclude_none=True),
        before=before,
        after=after,
    )
    return {
        "contract": clean_doc(after),
        "renewal_charge": clean_doc((result or {}).get("renewal_charge")),
        "audit_id": audit_id,
    }


@router.post("/contratos/{contract_id}/cancelar")
async def cancel_admin_contract(
    contract_id: str,
    payload: ContractCancelIn | None = None,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    request_data = payload or ContractCancelIn(mode="end_of_cycle")
    before = await student_billing._load_contract_for_owner(contract_id, actor, refresh=False)
    result = await student_billing.cancel_contract(contract_id=contract_id, payload=request_data, actor=actor)
    after = _extract_contract_from_action_result(result)
    audit_id = await _record_contract_audit(
        actor=actor,
        contract_id=contract_id,
        action="cancel",
        payload=request_data.model_dump(exclude_none=True),
        before=before,
        after=after,
    )
    return {"contract": clean_doc(after), "audit_id": audit_id}


@router.post("/contratos/{contract_id}/pausar")
async def pause_admin_contract(
    contract_id: str,
    payload: AdminContractPauseIn | None = None,
    actor: dict = Depends(require_roles("OWNER", "MANAGER")),
):
    now = utc_now()
    request_data = payload or AdminContractPauseIn()
    pause_end = coerce_datetime_utc(request_data.end_at) or (now + timedelta(days=int(request_data.days)))
    if pause_end <= now:
        raise HTTPException(status_code=400, detail="end_at deve ser no futuro")

    before = await student_billing._load_contract_for_owner(contract_id, actor, refresh=False)
    freeze_payload = ContractFreezeIn(
        start_at=now,
        end_at=pause_end,
        reason=request_data.reason,
        pause_charges=request_data.pause_charges,
        extend_end_by_frozen_days=request_data.extend_end_by_frozen_days,
    )
    result = await student_billing.freeze_contract(contract_id=contract_id, payload=freeze_payload, actor=actor)
    after = _extract_contract_from_action_result(result)
    audit_id = await _record_contract_audit(
        actor=actor,
        contract_id=contract_id,
        action="pause",
        payload=request_data.model_dump(exclude_none=True),
        before=before,
        after=after,
    )
    return {"contract": clean_doc(after), "audit_id": audit_id}


@router.get("/contratos/{contract_id}/pdf")
async def download_contract_pdf(
    contract_id: str,
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    contract = await student_billing._load_contract_for_owner(contract_id, actor)
    output = BytesIO()
    pdf = canvas.Canvas(output, pagesize=A4)
    width, height = A4
    y = height - 36

    pdf.setTitle(f"Contrato {contract_id}")
    pdf.setFont("Helvetica-Bold", 13)
    pdf.drawString(32, y, "Contrato de Aluno - GymBro")
    y -= 20
    pdf.setFont("Helvetica", 9)
    pdf.drawString(32, y, f"Gerado em: {as_text(utc_now())}")
    y -= 22

    rows = [
        ("Contrato", as_text(contract.get("contract_id"))),
        ("Aluno", as_text(contract.get("student_name"))),
        ("Aluno ID", as_text(contract.get("student_id"))),
        ("Plano", as_text(contract.get("plan_name") or contract.get("plan_id"))),
        ("Status", as_text(contract.get("contract_status"))),
        ("Financeiro", as_text(contract.get("financial_status"))),
        ("Acesso", as_text(contract.get("access_status"))),
        ("Vigencia inicio", as_text(contract.get("current_period_start"))),
        ("Vigencia fim", as_text(contract.get("current_period_end"))),
        ("Valor", as_text(contract.get("amount"))),
        ("Forma pagamento", as_text(contract.get("payment_method"))),
        ("Ultima atualizacao", as_text(contract.get("updated_at"))),
    ]

    for label, value in rows:
        if y < 52:
            pdf.showPage()
            y = height - 36
            pdf.setFont("Helvetica", 9)
        pdf.setFont("Helvetica-Bold", 9)
        pdf.drawString(32, y, f"{label}:")
        pdf.setFont("Helvetica", 9)
        pdf.drawString(170, y, value)
        y -= 15

    pdf.save()
    output.seek(0)
    filename = f"contrato_{contract_id}.pdf"
    return StreamingResponse(
        output,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/contratos/export")
async def export_admin_contracts(
    format: str = Query(default="xlsx"),
    q: str = Query(default=""),
    status: list[str] = Query(default_factory=list),
    plano_id: list[str] = Query(default_factory=list, alias="planoId"),
    start_date_raw: str | None = Query(default=None, alias="startDate"),
    end_date_raw: str | None = Query(default=None, alias="endDate"),
    expiring_in_days: int | None = Query(default=None, ge=1, le=365, alias="expiringInDays"),
    pending_only: bool = Query(default=False, alias="pendingOnly"),
    ids: list[str] = Query(default_factory=list),
    actor: dict = Depends(require_roles("OWNER", "MANAGER", "RECEPTION")),
):
    db = get_db()
    normalized_format = str(format or "").strip().lower()
    if normalized_format not in {"xlsx", "csv"}:
        raise HTTPException(status_code=400, detail="format invalido")

    start_date = _parse_iso_date(start_date_raw, field_name="startDate")
    end_date = _parse_iso_date(end_date_raw, field_name="endDate")
    query, _ = _build_contract_query(
        owner_id=actor["owner_id"],
        q=q,
        statuses=status,
        plan_ids=plano_id,
        start_date=start_date,
        end_date=end_date,
        expiring_in_days=expiring_in_days,
        pending_only=pending_only,
    )
    normalized_ids = sorted({str(item or "").strip() for item in ids if str(item or "").strip()})
    if normalized_ids:
        query["contract_id"] = {"$in": normalized_ids}

    docs = (
        await db.student_contracts.find(query, {"_id": 0})
        .sort("updated_at", -1)
        .limit(6000)
        .to_list(6000)
    )

    headers = [
        "Contrato",
        "Aluno",
        "Aluno ID",
        "Plano",
        "Inicio",
        "Fim",
        "Status",
        "Financeiro",
        "Acesso",
        "Valor",
        "Atualizado em",
    ]
    rows = [
        [
            as_text(item.get("contract_id")),
            as_text(item.get("student_name")),
            as_text(item.get("student_id")),
            as_text(item.get("plan_name") or item.get("plan_id")),
            as_text(item.get("current_period_start")),
            as_text(item.get("current_period_end")),
            as_text(item.get("contract_status")),
            as_text(item.get("financial_status")),
            as_text(item.get("access_status")),
            as_text(item.get("amount")),
            as_text(item.get("updated_at")),
        ]
        for item in docs
    ]

    if normalized_format == "xlsx":
        return xlsx_response("contratos_gymbro.xlsx", "Contratos", headers, rows)

    csv_buffer = StringIO()
    writer = csv.writer(csv_buffer, delimiter=";")
    writer.writerow(headers)
    writer.writerows(rows)
    csv_bytes = csv_buffer.getvalue().encode("utf-8-sig")
    return StreamingResponse(
        BytesIO(csv_bytes),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="contratos_gymbro.csv"'},
    )
