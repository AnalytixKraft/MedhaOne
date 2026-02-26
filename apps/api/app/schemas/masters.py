from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr

from app.models.enums import PartyType


class PartyBase(BaseModel):
    name: str
    party_type: PartyType
    phone: str | None = None
    email: EmailStr | None = None
    address: str | None = None
    is_active: bool = True


class PartyCreate(PartyBase):
    pass


class PartyUpdate(BaseModel):
    name: str | None = None
    party_type: PartyType | None = None
    phone: str | None = None
    email: EmailStr | None = None
    address: str | None = None
    is_active: bool | None = None


class PartyRead(PartyBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


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
    barcode: str | None = None
    hsn: str | None = None
    gst_rate: Decimal | None = None
    is_active: bool = True


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    sku: str | None = None
    name: str | None = None
    brand: str | None = None
    uom: str | None = None
    barcode: str | None = None
    hsn: str | None = None
    gst_rate: Decimal | None = None
    is_active: bool | None = None


class ProductRead(ProductBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
