from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
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
from app.models.enums import (
    GrnStatus,
    PurchaseCreditNoteStatus,
    PurchaseOrderStatus,
    PurchaseReturnStatus,
)


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    __table_args__ = (
        Index("ix_purchase_orders_supplier_id", "supplier_id"),
        Index("ix_purchase_orders_warehouse_id", "warehouse_id"),
        Index("ix_purchase_orders_status", "status"),
        Index("ix_purchase_orders_order_date", "order_date"),
        CheckConstraint(
            "discount_percent >= 0 AND discount_percent <= 100",
            name="ck_purchase_orders_discount_percent_range",
        ),
        CheckConstraint("gst_percent >= 0", name="ck_purchase_orders_gst_percent_non_negative"),
        CheckConstraint("final_total >= 0", name="ck_purchase_orders_final_total_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    po_number: Mapped[str] = mapped_column(String(60), nullable=False, unique=True, index=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("parties.id"), nullable=False)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), nullable=False)
    status: Mapped[PurchaseOrderStatus] = mapped_column(
        Enum(PurchaseOrderStatus, name="purchase_order_status_enum"),
        nullable=False,
        default=PurchaseOrderStatus.DRAFT,
    )
    order_date: Mapped[date] = mapped_column(Date, nullable=False)
    expected_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    tax_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    taxable_value: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    gst_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    cgst_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    sgst_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    igst_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    cgst_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    sgst_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    igst_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    adjustment: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    final_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    supplier = relationship("Party")
    warehouse = relationship("Warehouse")
    creator = relationship("User", foreign_keys=[created_by])
    lines = relationship(
        "PurchaseOrderLine",
        back_populates="purchase_order",
        cascade="all, delete-orphan",
    )
    grns = relationship("GRN", back_populates="purchase_order")


class PurchaseOrderLine(Base):
    __tablename__ = "purchase_order_lines"
    __table_args__ = (
        Index("ix_purchase_order_lines_purchase_order_id", "purchase_order_id"),
        CheckConstraint("ordered_qty > 0", name="ck_po_line_ordered_qty_gt_zero"),
        CheckConstraint("received_qty >= 0", name="ck_po_line_received_qty_non_negative"),
        CheckConstraint("free_qty >= 0", name="ck_po_line_free_qty_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    purchase_order_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    ordered_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    received_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False, default=0)
    unit_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    free_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False, default=0)
    line_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    purchase_order = relationship("PurchaseOrder", back_populates="lines")
    product = relationship("Product")
    grn_lines = relationship("GRNLine", back_populates="po_line")


class GRN(Base):
    __tablename__ = "grns"
    __table_args__ = (
        Index("ix_grns_purchase_order_id", "purchase_order_id"),
        Index("ix_grns_supplier_id", "supplier_id"),
        Index("ix_grns_warehouse_id", "warehouse_id"),
        Index("ix_grns_status", "status"),
        Index("ix_grns_posted_at", "posted_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    grn_number: Mapped[str] = mapped_column(String(60), nullable=False, unique=True, index=True)
    purchase_order_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id"), nullable=False)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("parties.id"), nullable=False)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), nullable=False)
    status: Mapped[GrnStatus] = mapped_column(
        Enum(GrnStatus, name="grn_status_enum"),
        nullable=False,
        default=GrnStatus.DRAFT,
    )
    received_date: Mapped[date] = mapped_column(Date, nullable=False)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    posted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    purchase_order = relationship("PurchaseOrder", back_populates="grns")
    supplier = relationship("Party")
    warehouse = relationship("Warehouse")
    creator = relationship("User", foreign_keys=[created_by])
    poster = relationship("User", foreign_keys=[posted_by])
    lines = relationship("GRNLine", back_populates="grn", cascade="all, delete-orphan")


class GRNLine(Base):
    __tablename__ = "grn_lines"
    __table_args__ = (
        CheckConstraint("received_qty > 0", name="ck_grn_line_received_qty_gt_zero"),
        CheckConstraint("free_qty >= 0", name="ck_grn_line_free_qty_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    grn_id: Mapped[int] = mapped_column(ForeignKey("grns.id"), nullable=False, index=True)
    po_line_id: Mapped[int] = mapped_column(ForeignKey("purchase_order_lines.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id"), nullable=False)
    received_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    free_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False, default=0)
    unit_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)

    grn = relationship("GRN", back_populates="lines")
    po_line = relationship("PurchaseOrderLine", back_populates="grn_lines")
    product = relationship("Product")
    batch = relationship("Batch")


class PurchaseReturn(Base):
    __tablename__ = "purchase_returns"
    __table_args__ = (
        Index("ix_purchase_returns_supplier_id", "supplier_id"),
        Index("ix_purchase_returns_warehouse_id", "warehouse_id"),
        Index("ix_purchase_returns_status", "status"),
        Index("ix_purchase_returns_posted_at", "posted_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    return_number: Mapped[str] = mapped_column(String(60), nullable=False, unique=True, index=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("parties.id"), nullable=False)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), nullable=False)
    status: Mapped[PurchaseReturnStatus] = mapped_column(
        Enum(PurchaseReturnStatus, name="purchase_return_status_enum"),
        nullable=False,
        default=PurchaseReturnStatus.DRAFT,
    )
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    posted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    supplier = relationship("Party")
    warehouse = relationship("Warehouse")
    creator = relationship("User", foreign_keys=[created_by])
    poster = relationship("User", foreign_keys=[posted_by])
    lines = relationship(
        "PurchaseReturnLine",
        back_populates="purchase_return",
        cascade="all, delete-orphan",
    )
    credit_note = relationship(
        "PurchaseCreditNote",
        back_populates="purchase_return",
        uselist=False,
    )


class PurchaseReturnLine(Base):
    __tablename__ = "purchase_return_lines"
    __table_args__ = (
        Index("ix_purchase_return_lines_purchase_return_id", "purchase_return_id"),
        CheckConstraint("quantity > 0", name="ck_purchase_return_line_quantity_gt_zero"),
        CheckConstraint("unit_cost >= 0", name="ck_purchase_return_line_unit_cost_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    purchase_return_id: Mapped[int] = mapped_column(
        ForeignKey("purchase_returns.id"), nullable=False
    )
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id"), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)

    purchase_return = relationship("PurchaseReturn", back_populates="lines")
    product = relationship("Product")
    batch = relationship("Batch")


class PurchaseCreditNote(Base):
    __tablename__ = "purchase_credit_notes"
    __table_args__ = (
        Index("ix_purchase_credit_notes_supplier_id", "supplier_id"),
        Index("ix_purchase_credit_notes_warehouse_id", "warehouse_id"),
        Index("ix_purchase_credit_notes_status", "status"),
        Index("ix_purchase_credit_notes_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    credit_note_number: Mapped[str] = mapped_column(
        String(60), nullable=False, unique=True, index=True
    )
    supplier_id: Mapped[int] = mapped_column(ForeignKey("parties.id"), nullable=False)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), nullable=False)
    purchase_return_id: Mapped[int] = mapped_column(
        ForeignKey("purchase_returns.id"), nullable=False, unique=True
    )
    total_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    status: Mapped[PurchaseCreditNoteStatus] = mapped_column(
        Enum(PurchaseCreditNoteStatus, name="purchase_credit_note_status_enum"),
        nullable=False,
        default=PurchaseCreditNoteStatus.GENERATED,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    supplier = relationship("Party")
    warehouse = relationship("Warehouse")
    purchase_return = relationship("PurchaseReturn", back_populates="credit_note")
    creator = relationship("User")
