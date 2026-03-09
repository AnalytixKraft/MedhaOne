from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import GrnStatus, PurchaseCreditNoteStatus, PurchaseOrderStatus


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
    discount_percent: Decimal = Field(default=Decimal("0"), ge=0, le=100)
    adjustment: Decimal = Decimal("0")
    gst_percent: Decimal = Field(default=Decimal("0"), ge=0)
    lines: list[PurchaseOrderLineCreate] = Field(min_length=1)


class PurchaseOrderUpdate(PurchaseOrderCreate):
    pass


class PurchaseOrderLineResponse(BaseModel):
    id: int
    purchase_order_id: int
    product_id: int
    ordered_qty: Decimal
    received_qty: Decimal
    unit_cost: Decimal | None = None
    free_qty: Decimal
    discount_amount: Decimal
    taxable_value: Decimal
    gst_percent: Decimal
    cgst_percent: Decimal
    sgst_percent: Decimal
    igst_percent: Decimal
    cgst_amount: Decimal
    sgst_amount: Decimal
    igst_amount: Decimal
    tax_amount: Decimal
    line_total: Decimal
    line_notes: str | None = None
    product_name: str | None = None
    product_sku: str | None = None
    hsn_code: str | None = None

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
    tax_type: str | None = None
    supplier_name: str | None = None
    warehouse_name: str | None = None
    created_by_name: str | None = None
    subtotal: Decimal
    discount_percent: Decimal
    discount_amount: Decimal
    taxable_value: Decimal
    gst_percent: Decimal
    cgst_percent: Decimal
    sgst_percent: Decimal
    igst_percent: Decimal
    cgst_amount: Decimal
    sgst_amount: Decimal
    igst_amount: Decimal
    total_tax: Decimal
    adjustment: Decimal
    final_total: Decimal
    created_by: int
    created_at: datetime
    updated_at: datetime
    lines: list[PurchaseOrderLineResponse]

    model_config = ConfigDict(from_attributes=True)


class PurchaseOrderList(BaseModel):
    items: list[PurchaseOrderResponse]


class GRNLineCreateFromPO(BaseModel):
    po_line_id: int
    purchase_bill_line_id: int | None = None
    received_qty: Decimal = Field(gt=0)
    free_qty: Decimal = Field(default=Decimal("0"), ge=0)
    unit_cost: Decimal | None = Field(default=None, ge=0)
    batch_id: int | None = None
    batch_no: str | None = None
    expiry_date: date | None = None
    mfg_date: date | None = None
    mrp: Decimal | None = Field(default=None, ge=0)
    remarks: str | None = None
    batch_lines: list["GRNBatchLineCreate"] = Field(default_factory=list)


class GRNBatchLineCreate(BaseModel):
    batch_id: int | None = None
    batch_no: str | None = None
    expiry_date: date | None = None
    mfg_date: date | None = None
    mrp: Decimal | None = Field(default=None, ge=0)
    received_qty: Decimal = Field(gt=0)
    free_qty: Decimal = Field(default=Decimal("0"), ge=0)
    unit_cost: Decimal | None = Field(default=None, ge=0)
    remarks: str | None = None


class GRNCreateFromPO(BaseModel):
    supplier_id: int | None = None
    warehouse_id: int | None = None
    purchase_bill_id: int | None = None
    received_date: date = Field(default_factory=date.today)
    remarks: str | None = None
    lines: list[GRNLineCreateFromPO] = Field(min_length=1)


class GRNCreateFromBill(BaseModel):
    purchase_order_id: int | None = None
    supplier_id: int | None = None
    warehouse_id: int | None = None
    received_date: date = Field(default_factory=date.today)
    remarks: str | None = None
    lines: list[GRNLineCreateFromPO] = Field(min_length=1)


class GRNUpdate(BaseModel):
    purchase_bill_id: int | None = None
    received_date: date
    remarks: str | None = None
    lines: list[GRNLineCreateFromPO] = Field(min_length=1)


class GrnAttachBillPayload(BaseModel):
    purchase_bill_id: int


class GRNBatchLineResponse(BaseModel):
    id: int
    grn_line_id: int
    batch_no: str
    expiry_date: date
    mfg_date: date | None = None
    mrp: Decimal | None = None
    received_qty: Decimal
    free_qty: Decimal
    unit_cost: Decimal | None = None
    batch_id: int | None = None
    remarks: str | None = None

    model_config = ConfigDict(from_attributes=True)


class GRNLineResponse(BaseModel):
    id: int
    grn_id: int
    po_line_id: int | None = None
    purchase_order_line_id: int | None = None
    purchase_bill_line_id: int | None = None
    product_id: int
    product_name: str | None = None
    product_sku: str | None = None
    hsn_code: str | None = None
    product_name_snapshot: str | None = None
    ordered_qty_snapshot: Decimal | None = None
    billed_qty_snapshot: Decimal | None = None
    received_qty_total: Decimal
    free_qty_total: Decimal
    batch_id: int | None = None
    received_qty: Decimal
    free_qty: Decimal
    unit_cost: Decimal | None = None
    expiry_date: date | None = None
    remarks: str | None = None
    batch_lines: list[GRNBatchLineResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class GRNResponse(BaseModel):
    id: int
    grn_number: str
    purchase_order_id: int
    po_number: str | None = None
    purchase_bill_id: int | None = None
    purchase_bill_number: str | None = None
    supplier_id: int
    supplier_name: str | None = None
    warehouse_id: int
    warehouse_name: str | None = None
    status: GrnStatus
    received_date: date
    remarks: str | None = None
    posted_at: datetime | None = None
    posted_by: int | None = None
    posted_by_name: str | None = None
    created_by: int
    created_by_name: str | None = None
    created_at: datetime
    updated_at: datetime
    total_products: int
    total_received_qty: Decimal
    lines: list[GRNLineResponse]

    model_config = ConfigDict(from_attributes=True)


class PurchaseCreditNoteResponse(BaseModel):
    id: int
    credit_note_number: str
    supplier_id: int
    warehouse_id: int
    purchase_return_id: int
    total_amount: Decimal
    status: PurchaseCreditNoteStatus
    created_at: datetime
    created_by: int

    model_config = ConfigDict(from_attributes=True)
