from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.inventory import InventoryLedger, StockSummary
from app.models.product import Product
from app.models.warehouse import Warehouse


@dataclass(slots=True)
class DeadStockReportFilters:
    warehouse_id: int | None = None
    warehouse_ids: tuple[int, ...] = ()
    product_id: int | None = None
    product_ids: tuple[int, ...] = ()
    brand_values: tuple[str, ...] = ()
    category_values: tuple[str, ...] = ()
    inactivity_days: int = 90
    page: int = 1
    page_size: int = 50


def get_dead_stock_report(
    db: Session,
    filters: DeadStockReportFilters,
) -> tuple[int, list[dict[str, object]]]:
    stock_totals = (
        select(
            StockSummary.warehouse_id.label("warehouse_id"),
            StockSummary.product_id.label("product_id"),
            func.sum(StockSummary.qty_on_hand).label("current_qty"),
        )
        .where(StockSummary.qty_on_hand > Decimal("0"))
        .group_by(StockSummary.warehouse_id, StockSummary.product_id)
        .subquery()
    )

    last_movement = (
        select(
            InventoryLedger.warehouse_id.label("warehouse_id"),
            InventoryLedger.product_id.label("product_id"),
            func.max(InventoryLedger.created_at).label("last_movement_date"),
        )
        .group_by(InventoryLedger.warehouse_id, InventoryLedger.product_id)
        .subquery()
    )

    cutoff = datetime.combine(date.today() - timedelta(days=filters.inactivity_days), time.min)

    stmt = (
        select(
            Product.name.label("product"),
            Product.quantity_precision.label("quantity_precision"),
            Warehouse.name.label("warehouse"),
            stock_totals.c.current_qty.label("current_qty"),
            last_movement.c.last_movement_date.label("last_movement_date"),
        )
        .select_from(stock_totals)
        .join(Warehouse, Warehouse.id == stock_totals.c.warehouse_id)
        .join(Product, Product.id == stock_totals.c.product_id)
        .outerjoin(
            last_movement,
            (last_movement.c.warehouse_id == stock_totals.c.warehouse_id)
            & (last_movement.c.product_id == stock_totals.c.product_id),
        )
        .where(
            or_(
                last_movement.c.last_movement_date.is_(None),
                last_movement.c.last_movement_date < cutoff,
            )
        )
    )

    if filters.warehouse_id is not None:
        stmt = stmt.where(stock_totals.c.warehouse_id == filters.warehouse_id)
    if filters.warehouse_ids:
        stmt = stmt.where(stock_totals.c.warehouse_id.in_(filters.warehouse_ids))
    if filters.product_id is not None:
        stmt = stmt.where(stock_totals.c.product_id == filters.product_id)
    if filters.product_ids:
        stmt = stmt.where(stock_totals.c.product_id.in_(filters.product_ids))
    if filters.brand_values:
        stmt = stmt.where(Product.brand.in_(filters.brand_values))
    if filters.category_values:
        stmt = stmt.where(Product.hsn.in_(filters.category_values))

    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total = int(db.execute(count_stmt).scalar_one())

    rows = db.execute(
        stmt.order_by(
            last_movement.c.last_movement_date.asc().nullsfirst(),
            Product.name.asc(),
            Warehouse.name.asc(),
        )
        .offset((filters.page - 1) * filters.page_size)
        .limit(filters.page_size)
    ).mappings()

    today = date.today()
    data: list[dict[str, object]] = []
    for row in rows:
        last_movement_date = row["last_movement_date"]
        days_since_movement = (
            (today - last_movement_date.date()).days if last_movement_date is not None else None
        )
        data.append(
            {
                "product": row["product"],
                "quantity_precision": row["quantity_precision"],
                "warehouse": row["warehouse"],
                "current_qty": row["current_qty"] or Decimal("0"),
                "last_movement_date": last_movement_date,
                "days_since_movement": days_since_movement,
            }
        )

    return total, data
