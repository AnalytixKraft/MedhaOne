from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import PurchaseBillExtractionStatus, PurchaseBillStatus


class DocumentAttachment(Base):
    __tablename__ = "document_attachments"
    __table_args__ = (
        Index("ix_document_attachments_entity", "entity_type", "entity_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[int] = mapped_column(nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_type: Mapped[str] = mapped_column(String(100), nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    uploaded_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    uploader = relationship("User")


class PurchaseBill(Base):
    __tablename__ = "purchase_bills"
    __table_args__ = (
        Index("ix_purchase_bills_bill_number", "bill_number"),
        Index("ix_purchase_bills_supplier_id", "supplier_id"),
        Index("ix_purchase_bills_status", "status"),
        Index("ix_purchase_bills_bill_date", "bill_date"),
        CheckConstraint("subtotal >= 0", name="ck_purchase_bills_subtotal_non_negative"),
        CheckConstraint("discount_amount >= 0", name="ck_purchase_bills_discount_non_negative"),
        CheckConstraint("taxable_value >= 0", name="ck_purchase_bills_taxable_non_negative"),
        CheckConstraint("cgst_amount >= 0", name="ck_purchase_bills_cgst_non_negative"),
        CheckConstraint("sgst_amount >= 0", name="ck_purchase_bills_sgst_non_negative"),
        CheckConstraint("igst_amount >= 0", name="ck_purchase_bills_igst_non_negative"),
        CheckConstraint("total >= 0", name="ck_purchase_bills_total_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    bill_number: Mapped[str] = mapped_column(String(120), nullable=False)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("parties.id"), nullable=True)
    supplier_name_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)
    supplier_gstin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    bill_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouses.id"), nullable=True)
    status: Mapped[PurchaseBillStatus] = mapped_column(
        Enum(PurchaseBillStatus, name="purchase_bill_status_enum"),
        nullable=False,
        default=PurchaseBillStatus.DRAFT,
    )
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    taxable_value: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    cgst_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    sgst_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    igst_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    adjustment: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    extraction_status: Mapped[PurchaseBillExtractionStatus] = mapped_column(
        Enum(PurchaseBillExtractionStatus, name="purchase_bill_extraction_status_enum"),
        nullable=False,
        default=PurchaseBillExtractionStatus.NOT_STARTED,
    )
    extraction_confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    attachment_id: Mapped[int | None] = mapped_column(
        ForeignKey("document_attachments.id"),
        nullable=True,
    )
    purchase_order_id: Mapped[int | None] = mapped_column(
        ForeignKey("purchase_orders.id"),
        nullable=True,
    )
    grn_id: Mapped[int | None] = mapped_column(ForeignKey("grns.id"), nullable=True)
    extracted_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    supplier = relationship("Party")
    warehouse = relationship("Warehouse")
    attachment = relationship("DocumentAttachment", foreign_keys=[attachment_id])
    creator = relationship("User", foreign_keys=[created_by])
    purchase_order = relationship("PurchaseOrder")
    grn = relationship("GRN", foreign_keys=[grn_id])
    lines = relationship(
        "PurchaseBillLine",
        back_populates="purchase_bill",
        cascade="all, delete-orphan",
    )


class PurchaseBillLine(Base):
    __tablename__ = "purchase_bill_lines"
    __table_args__ = (
        Index("ix_purchase_bill_lines_purchase_bill_id", "purchase_bill_id"),
        CheckConstraint("qty >= 0", name="ck_purchase_bill_lines_qty_non_negative"),
        CheckConstraint("unit_price >= 0", name="ck_purchase_bill_lines_unit_price_non_negative"),
        CheckConstraint("discount_amount >= 0", name="ck_purchase_bill_lines_discount_non_negative"),
        CheckConstraint("gst_percent >= 0", name="ck_purchase_bill_lines_gst_non_negative"),
        CheckConstraint("line_total >= 0", name="ck_purchase_bill_lines_total_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    purchase_bill_id: Mapped[int] = mapped_column(ForeignKey("purchase_bills.id"), nullable=False)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), nullable=True)
    description_raw: Mapped[str] = mapped_column(Text, nullable=False)
    hsn_code: Mapped[str | None] = mapped_column(String(30), nullable=True)
    qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False, default=0)
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False, default=0)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    gst_percent: Mapped[Decimal] = mapped_column(Numeric(7, 2), nullable=False, default=0)
    line_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    batch_no: Mapped[str | None] = mapped_column(String(80), nullable=True)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    confidence_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)

    purchase_bill = relationship("PurchaseBill", back_populates="lines")
    product = relationship("Product")
