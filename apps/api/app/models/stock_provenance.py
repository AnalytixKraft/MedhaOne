from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class StockSourceProvenance(Base):
    __tablename__ = "stock_source_provenance"
    __table_args__ = (
        UniqueConstraint("ledger_id", name="uq_stock_source_provenance_ledger_id"),
        Index("ix_stock_source_provenance_supplier_id", "supplier_id"),
        Index("ix_stock_source_provenance_purchase_order_id", "purchase_order_id"),
        Index("ix_stock_source_provenance_purchase_bill_id", "purchase_bill_id"),
        Index("ix_stock_source_provenance_grn_id", "grn_id"),
        Index(
            "ix_stock_source_provenance_bucket",
            "warehouse_id",
            "product_id",
            "batch_id",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    ledger_id: Mapped[int] = mapped_column(ForeignKey("inventory_ledger.id"), nullable=False)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("parties.id"), nullable=False)
    purchase_order_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id"), nullable=False)
    purchase_bill_id: Mapped[int | None] = mapped_column(ForeignKey("purchase_bills.id"), nullable=True)
    grn_id: Mapped[int] = mapped_column(ForeignKey("grns.id"), nullable=False)
    grn_line_id: Mapped[int] = mapped_column(ForeignKey("grn_lines.id"), nullable=False)
    grn_batch_line_id: Mapped[int] = mapped_column(ForeignKey("grn_batch_lines.id"), nullable=False)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id"), nullable=False)
    batch_no: Mapped[str] = mapped_column(String(100), nullable=False)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    inward_date: Mapped[date] = mapped_column(Date, nullable=False)
    received_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    free_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False, default=0)
    unit_cost_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    ledger = relationship("InventoryLedger", back_populates="source_provenance")
    supplier = relationship("Party")
    purchase_order = relationship("PurchaseOrder")
    purchase_bill = relationship("PurchaseBill")
    grn = relationship("GRN")
    grn_line = relationship("GRNLine")
    grn_batch_line = relationship("GRNBatchLine")
    warehouse = relationship("Warehouse")
    product = relationship("Product")
    batch = relationship("Batch")
