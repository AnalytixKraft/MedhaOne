from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import GrnStatus, PurchaseOrderStatus


class PurchaseOrderLineCreate(BaseModel):
    product_id: int
    ordered_qty: Decimal = Field(gt=0)
    unit_cost: Decimal | None = Field(default=None, ge=0)
    free_qty: Decimal = Field(default=Decimal("0"), ge=0)
    line_notes: str | None = None


class PurchaseOrderCreate(BaseModel):
    supplier_id: int
    warehouse_id: int
    order_date: date = Field(default_factory=date.today)
    expected_date: date | None = None
    notes: str | None = None
    lines: list[PurchaseOrderLineCreate] = Field(min_length=1)


class PurchaseOrderLineResponse(BaseModel):
    id: int
    purchase_order_id: int
    product_id: int
    ordered_qty: Decimal
    received_qty: Decimal
    unit_cost: Decimal | None = None
    free_qty: Decimal
    line_notes: str | None = None

    model_config = ConfigDict(from_attributes=True)


class PurchaseOrderResponse(BaseModel):
    id: int
    po_number: str
    supplier_id: int
    warehouse_id: int
    status: PurchaseOrderStatus
    order_date: date
    expected_date: date | None = None
    notes: str | None = None
    created_by: int
    created_at: datetime
    updated_at: datetime
    lines: list[PurchaseOrderLineResponse]

    model_config = ConfigDict(from_attributes=True)


class PurchaseOrderList(BaseModel):
    items: list[PurchaseOrderResponse]


class GRNLineCreateFromPO(BaseModel):
    po_line_id: int
    received_qty: Decimal = Field(gt=0)
    free_qty: Decimal = Field(default=Decimal("0"), ge=0)
    unit_cost: Decimal | None = Field(default=None, ge=0)
    batch_id: int | None = None
    batch_no: str | None = None
    expiry_date: date | None = None


class GRNCreateFromPO(BaseModel):
    supplier_id: int | None = None
    warehouse_id: int | None = None
    received_date: date = Field(default_factory=date.today)
    lines: list[GRNLineCreateFromPO] = Field(min_length=1)


class GRNLineResponse(BaseModel):
    id: int
    grn_id: int
    po_line_id: int
    product_id: int
    batch_id: int
    received_qty: Decimal
    free_qty: Decimal
    unit_cost: Decimal | None = None
    expiry_date: date

    model_config = ConfigDict(from_attributes=True)


class GRNResponse(BaseModel):
    id: int
    grn_number: str
    purchase_order_id: int
    supplier_id: int
    warehouse_id: int
    status: GrnStatus
    received_date: date
    posted_at: datetime | None = None
    posted_by: int | None = None
    created_by: int
    created_at: datetime
    updated_at: datetime
    lines: list[GRNLineResponse]

    model_config = ConfigDict(from_attributes=True)
