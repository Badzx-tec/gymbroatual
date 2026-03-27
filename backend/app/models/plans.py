from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

DurationUnit = Literal["days", "months"]


class PlanBaseIn(BaseModel):
    nome: str = Field(min_length=2, max_length=80)
    valor: float = Field(gt=0, le=100000)
    duration_value: int = Field(ge=1, le=3650)
    duration_unit: DurationUnit = "days"
    duracao_dias: int | None = Field(default=None, ge=1, le=3650)
    descricao: str | None = Field(default=None, max_length=300)
    ativo: bool = True

    @model_validator(mode="before")
    @classmethod
    def normalize_duration_fields(cls, values):
        if not isinstance(values, dict):
            return values

        raw_unit = values.get("duration_unit")
        raw_value = values.get("duration_value")
        raw_days = values.get("duracao_dias")

        unit = str(raw_unit or "").strip().lower() or None
        if unit and unit not in {"days", "months"}:
            raise ValueError("duration_unit invalida")

        if raw_value is None:
            raw_value = raw_days
            unit = unit or "days"
        elif unit is None:
            unit = "days"

        if raw_value is None:
            return values

        try:
            duration_value = int(raw_value)
        except (TypeError, ValueError) as exc:
            raise ValueError("duration_value invalido") from exc
        if duration_value < 1:
            raise ValueError("duration_value invalido")

        normalized_unit = unit or "days"
        values["duration_unit"] = normalized_unit
        values["duration_value"] = duration_value
        values["duracao_dias"] = duration_value if normalized_unit == "days" else duration_value * 30
        return values

    @field_validator("nome", mode="before")
    @classmethod
    def normalize_nome(cls, value):
        cleaned = str(value or "").strip()
        if not cleaned:
            raise ValueError("Nome obrigatorio")
        return cleaned

    @field_validator("descricao", mode="before")
    @classmethod
    def normalize_descricao(cls, value):
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None


class PlanCreateIn(PlanBaseIn):
    plan_id: str | None = Field(default=None, max_length=60)

    @field_validator("plan_id", mode="before")
    @classmethod
    def normalize_plan_id(cls, value):
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None


class PlanUpdateIn(BaseModel):
    nome: str | None = Field(default=None, min_length=2, max_length=80)
    valor: float | None = Field(default=None, gt=0, le=100000)
    duration_value: int | None = Field(default=None, ge=1, le=3650)
    duration_unit: DurationUnit | None = None
    duracao_dias: int | None = Field(default=None, ge=1, le=3650)
    descricao: str | None = Field(default=None, max_length=300)
    ativo: bool | None = None
    updated_at: datetime | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_duration_fields(cls, values):
        if not isinstance(values, dict):
            return values

        raw_unit = values.get("duration_unit")
        raw_value = values.get("duration_value")
        raw_days = values.get("duracao_dias")

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
        values["duracao_dias"] = duration_value if normalized_unit == "days" else duration_value * 30
        return values

    @field_validator("nome", mode="before")
    @classmethod
    def normalize_nome(cls, value):
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None

    @field_validator("descricao", mode="before")
    @classmethod
    def normalize_descricao(cls, value):
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None
