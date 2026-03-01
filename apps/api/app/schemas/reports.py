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


class StockMovementReportResponse(BaseModel):
    total: int
    page: int
    page_size: int
    data: list[StockMovementReportRow]
