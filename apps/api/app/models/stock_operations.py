from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import StockAdjustmentReason, StockAdjustmentType


class StockCorrection(Base):
    __tablename__ = "stock_corrections"
    __table_args__ = (
        Index("ix_stock_corrections_created_at", "created_at"),
        Index("ix_stock_corrections_product", "product_id"),
        Index("ix_stock_corrections_warehouse", "warehouse_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    reference_id: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    source_batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id"), nullable=False)
    corrected_batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id"), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    reason: Mapped[str] = mapped_column(String(120), nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    out_ledger_id: Mapped[int | None] = mapped_column(ForeignKey("inventory_ledger.id"), nullable=True)
    in_ledger_id: Mapped[int | None] = mapped_column(ForeignKey("inventory_ledger.id"), nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    warehouse = relationship("Warehouse")
    product = relationship("Product")
    source_batch = relationship("Batch", foreign_keys=[source_batch_id])
    corrected_batch = relationship("Batch", foreign_keys=[corrected_batch_id])
    out_ledger = relationship("InventoryLedger", foreign_keys=[out_ledger_id])
    in_ledger = relationship("InventoryLedger", foreign_keys=[in_ledger_id])
    creator = relationship("User")


class StockAdjustment(Base):
    __tablename__ = "stock_adjustments"
    __table_args__ = (
        Index("ix_stock_adjustments_created_at", "created_at"),
        Index("ix_stock_adjustments_product", "product_id"),
        Index("ix_stock_adjustments_warehouse", "warehouse_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    reference_id: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id"), nullable=False)
    adjustment_type: Mapped[StockAdjustmentType] = mapped_column(
        Enum(StockAdjustmentType, name="stock_adjustment_type_enum"),
        nullable=False,
    )
    qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    reason: Mapped[StockAdjustmentReason] = mapped_column(
        Enum(StockAdjustmentReason, name="stock_adjustment_reason_enum"),
        nullable=False,
    )
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    before_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    after_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    ledger_id: Mapped[int | None] = mapped_column(ForeignKey("inventory_ledger.id"), nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    warehouse = relationship("Warehouse")
    product = relationship("Product")
    batch = relationship("Batch")
    ledger = relationship("InventoryLedger", foreign_keys=[ledger_id])
    creator = relationship("User")
