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
from app.models.enums import DispatchNoteStatus, SalesOrderStatus, StockReservationStatus


class SalesOrder(Base):
    __tablename__ = "sales_orders"
    __table_args__ = (
        Index("ix_sales_orders_customer_id", "customer_id"),
        Index("ix_sales_orders_warehouse_id", "warehouse_id"),
        Index("ix_sales_orders_status", "status"),
        Index("ix_sales_orders_order_date", "order_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    so_number: Mapped[str] = mapped_column(String(60), nullable=False, unique=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("parties.id"), nullable=False)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), nullable=False)
    status: Mapped[SalesOrderStatus] = mapped_column(
        Enum(SalesOrderStatus, name="sales_order_status_enum"),
        nullable=False,
        default=SalesOrderStatus.DRAFT,
    )
    order_date: Mapped[date] = mapped_column(Date, nullable=False)
    expected_dispatch_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(7, 2), nullable=False, default=0)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    tax_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    tax_percent: Mapped[Decimal] = mapped_column(Numeric(7, 2), nullable=False, default=0)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    adjustment: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    total: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    customer = relationship("Party")
    warehouse = relationship("Warehouse")
    creator = relationship("User", foreign_keys=[created_by])
    lines = relationship("SalesOrderLine", back_populates="sales_order", cascade="all, delete-orphan")
    reservations = relationship("StockReservation", back_populates="sales_order")
    dispatch_notes = relationship("DispatchNote", back_populates="sales_order")


class SalesOrderLine(Base):
    __tablename__ = "sales_order_lines"
    __table_args__ = (
        Index("ix_sales_order_lines_sales_order_id", "sales_order_id"),
        CheckConstraint("ordered_qty > 0", name="ck_sales_order_line_ordered_qty_gt_zero"),
        CheckConstraint("reserved_qty >= 0", name="ck_sales_order_line_reserved_qty_non_negative"),
        CheckConstraint("dispatched_qty >= 0", name="ck_sales_order_line_dispatched_qty_non_negative"),
        CheckConstraint("unit_price >= 0", name="ck_sales_order_line_unit_price_non_negative"),
        CheckConstraint("discount_percent >= 0", name="ck_sales_order_line_discount_percent_non_negative"),
        CheckConstraint("line_total >= 0", name="ck_sales_order_line_line_total_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    sales_order_id: Mapped[int] = mapped_column(ForeignKey("sales_orders.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    ordered_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    reserved_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False, default=0)
    dispatched_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False, default=0)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False, default=0)
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(7, 2), nullable=False, default=0)
    line_total: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    gst_rate: Mapped[Decimal] = mapped_column(Numeric(7, 2), nullable=False, default=0)
    hsn_code: Mapped[str | None] = mapped_column(String(30), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    sales_order = relationship("SalesOrder", back_populates="lines")
    product = relationship("Product")
    reservations = relationship("StockReservation", back_populates="sales_order_line")
    dispatch_lines = relationship("DispatchLine", back_populates="sales_order_line")


class StockReservation(Base):
    __tablename__ = "stock_reservations"
    __table_args__ = (
        Index("ix_stock_reservations_sales_order_id", "sales_order_id"),
        Index("ix_stock_reservations_sales_order_line_id", "sales_order_line_id"),
        Index("ix_stock_reservations_wh_product_status", "warehouse_id", "product_id", "status"),
        CheckConstraint("reserved_qty > 0", name="ck_stock_reservations_reserved_qty_gt_zero"),
        CheckConstraint("consumed_qty >= 0", name="ck_stock_reservations_consumed_qty_non_negative"),
        CheckConstraint("released_qty >= 0", name="ck_stock_reservations_released_qty_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    sales_order_id: Mapped[int] = mapped_column(ForeignKey("sales_orders.id"), nullable=False)
    sales_order_line_id: Mapped[int] = mapped_column(ForeignKey("sales_order_lines.id"), nullable=False)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("batches.id"), nullable=True)
    reserved_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    consumed_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False, default=0)
    released_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False, default=0)
    status: Mapped[StockReservationStatus] = mapped_column(
        Enum(StockReservationStatus, name="stock_reservation_status_enum"),
        nullable=False,
        default=StockReservationStatus.ACTIVE,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    sales_order = relationship("SalesOrder", back_populates="reservations")
    sales_order_line = relationship("SalesOrderLine", back_populates="reservations")
    warehouse = relationship("Warehouse")
    product = relationship("Product")
    batch = relationship("Batch")


class DispatchNote(Base):
    __tablename__ = "dispatch_notes"
    __table_args__ = (
        Index("ix_dispatch_notes_sales_order_id", "sales_order_id"),
        Index("ix_dispatch_notes_customer_id", "customer_id"),
        Index("ix_dispatch_notes_warehouse_id", "warehouse_id"),
        Index("ix_dispatch_notes_status", "status"),
        Index("ix_dispatch_notes_dispatch_date", "dispatch_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    dispatch_number: Mapped[str] = mapped_column(String(60), nullable=False, unique=True, index=True)
    sales_order_id: Mapped[int] = mapped_column(ForeignKey("sales_orders.id"), nullable=False)
    customer_id: Mapped[int] = mapped_column(ForeignKey("parties.id"), nullable=False)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), nullable=False)
    status: Mapped[DispatchNoteStatus] = mapped_column(
        Enum(DispatchNoteStatus, name="dispatch_note_status_enum"),
        nullable=False,
        default=DispatchNoteStatus.DRAFT,
    )
    dispatch_date: Mapped[date] = mapped_column(Date, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    posted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    sales_order = relationship("SalesOrder", back_populates="dispatch_notes")
    customer = relationship("Party")
    warehouse = relationship("Warehouse")
    creator = relationship("User", foreign_keys=[created_by])
    poster = relationship("User", foreign_keys=[posted_by])
    lines = relationship("DispatchLine", back_populates="dispatch_note", cascade="all, delete-orphan")


class DispatchLine(Base):
    __tablename__ = "dispatch_lines"
    __table_args__ = (
        Index("ix_dispatch_lines_dispatch_note_id", "dispatch_note_id"),
        CheckConstraint("dispatched_qty > 0", name="ck_dispatch_lines_dispatched_qty_gt_zero"),
        CheckConstraint("unit_price_snapshot >= 0", name="ck_dispatch_lines_unit_price_snapshot_non_negative"),
        CheckConstraint("line_total >= 0", name="ck_dispatch_lines_line_total_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    dispatch_note_id: Mapped[int] = mapped_column(ForeignKey("dispatch_notes.id"), nullable=False)
    sales_order_line_id: Mapped[int] = mapped_column(ForeignKey("sales_order_lines.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id"), nullable=False)
    expiry_date_snapshot: Mapped[date | None] = mapped_column(Date, nullable=True)
    dispatched_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    unit_price_snapshot: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False, default=0)
    line_total: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)

    dispatch_note = relationship("DispatchNote", back_populates="lines")
    sales_order_line = relationship("SalesOrderLine", back_populates="dispatch_lines")
    product = relationship("Product")
    batch = relationship("Batch")
