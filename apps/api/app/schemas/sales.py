from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import DispatchNoteStatus, SalesOrderStatus, StockReservationStatus


class SalesOrderLineCreate(BaseModel):
    product_id: int
    ordered_qty: Decimal = Field(gt=0)
    unit_price: Decimal = Field(default=Decimal("0"), ge=0)
    discount_percent: Decimal = Field(default=Decimal("0"), ge=0)
    gst_rate: Decimal = Field(default=Decimal("0"), ge=0)
    hsn_code: str | None = None
    remarks: str | None = None


class SalesOrderCreate(BaseModel):
    customer_id: int
    warehouse_id: int
    order_date: date = Field(default_factory=date.today)
    expected_dispatch_date: date | None = None
    remarks: str | None = None
    subtotal: Decimal = Field(default=Decimal("0"), ge=0)
    discount_percent: Decimal = Field(default=Decimal("0"), ge=0)
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0)
    tax_type: str | None = None
    tax_percent: Decimal = Field(default=Decimal("0"), ge=0)
    tax_amount: Decimal = Field(default=Decimal("0"), ge=0)
    adjustment: Decimal = Field(default=Decimal("0"))
    total: Decimal = Field(default=Decimal("0"), ge=0)
    lines: list[SalesOrderLineCreate] = Field(min_length=1)


class SalesOrderUpdate(BaseModel):
    customer_id: int | None = None
    warehouse_id: int | None = None
    order_date: date | None = None
    expected_dispatch_date: date | None = None
    remarks: str | None = None
    subtotal: Decimal | None = Field(default=None, ge=0)
    discount_percent: Decimal | None = Field(default=None, ge=0)
    discount_amount: Decimal | None = Field(default=None, ge=0)
    tax_type: str | None = None
    tax_percent: Decimal | None = Field(default=None, ge=0)
    tax_amount: Decimal | None = Field(default=None, ge=0)
    adjustment: Decimal | None = None
    total: Decimal | None = Field(default=None, ge=0)
    lines: list[SalesOrderLineCreate] | None = Field(default=None, min_length=1)


class SalesOrderLineResponse(BaseModel):
    id: int
    sales_order_id: int
    product_id: int
    ordered_qty: Decimal
    reserved_qty: Decimal
    dispatched_qty: Decimal
    unit_price: Decimal
    discount_percent: Decimal
    line_total: Decimal
    gst_rate: Decimal
    hsn_code: str | None = None
    remarks: str | None = None

    model_config = ConfigDict(from_attributes=True)


class SalesOrderResponse(BaseModel):
    id: int
    so_number: str
    customer_id: int
    warehouse_id: int
    status: SalesOrderStatus
    order_date: date
    expected_dispatch_date: date | None = None
    remarks: str | None = None
    subtotal: Decimal
    discount_percent: Decimal
    discount_amount: Decimal
    tax_type: str | None = None
    tax_percent: Decimal
    tax_amount: Decimal
    adjustment: Decimal
    total: Decimal
    created_by: int
    created_at: datetime
    updated_at: datetime
    lines: list[SalesOrderLineResponse]

    model_config = ConfigDict(from_attributes=True)


class SalesOrderListResponse(BaseModel):
    items: list[SalesOrderResponse]


class StockReservationResponse(BaseModel):
    id: int
    sales_order_id: int
    sales_order_line_id: int
    warehouse_id: int
    product_id: int
    batch_id: int | None = None
    reserved_qty: Decimal
    consumed_qty: Decimal
    released_qty: Decimal
    status: StockReservationStatus
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class StockReservationListResponse(BaseModel):
    items: list[StockReservationResponse]


class BatchAvailabilityResponse(BaseModel):
    batch_id: int
    batch_no: str
    expiry_date: date
    qty_on_hand: Decimal


class StockAvailabilityResponse(BaseModel):
    warehouse_id: int
    product_id: int
    on_hand_qty: Decimal
    reserved_qty: Decimal
    available_qty: Decimal
    candidate_batches: list[BatchAvailabilityResponse]


class DispatchLineCreate(BaseModel):
    sales_order_line_id: int
    batch_id: int
    dispatched_qty: Decimal = Field(gt=0)


class DispatchNoteCreate(BaseModel):
    dispatch_date: date = Field(default_factory=date.today)
    remarks: str | None = None
    lines: list[DispatchLineCreate] = Field(min_length=1)


class DispatchLineResponse(BaseModel):
    id: int
    dispatch_note_id: int
    sales_order_line_id: int
    product_id: int
    batch_id: int
    expiry_date_snapshot: date | None = None
    dispatched_qty: Decimal
    unit_price_snapshot: Decimal
    line_total: Decimal

    model_config = ConfigDict(from_attributes=True)


class DispatchNoteResponse(BaseModel):
    id: int
    dispatch_number: str
    sales_order_id: int
    customer_id: int
    warehouse_id: int
    status: DispatchNoteStatus
    dispatch_date: date
    remarks: str | None = None
    created_by: int
    posted_by: int | None = None
    created_at: datetime
    posted_at: datetime | None = None
    lines: list[DispatchLineResponse]

    model_config = ConfigDict(from_attributes=True)


class DispatchNoteListResponse(BaseModel):
    items: list[DispatchNoteResponse]
