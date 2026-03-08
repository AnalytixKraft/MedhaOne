from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel

from app.models.enums import InventoryReason, PurchaseOrderStatus


class StockInwardReportRow(BaseModel):
    grn_number: str
    po_number: str
    supplier_name: str
    warehouse_name: str
    product_name: str
    batch_no: str
    expiry_date: date
    qty_received: Decimal
    free_qty: Decimal
    received_date: date
    posted_by: str | None = None
    quantity_precision: int


class StockInwardReportResponse(BaseModel):
    total: int
    page: int
    page_size: int
    data: list[StockInwardReportRow]


class PurchaseRegisterReportRow(BaseModel):
    po_number: str
    supplier: str
    warehouse: str
    order_date: date
    status: PurchaseOrderStatus
    total_order_qty: Decimal
    total_received_qty: Decimal
    pending_qty: Decimal
    total_value: Decimal | None = None


class PurchaseRegisterReportResponse(BaseModel):
    total: int
    page: int
    page_size: int
    data: list[PurchaseRegisterReportRow]


class StockMovementReportRow(BaseModel):
    transaction_date: datetime
    reason: InventoryReason
    reference_type: str | None = None
    reference_id: str | None = None
    product: str
    batch: str
    warehouse: str
    qty_in: Decimal
    qty_out: Decimal
    running_balance: Decimal
    quantity_precision: int


class StockMovementReportResponse(BaseModel):
    total: int
    page: int
    page_size: int
    data: list[StockMovementReportRow]


class ExpiryReportRow(BaseModel):
    product: str
    batch: str
    warehouse: str
    expiry_date: date
    days_to_expiry: int
    current_qty: Decimal
    quantity_precision: int


class ExpiryReportResponse(BaseModel):
    total: int
    page: int
    page_size: int
    data: list[ExpiryReportRow]


class DeadStockReportRow(BaseModel):
    product: str
    warehouse: str
    current_qty: Decimal
    last_movement_date: datetime | None = None
    days_since_movement: int | None = None
    quantity_precision: int


class DeadStockReportResponse(BaseModel):
    total: int
    page: int
    page_size: int
    data: list[DeadStockReportRow]


class StockAgeingReportRow(BaseModel):
    product: str
    warehouse: str
    bucket_0_30: Decimal
    bucket_31_60: Decimal
    bucket_61_90: Decimal
    bucket_90_plus: Decimal
    total_qty: Decimal
    quantity_precision: int


class StockAgeingReportResponse(BaseModel):
    total: int
    page: int
    page_size: int
    data: list[StockAgeingReportRow]


class CurrentStockReportRow(BaseModel):
    sku: str
    product_name: str
    brand: str | None = None
    category: str | None = None
    warehouse: str
    batch: str
    expiry_date: date
    available_qty: Decimal
    reserved_qty: Decimal
    stock_value: Decimal
    last_movement_date: datetime | None = None
    quantity_precision: int


class CurrentStockSummary(BaseModel):
    total_skus: int
    total_stock_qty: Decimal
    total_stock_value: Decimal
    items_expiring_soon: int


class CurrentStockReportResponse(BaseModel):
    total: int
    page: int
    page_size: int
    summary: CurrentStockSummary
    data: list[CurrentStockReportRow]


class OpeningStockReportRow(BaseModel):
    sku: str
    product_name: str
    brand: str | None = None
    category: str | None = None
    warehouse: str
    batch: str
    expiry_date: date
    opening_qty: Decimal
    opening_value: Decimal
    last_opening_date: datetime | None = None
    current_qty: Decimal
    quantity_precision: int


class OpeningStockSummary(BaseModel):
    total_skus: int
    total_opening_qty: Decimal
    total_opening_value: Decimal


class OpeningStockReportResponse(BaseModel):
    total: int
    page: int
    page_size: int
    summary: OpeningStockSummary
    data: list[OpeningStockReportRow]


class ReportEntityOption(BaseModel):
    id: int
    label: str


class ReportFilterOptionsResponse(BaseModel):
    brands: list[str]
    categories: list[str]
    batches: list[str]
    products: list[ReportEntityOption]
    suppliers: list[ReportEntityOption]
    warehouses: list[ReportEntityOption]
