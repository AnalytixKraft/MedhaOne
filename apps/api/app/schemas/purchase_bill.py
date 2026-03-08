from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import PurchaseBillExtractionStatus, PurchaseBillStatus


class PurchaseBillLineUpdate(BaseModel):
    product_id: int | None = None
    description_raw: str
    hsn_code: str | None = None
    qty: Decimal = Field(default=Decimal("0"), ge=0)
    unit: str | None = None
    unit_price: Decimal = Field(default=Decimal("0"), ge=0)
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0)
    gst_percent: Decimal = Field(default=Decimal("0"), ge=0)
    line_total: Decimal = Field(default=Decimal("0"), ge=0)
    batch_no: str | None = None
    expiry_date: date | None = None
    confidence_score: Decimal | None = None


class PurchaseBillUpdate(BaseModel):
    bill_number: str | None = None
    supplier_id: int | None = None
    supplier_name_raw: str | None = None
    supplier_gstin: str | None = None
    bill_date: date | None = None
    due_date: date | None = None
    warehouse_id: int | None = None
    subtotal: Decimal | None = Field(default=None, ge=0)
    discount_amount: Decimal | None = Field(default=None, ge=0)
    taxable_value: Decimal | None = Field(default=None, ge=0)
    cgst_amount: Decimal | None = Field(default=None, ge=0)
    sgst_amount: Decimal | None = Field(default=None, ge=0)
    igst_amount: Decimal | None = Field(default=None, ge=0)
    adjustment: Decimal | None = None
    total: Decimal | None = Field(default=None, ge=0)
    purchase_order_id: int | None = None
    grn_id: int | None = None
    remarks: str | None = None
    lines: list[PurchaseBillLineUpdate] | None = None


class DocumentAttachmentResponse(BaseModel):
    id: int
    entity_type: str
    entity_id: int
    file_name: str
    file_type: str
    storage_path: str
    uploaded_by: int
    uploaded_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PurchaseBillLineResponse(BaseModel):
    id: int
    purchase_bill_id: int
    product_id: int | None = None
    description_raw: str
    hsn_code: str | None = None
    qty: Decimal
    unit: str | None = None
    unit_price: Decimal
    discount_amount: Decimal
    gst_percent: Decimal
    line_total: Decimal
    batch_no: str | None = None
    expiry_date: date | None = None
    confidence_score: Decimal | None = None

    model_config = ConfigDict(from_attributes=True)


class PurchaseBillResponse(BaseModel):
    id: int
    bill_number: str
    supplier_id: int | None = None
    supplier_name_raw: str | None = None
    supplier_gstin: str | None = None
    bill_date: date | None = None
    due_date: date | None = None
    warehouse_id: int | None = None
    status: PurchaseBillStatus
    subtotal: Decimal
    discount_amount: Decimal
    taxable_value: Decimal
    cgst_amount: Decimal
    sgst_amount: Decimal
    igst_amount: Decimal
    adjustment: Decimal
    total: Decimal
    extraction_status: PurchaseBillExtractionStatus
    extraction_confidence: Decimal | None = None
    attachment_id: int | None = None
    purchase_order_id: int | None = None
    grn_id: int | None = None
    extracted_json: dict[str, Any] | None = None
    created_by: int
    created_at: datetime
    updated_at: datetime
    remarks: str | None = None
    attachment: DocumentAttachmentResponse | None = None
    lines: list[PurchaseBillLineResponse]

    model_config = ConfigDict(from_attributes=True)


class PurchaseBillListResponse(BaseModel):
    items: list[PurchaseBillResponse]


class PurchaseBillExtractionLine(BaseModel):
    description_raw: str
    hsn_code: str | None = None
    qty: Decimal = Field(default=Decimal("0"), ge=0)
    unit: str | None = None
    unit_price: Decimal = Field(default=Decimal("0"), ge=0)
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0)
    gst_percent: Decimal = Field(default=Decimal("0"), ge=0)
    line_total: Decimal = Field(default=Decimal("0"), ge=0)
    batch_no: str | None = None
    expiry_date: date | None = None
    confidence_score: Decimal | None = None


class PurchaseBillExtractionPayload(BaseModel):
    supplier_name: str | None = None
    supplier_gstin: str | None = None
    invoice_number: str | None = None
    invoice_date: date | None = None
    due_date: date | None = None
    subtotal: Decimal | None = None
    discount_amount: Decimal | None = None
    taxable_value: Decimal | None = None
    cgst_amount: Decimal | None = None
    sgst_amount: Decimal | None = None
    igst_amount: Decimal | None = None
    adjustment: Decimal | None = None
    total: Decimal | None = None
    confidence: Decimal | None = None
    line_items: list[PurchaseBillExtractionLine] = Field(default_factory=list)
