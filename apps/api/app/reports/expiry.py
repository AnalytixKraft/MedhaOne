from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.batch import Batch
from app.models.inventory import StockSummary
from app.models.product import Product
from app.models.warehouse import Warehouse


@dataclass(slots=True)
class ExpiryReportFilters:
    warehouse_id: int | None = None
    warehouse_ids: tuple[int, ...] = ()
    product_id: int | None = None
    product_ids: tuple[int, ...] = ()
    brand_values: tuple[str, ...] = ()
    category_values: tuple[str, ...] = ()
    batch_nos: tuple[str, ...] = ()
    expiry_within_days: int = 30
    include_expired: bool = False
    expiry_status: str | None = None
    page: int = 1
    page_size: int = 50


def get_expiry_report(
    db: Session,
    filters: ExpiryReportFilters,
) -> tuple[int, list[dict[str, object]]]:
    today = date.today()
    threshold_date = today + timedelta(days=filters.expiry_within_days)

    stmt = (
        select(
            Product.name.label("product"),
            Product.quantity_precision.label("quantity_precision"),
            Batch.batch_no.label("batch"),
            Warehouse.name.label("warehouse"),
            Batch.expiry_date.label("expiry_date"),
            StockSummary.qty_on_hand.label("current_qty"),
        )
        .select_from(StockSummary)
        .join(Product, Product.id == StockSummary.product_id)
        .join(Batch, Batch.id == StockSummary.batch_id)
        .join(Warehouse, Warehouse.id == StockSummary.warehouse_id)
        .where(StockSummary.qty_on_hand > Decimal("0"))
    )

    if filters.expiry_status:
        if filters.expiry_status == "expired":
            stmt = stmt.where(Batch.expiry_date < today)
        elif filters.expiry_status == "expiring_30":
            stmt = stmt.where(Batch.expiry_date >= today).where(Batch.expiry_date <= threshold_date)
        elif filters.expiry_status == "safe":
            stmt = stmt.where(Batch.expiry_date > threshold_date)
    else:
        stmt = stmt.where(Batch.expiry_date <= threshold_date)
        if not filters.include_expired:
            stmt = stmt.where(Batch.expiry_date >= today)
    if filters.warehouse_id is not None:
        stmt = stmt.where(StockSummary.warehouse_id == filters.warehouse_id)
    if filters.warehouse_ids:
        stmt = stmt.where(StockSummary.warehouse_id.in_(filters.warehouse_ids))
    if filters.product_id is not None:
        stmt = stmt.where(StockSummary.product_id == filters.product_id)
    if filters.product_ids:
        stmt = stmt.where(StockSummary.product_id.in_(filters.product_ids))
    if filters.brand_values:
        stmt = stmt.where(Product.brand.in_(filters.brand_values))
    if filters.category_values:
        stmt = stmt.where(Product.hsn.in_(filters.category_values))
    if filters.batch_nos:
        stmt = stmt.where(Batch.batch_no.in_(filters.batch_nos))
    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total = int(db.execute(count_stmt).scalar_one())

    rows = db.execute(
        stmt.order_by(Batch.expiry_date.asc(), Product.name.asc(), Warehouse.name.asc())
        .offset((filters.page - 1) * filters.page_size)
        .limit(filters.page_size)
    ).mappings()

    data: list[dict[str, object]] = []
    for row in rows:
        expiry_date = row["expiry_date"]
        data.append(
            {
                "product": row["product"],
                "quantity_precision": row["quantity_precision"],
                "batch": row["batch"],
                "warehouse": row["warehouse"],
                "expiry_date": expiry_date,
                "days_to_expiry": (expiry_date - today).days,
                "current_qty": row["current_qty"] or Decimal("0"),
            }
        )

    return total, data
