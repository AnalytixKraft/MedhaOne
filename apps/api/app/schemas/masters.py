from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import AliasChoices, BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.domain.quantity import (
    infer_quantity_precision_from_uom,
    normalize_quantity_precision,
)
from app.models.enums import OutstandingTrackingMode, PartyCategory, PartyType, RegistrationType

LEGACY_PARTY_TYPE_VALUES: dict[str, tuple[str, str | None]] = {
    "MANUFACTURER": (PartyType.SUPPLIER.value, PartyCategory.OTHER.value),
    "SUPER_STOCKIST": (PartyType.SUPPLIER.value, PartyCategory.STOCKIST.value),
    "DISTRIBUTOR": (PartyType.SUPPLIER.value, PartyCategory.DISTRIBUTOR.value),
    "HOSPITAL": (PartyType.CUSTOMER.value, PartyCategory.HOSPITAL.value),
    "PHARMACY": (PartyType.CUSTOMER.value, PartyCategory.PHARMACY.value),
    "RETAILER": (PartyType.CUSTOMER.value, PartyCategory.RETAILER.value),
    "CONSUMER": (PartyType.CUSTOMER.value, PartyCategory.OTHER.value),
}


def _coerce_legacy_party_payload(value: Any) -> Any:
    if not isinstance(value, dict):
        return value

    payload = dict(value)
    raw_party_type = payload.get("party_type")
    if isinstance(raw_party_type, str):
        party_type_key = raw_party_type.strip().upper()
        if party_type_key in LEGACY_PARTY_TYPE_VALUES:
            normalized_type, normalized_category = LEGACY_PARTY_TYPE_VALUES[party_type_key]
            payload["party_type"] = normalized_type
            if not payload.get("party_category") and normalized_category:
                payload["party_category"] = normalized_category

    return payload


class PartyBase(BaseModel):
    party_name: str = Field(validation_alias=AliasChoices("party_name", "name"))
    name: str | None = None
    display_name: str | None = None
    party_code: str | None = None
    party_type: PartyType
    party_category: str | None = None
    contact_person: str | None = None
    designation: str | None = None
    mobile: str | None = Field(default=None, validation_alias=AliasChoices("mobile", "phone"))
    phone: str | None = None
    whatsapp_no: str | None = None
    office_phone: str | None = None
    email: EmailStr | None = None
    website: str | None = None
    address_line_1: str | None = Field(default=None, validation_alias=AliasChoices("address_line_1", "address"))
    address: str | None = None
    address_line_2: str | None = None
    state: str | None = None
    city: str | None = None
    pincode: str | None = None
    country: str | None = "India"
    gstin: str | None = None
    pan_number: str | None = None
    registration_type: RegistrationType | None = None
    drug_license_number: str | None = None
    fssai_number: str | None = None
    udyam_number: str | None = None
    credit_limit: Decimal | None = Decimal("0.00")
    payment_terms: str | None = None
    opening_balance: Decimal | None = Decimal("0.00")
    outstanding_tracking_mode: OutstandingTrackingMode | None = OutstandingTrackingMode.BILL_WISE
    is_active: bool = True

    @model_validator(mode="before")
    @classmethod
    def coerce_legacy_payload(cls, value: Any) -> Any:
        return _coerce_legacy_party_payload(value)

    @model_validator(mode="after")
    def sync_legacy_aliases(self) -> "PartyBase":
        self.name = self.party_name
        self.phone = self.mobile
        self.address = self.address_line_1
        return self

    @field_validator("pincode")
    @classmethod
    def validate_pincode(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        if not value.isdigit() or len(value) != 6:
            raise ValueError("PIN Code must be 6 digits")
        return value

    @field_validator("credit_limit", "opening_balance")
    @classmethod
    def validate_non_negative_amount(cls, value: Decimal | None, info) -> Decimal | None:
        if value is None:
            return None
        if info.field_name == "credit_limit" and value < 0:
            raise ValueError("Credit limit cannot be negative")
        return value


class PartyCreate(PartyBase):
    pass


class PartyUpdate(BaseModel):
    party_name: str | None = Field(default=None, validation_alias=AliasChoices("party_name", "name"))
    name: str | None = None
    display_name: str | None = None
    party_code: str | None = None
    party_type: PartyType | None = None
    party_category: str | None = None
    contact_person: str | None = None
    designation: str | None = None
    mobile: str | None = Field(default=None, validation_alias=AliasChoices("mobile", "phone"))
    phone: str | None = None
    whatsapp_no: str | None = None
    office_phone: str | None = None
    email: EmailStr | None = None
    website: str | None = None
    address_line_1: str | None = Field(default=None, validation_alias=AliasChoices("address_line_1", "address"))
    address: str | None = None
    address_line_2: str | None = None
    state: str | None = None
    city: str | None = None
    pincode: str | None = None
    country: str | None = None
    gstin: str | None = None
    pan_number: str | None = None
    registration_type: RegistrationType | None = None
    drug_license_number: str | None = None
    fssai_number: str | None = None
    udyam_number: str | None = None
    credit_limit: Decimal | None = None
    payment_terms: str | None = None
    opening_balance: Decimal | None = None
    outstanding_tracking_mode: OutstandingTrackingMode | None = None
    is_active: bool | None = None

    @model_validator(mode="before")
    @classmethod
    def coerce_legacy_payload(cls, value: Any) -> Any:
        return _coerce_legacy_party_payload(value)

    @model_validator(mode="after")
    def sync_legacy_aliases(self) -> "PartyUpdate":
        if self.party_name is not None:
            self.name = self.party_name
        if self.mobile is not None:
            self.phone = self.mobile
        if self.address_line_1 is not None:
            self.address = self.address_line_1
        return self

    @field_validator("pincode")
    @classmethod
    def validate_pincode(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        if not value.isdigit() or len(value) != 6:
            raise ValueError("PIN Code must be 6 digits")
        return value

    @field_validator("credit_limit")
    @classmethod
    def validate_credit_limit(cls, value: Decimal | None) -> Decimal | None:
        if value is not None and value < 0:
            raise ValueError("Credit limit cannot be negative")
        return value


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


class WarehouseDeleteResult(BaseModel):
    id: int
    action: str
    message: str
    warehouse: WarehouseRead


class WarehouseBulkDeleteRequest(BaseModel):
    ids: list[int]

    @field_validator("ids")
    @classmethod
    def validate_ids(cls, value: list[int]) -> list[int]:
        normalized = [item for item in dict.fromkeys(value) if item > 0]
        if not normalized:
            raise ValueError("At least one warehouse must be selected")
        return normalized


class WarehouseBulkDeleteError(BaseModel):
    id: int | None = None
    message: str


class WarehouseBulkDeleteResult(BaseModel):
    deleted_count: int
    deactivated_count: int
    failed_count: int
    errors: list[WarehouseBulkDeleteError]


class CategoryBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return value.strip()


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()


class CategoryRead(CategoryBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BrandBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return value.strip()


class BrandCreate(BrandBase):
    pass


class BrandUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()


class BrandRead(BrandBase):
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
