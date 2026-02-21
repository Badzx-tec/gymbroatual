from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str = Field(min_length=2)
    gym_name: str = Field(min_length=2)


class VerifyStartIn(BaseModel):
    email: EmailStr


class VerifyConfirmIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class OwnerOut(BaseModel):
    owner_id: str
    name: str
    email: EmailStr
    email_verified: bool
    gym_id: str


class LoginOut(BaseModel):
    token: str
    user: OwnerOut


class ErrorOut(BaseModel):
    code: Literal["NEED_EMAIL_VERIFICATION", "PAYMENT_REQUIRED"]
    detail: str
    checkout_url: str | None = None


class VerificationMeta(BaseModel):
    expires_at: datetime
    remaining_attempts: int
