from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TaxRateBase(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=120)
    rate_percent: Decimal = Field(ge=0, le=100)
    is_active: bool = True

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("label")
    @classmethod
    def normalize_label(cls, value: str) -> str:
        return value.strip()


class TaxRateCreate(TaxRateBase):
    pass


class TaxRateUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=40)
    label: str | None = Field(default=None, min_length=1, max_length=120)
    rate_percent: Decimal | None = Field(default=None, ge=0, le=100)
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip().upper()

    @field_validator("label")
    @classmethod
    def normalize_label(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()


class TaxRateRead(TaxRateBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
