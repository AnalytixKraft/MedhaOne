from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Warehouse(Base):
    __tablename__ = "warehouses"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    racks = relationship("Rack", back_populates="warehouse", cascade="all, delete-orphan")
    stock_summaries = relationship("StockSummary", back_populates="warehouse")
    inventory_ledgers = relationship("InventoryLedger", back_populates="warehouse")


class Rack(Base):
    __tablename__ = "racks"
    __table_args__ = (
        UniqueConstraint("warehouse_id", "rack_number", name="uq_racks_warehouse_rack_number"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    warehouse_id: Mapped[int] = mapped_column(
        ForeignKey("warehouses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    rack_number: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    warehouse = relationship("Warehouse", back_populates="racks")

    @property
    def warehouse_name(self) -> str | None:
        warehouse = getattr(self, "warehouse", None)
        return warehouse.name if warehouse else None
