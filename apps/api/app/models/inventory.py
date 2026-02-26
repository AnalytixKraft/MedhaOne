from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import InventoryReason, InventoryTxnType


class InventoryLedger(Base):
    __tablename__ = "inventory_ledger"
    __table_args__ = (
        Index("ix_inventory_ledger_wh_prod", "warehouse_id", "product_id"),
        Index("ix_inventory_ledger_batch_id", "batch_id"),
        Index("ix_inventory_ledger_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    txn_type: Mapped[InventoryTxnType] = mapped_column(
        Enum(InventoryTxnType, name="inventory_txn_type_enum"), nullable=False
    )
    reason: Mapped[InventoryReason] = mapped_column(
        Enum(InventoryReason, name="inventory_reason_enum"), nullable=False
    )
    ref_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ref_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id"), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    unit_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    warehouse = relationship("Warehouse", back_populates="inventory_ledgers")
    product = relationship("Product", back_populates="inventory_ledgers")
    batch = relationship("Batch", back_populates="inventory_ledgers")
    creator = relationship("User")


class StockSummary(Base):
    __tablename__ = "stock_summary"
    __table_args__ = (
        UniqueConstraint(
            "warehouse_id",
            "product_id",
            "batch_id",
            name="uq_stock_summary_wh_product_batch",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id"), nullable=False)
    qty_on_hand: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    warehouse = relationship("Warehouse", back_populates="stock_summaries")
    product = relationship("Product", back_populates="stock_summaries")
    batch = relationship("Batch", back_populates="stock_summaries")
