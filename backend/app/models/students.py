from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator


class StudentIn(BaseModel):
    nome: str
    email: EmailStr | None = None
    cpf: str | None = None
    telefone: str | None = None
    sexo: str | None = None
    data_nascimento: date | None = None
    altura_cm: float | None = None
    peso_kg: float | None = None
    peso_atual_kg: float | None = None
    idade: int | None = None
    objetivo: str | None = None
    restricoes: str | None = None
    treino: str | None = None
    matricula: str | None = None
    plano_id: str | None = None
    data_vencimento: date | None = None
    dias_frequencia: int | None = None
    tag_rfid: str | None = None
    biometria_id: str | None = None
    auth_login_enabled: bool = True
    status: Literal["ativo", "inativo"] = "ativo"

    @field_validator(
        "telefone",
        "sexo",
        "objetivo",
        "restricoes",
        "treino",
        "matricula",
        "plano_id",
        "tag_rfid",
        "biometria_id",
        mode="before",
    )
    @classmethod
    def empty_optional_string_to_none(cls, value):
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None

    @field_validator("email", mode="before")
    @classmethod
    def empty_email_to_none(cls, value):
        if value is None:
            return None
        cleaned = str(value).strip()
        if not cleaned:
            return None
        return cleaned.lower()

    @field_validator("cpf", mode="before")
    @classmethod
    def normalize_cpf(cls, value):
        if value is None:
            return None
        digits = "".join(ch for ch in str(value) if ch.isdigit())
        if not digits:
            return None
        if len(digits) != 11:
            raise ValueError("CPF deve ter 11 digitos")
        return f"{digits[:3]}.{digits[3:6]}.{digits[6:9]}-{digits[9:]}"

    @field_validator(
        "data_nascimento",
        "data_vencimento",
        "altura_cm",
        "peso_kg",
        "peso_atual_kg",
        "idade",
        "dias_frequencia",
        mode="before",
    )
    @classmethod
    def empty_string_to_none(cls, value):
        if value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("dias_frequencia")
    @classmethod
    def validate_dias_frequencia(cls, value: int | None):
        if value is None:
            return None
        if value < 0:
            raise ValueError("dias_frequencia deve ser maior ou igual a zero")
        return value

    @field_validator("matricula")
    @classmethod
    def normalize_matricula(cls, value: str | None):
        if value is None:
            return None
        return value.upper()


class StudentCreateIn(StudentIn):
    password: str | None = Field(default=None, min_length=8, max_length=128)
    auto_generate_password: bool = False
    force_password_reset: bool = False

    @field_validator("password", mode="before")
    @classmethod
    def empty_password_to_none(cls, value):
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None


class StudentOut(StudentIn):
    student_id: str
    owner_id: str
    gym_id: str
    created_at: datetime
    updated_at: datetime


class MeasurementIn(BaseModel):
    data: date
    peso_kg: float | None = None
    body_fat_percent: float | None = Field(default=None, alias="bf_percent")
    peito_cm: float | None = None
    cintura_cm: float | None = None
    quadril_cm: float | None = None
    braco_cm: float | None = None
    coxa_cm: float | None = None


class WorkoutExercise(BaseModel):
    nome: str
    series: str
    reps: str
    carga: str | None = None
    descanso: str | None = None


class WorkoutPlanIn(BaseModel):
    codigo: str = Field(description="Treino A/B/C")
    exercicios: list[WorkoutExercise]
    observacoes: str | None = None


class AttendanceIn(BaseModel):
    date_time: datetime
    source: Literal["catraca", "app", "manual"] = "app"


class TolletusEnrollStartIn(BaseModel):
    student_id: str
    device_id: str


class TolletusEnrollConfirmIn(BaseModel):
    student_id: str
    device_id: str
    template: str
    external_id: str | None = None


class TolletusStatusOut(BaseModel):
    student_id: str
    has_biometric: bool
    enrolled_at: datetime | None = None
    provider: str | None = None


class TolletusEmployeeEnrollStartIn(BaseModel):
    employee_id: str
    device_id: str


class TolletusEmployeeEnrollConfirmIn(BaseModel):
    employee_id: str
    device_id: str
    template: str
    external_id: str | None = None


class TolletusEmployeeStatusOut(BaseModel):
    employee_id: str
    has_biometric: bool
    enrolled_at: datetime | None = None
    provider: str | None = None
    biometria_id: str | None = None
