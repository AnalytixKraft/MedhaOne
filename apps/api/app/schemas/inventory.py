from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import (
    InventoryReason,
    InventoryTxnType,
    StockAdjustmentReason,
    StockAdjustmentType,
)


class InventoryBaseRequest(BaseModel):
    warehouse_id: int
    product_id: int
    batch_id: int
    reason: InventoryReason
    ref_type: str | None = None
    ref_id: str | None = None


class InventoryInRequest(InventoryBaseRequest):
    qty: Decimal = Field(gt=0)
    reason: InventoryReason = InventoryReason.PURCHASE_GRN


class InventoryOutRequest(InventoryBaseRequest):
    qty: Decimal = Field(gt=0)
    reason: InventoryReason = InventoryReason.SALES_DISPATCH


class InventoryAdjustRequest(BaseModel):
    warehouse_id: int
    product_id: int
    batch_id: int
    delta_qty: Decimal
    reason: InventoryReason = InventoryReason.STOCK_ADJUSTMENT


class InventoryActionResponse(BaseModel):
    ledger_id: int
    txn_type: InventoryTxnType
    qty: Decimal
    qty_on_hand: Decimal
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class StockItemRow(BaseModel):
    warehouse_id: int
    warehouse_name: str
    product_id: int
    sku: str
    product_name: str
    quantity_precision: int
    batch_id: int
    batch_no: str
    expiry_date: date
    mfg_date: date | None = None
    mrp: Decimal | None = None
    reference_id: str | None = None
    qty_on_hand: Decimal


class StockItemListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    data: list[StockItemRow]


class StockCorrectionRequest(BaseModel):
    warehouse_id: int
    product_id: int
    source_batch_id: int
    qty_to_reclassify: Decimal = Field(gt=0)
    corrected_batch_no: str
    corrected_expiry_date: date
    corrected_mfg_date: date | None = None
    corrected_mrp: Decimal | None = None
    reference_id: str | None = None
    corrected_reference_id: str | None = None
    reason: str = Field(min_length=1, max_length=120)
    remarks: str | None = None

    @field_validator("corrected_batch_no")
    @classmethod
    def normalize_batch_no(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("corrected_batch_no cannot be empty")
        return normalized

    @field_validator("corrected_expiry_date", "corrected_mfg_date", mode="before")
    @classmethod
    def parse_flexible_date(cls, value: object) -> object:
        if value is None or not isinstance(value, str):
            return value
        normalized = value.strip()
        if not normalized:
            return None
        if "/" in normalized:
            return datetime.strptime(normalized, "%d/%m/%Y").date()
        return normalized

    @field_validator("reference_id", "corrected_reference_id", "reason", "remarks")
    @classmethod
    def normalize_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("corrected_mrp")
    @classmethod
    def validate_corrected_mrp(cls, value: Decimal | None) -> Decimal | None:
        if value is not None and value < 0:
            raise ValueError("corrected_mrp cannot be negative")
        return value


class StockCorrectionResponse(BaseModel):
    id: int
    reference_id: str
    source_batch_id: int
    corrected_batch_id: int
    qty_to_reclassify: Decimal
    source_qty_on_hand: Decimal
    corrected_qty_on_hand: Decimal
    created_at: datetime


class StockCorrectionListItem(BaseModel):
    id: int
    reference_id: str
    product_name: str
    sku: str
    warehouse_name: str
    source_batch_no: str
    source_expiry_date: date
    corrected_batch_no: str
    corrected_expiry_date: date
    qty_to_reclassify: Decimal
    reason: str
    remarks: str | None = None
    created_by_name: str | None = None
    created_at: datetime


class StockCorrectionListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    data: list[StockCorrectionListItem]


class StockAdjustmentCreateRequest(BaseModel):
    warehouse_id: int
    product_id: int
    batch_id: int
    adjustment_type: StockAdjustmentType
    qty: Decimal = Field(gt=0)
    reason: StockAdjustmentReason
    remarks: str | None = None

    @field_validator("remarks")
    @classmethod
    def normalize_remarks(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class StockAdjustmentResponse(BaseModel):
    id: int
    reference_id: str
    ledger_id: int
    txn_type: InventoryTxnType
    qty: Decimal
    before_qty: Decimal
    after_qty: Decimal
    created_at: datetime


class StockAdjustmentListItem(BaseModel):
    id: int
    reference_id: str
    product_name: str
    sku: str
    warehouse_name: str
    batch_no: str
    expiry_date: date
    adjustment_type: StockAdjustmentType
    qty: Decimal
    reason: StockAdjustmentReason
    remarks: str | None = None
    before_qty: Decimal
    after_qty: Decimal
    created_by_name: str | None = None
    created_at: datetime


class StockAdjustmentListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    data: list[StockAdjustmentListItem]
