from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class PlanBaseIn(BaseModel):
    nome: str = Field(min_length=2, max_length=80)
    valor: float = Field(gt=0, le=100000)
    duracao_dias: int = Field(ge=1, le=3650)
    descricao: str | None = Field(default=None, max_length=300)
    ativo: bool = True

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
    duracao_dias: int | None = Field(default=None, ge=1, le=3650)
    descricao: str | None = Field(default=None, max_length=300)
    ativo: bool | None = None
    updated_at: datetime | None = None

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
