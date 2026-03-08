from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Index, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Batch(Base):
    __tablename__ = "batches"
    __table_args__ = (
        UniqueConstraint(
            "product_id",
            "batch_no",
            "expiry_date",
            "mfg_date",
            "mrp",
            "reference_id",
            name="uq_batch_product_metadata",
        ),
        Index("ix_batches_batch_no", "batch_no"),
        Index("ix_batches_expiry_date", "expiry_date"),
        Index("ix_batches_reference_id", "reference_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    batch_no: Mapped[str] = mapped_column(String(100), nullable=False)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    mfg_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    mrp: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    reference_id: Mapped[str | None] = mapped_column(String(120), nullable=True)

    product = relationship("Product", back_populates="batches")
    stock_summaries = relationship("StockSummary", back_populates="batch")
    inventory_ledgers = relationship("InventoryLedger", back_populates="batch")
