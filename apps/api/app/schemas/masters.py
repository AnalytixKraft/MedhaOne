from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr, field_validator, model_validator

from app.domain.quantity import (
    infer_quantity_precision_from_uom,
    normalize_quantity_precision,
)
from app.models.enums import PartyType


class PartyBase(BaseModel):
    name: str
    party_type: PartyType
    phone: str | None = None
    email: EmailStr | None = None
    address: str | None = None
    state: str | None = None
    city: str | None = None
    pincode: str | None = None
    gstin: str | None = None
    pan_number: str | None = None
    is_active: bool = True


class PartyCreate(PartyBase):
    pass


class PartyUpdate(BaseModel):
    name: str | None = None
    party_type: PartyType | None = None
    phone: str | None = None
    email: EmailStr | None = None
    address: str | None = None
    state: str | None = None
    city: str | None = None
    pincode: str | None = None
    gstin: str | None = None
    pan_number: str | None = None
    is_active: bool | None = None


class PartyRead(PartyBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BulkImportError(BaseModel):
    row: int
    field: str | None = None
    message: str


class BulkImportResult(BaseModel):
    created_count: int
    failed_count: int
    errors: list[BulkImportError]


class WarehouseBase(BaseModel):
    name: str
    code: str
    address: str | None = None
    is_active: bool = True


class WarehouseCreate(WarehouseBase):
    pass


class WarehouseUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    address: str | None = None
    is_active: bool | None = None


class WarehouseRead(WarehouseBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProductBase(BaseModel):
    sku: str
    name: str
    brand: str | None = None
    uom: str
    quantity_precision: int | None = None
    barcode: str | None = None
    hsn: str | None = None
    gst_rate: Decimal | None = None
    is_active: bool = True

    @model_validator(mode="after")
    def apply_default_quantity_precision(self) -> "ProductBase":
        if self.quantity_precision is None:
            self.quantity_precision = infer_quantity_precision_from_uom(self.uom)
        else:
            self.quantity_precision = normalize_quantity_precision(self.quantity_precision)
        return self


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    sku: str | None = None
    name: str | None = None
    brand: str | None = None
    uom: str | None = None
    quantity_precision: int | None = None
    barcode: str | None = None
    hsn: str | None = None
    gst_rate: Decimal | None = None
    is_active: bool | None = None

    @field_validator("quantity_precision")
    @classmethod
    def clamp_quantity_precision(cls, value: int | None) -> int | None:
        if value is None:
            return None
        return normalize_quantity_precision(value)


class ProductRead(ProductBase):
    id: int
    quantity_precision: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
