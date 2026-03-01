from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.enums import PurchaseOrderStatus
from app.models.party import Party
from app.models.purchase import PurchaseOrder, PurchaseOrderLine
from app.models.warehouse import Warehouse


@dataclass(slots=True)
class PurchaseRegisterFilters:
    status: PurchaseOrderStatus | None = None
    supplier_id: int | None = None
    supplier_name: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    page: int = 1
    page_size: int = 50


def get_purchase_register_report(
    db: Session,
    filters: PurchaseRegisterFilters,
) -> tuple[int, list[dict[str, object]]]:
    total_order_qty = func.coalesce(func.sum(PurchaseOrderLine.ordered_qty), Decimal("0"))
    total_received_qty = func.coalesce(func.sum(PurchaseOrderLine.received_qty), Decimal("0"))

    stmt = (
        select(
            PurchaseOrder.id.label("po_id"),
            PurchaseOrder.po_number.label("po_number"),
            Party.name.label("supplier"),
            Warehouse.name.label("warehouse"),
            PurchaseOrder.order_date.label("order_date"),
            PurchaseOrder.status.label("status"),
            total_order_qty.label("total_order_qty"),
            total_received_qty.label("total_received_qty"),
            (total_order_qty - total_received_qty).label("pending_qty"),
            func.sum(PurchaseOrderLine.ordered_qty * PurchaseOrderLine.unit_cost).label("total_value"),
        )
        .select_from(PurchaseOrder)
        .join(Party, Party.id == PurchaseOrder.supplier_id)
        .join(Warehouse, Warehouse.id == PurchaseOrder.warehouse_id)
        .join(PurchaseOrderLine, PurchaseOrderLine.purchase_order_id == PurchaseOrder.id)
        .group_by(
            PurchaseOrder.id,
            PurchaseOrder.po_number,
            Party.name,
            Warehouse.name,
            PurchaseOrder.order_date,
            PurchaseOrder.status,
        )
    )

    if filters.status is not None:
        stmt = stmt.where(PurchaseOrder.status == filters.status)
    if filters.supplier_id is not None:
        stmt = stmt.where(PurchaseOrder.supplier_id == filters.supplier_id)
    if filters.supplier_name:
        stmt = stmt.where(Party.name.ilike(f"%{filters.supplier_name.strip()}%"))
    if filters.date_from is not None:
        stmt = stmt.where(PurchaseOrder.order_date >= filters.date_from)
    if filters.date_to is not None:
        stmt = stmt.where(PurchaseOrder.order_date <= filters.date_to)

    total = int(db.execute(select(func.count()).select_from(stmt.order_by(None).subquery())).scalar_one())
    offset = (filters.page - 1) * filters.page_size
    rows = db.execute(
        stmt.order_by(PurchaseOrder.order_date.desc(), PurchaseOrder.id.desc())
        .offset(offset)
        .limit(filters.page_size)
    ).mappings()

    data: list[dict[str, object]] = []
    for row in rows:
        data.append(
            {
                "po_number": row["po_number"],
                "supplier": row["supplier"],
                "warehouse": row["warehouse"],
                "order_date": row["order_date"],
                "status": row["status"],
                "total_order_qty": row["total_order_qty"] or Decimal("0"),
                "total_received_qty": row["total_received_qty"] or Decimal("0"),
                "pending_qty": row["pending_qty"] or Decimal("0"),
                "total_value": row["total_value"],
            }
        )

    return total, data
