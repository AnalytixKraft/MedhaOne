from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import and_, case, func, literal, not_, select
from sqlalchemy.orm import Session

from app.models.batch import Batch
from app.models.inventory import InventoryLedger
from app.models.product import Product
from app.reports.predicates import opening_entry_predicate
from app.models.warehouse import Warehouse


@dataclass(slots=True)
class CurrentStockFilters:
    brand_values: tuple[str, ...] = ()
    category_values: tuple[str, ...] = ()
    product_ids: tuple[int, ...] = ()
    warehouse_ids: tuple[int, ...] = ()
    batch_nos: tuple[str, ...] = ()
    expiry_from: date | None = None
    expiry_to: date | None = None
    expiry_status: str | None = None
    stock_status: str | None = None
    stock_source: str | None = None
    page: int = 1
    page_size: int = 50


def get_current_stock_report(
    db: Session,
    filters: CurrentStockFilters,
) -> tuple[int, list[dict[str, object]], dict[str, object]]:
    available_qty_expr = func.coalesce(func.sum(InventoryLedger.qty), Decimal("0"))
    stock_value_expr = func.coalesce(
        func.sum(InventoryLedger.qty * func.coalesce(InventoryLedger.unit_cost, Decimal("0"))),
        Decimal("0"),
    )

    stmt = (
        select(
            Product.id.label("product_id"),
            Product.sku.label("sku"),
            Product.name.label("product_name"),
            Product.brand.label("brand"),
            Product.hsn.label("category"),
            Product.quantity_precision.label("quantity_precision"),
            Warehouse.name.label("warehouse"),
            Batch.batch_no.label("batch"),
            Batch.expiry_date.label("expiry_date"),
            available_qty_expr.label("available_qty"),
            literal(Decimal("0")).label("reserved_qty"),
            stock_value_expr.label("stock_value"),
            func.max(InventoryLedger.created_at).label("last_movement_date"),
        )
        .select_from(InventoryLedger)
        .join(Product, Product.id == InventoryLedger.product_id)
        .join(Warehouse, Warehouse.id == InventoryLedger.warehouse_id)
        .join(Batch, Batch.id == InventoryLedger.batch_id)
        .group_by(
            Product.id,
            Product.sku,
            Product.name,
            Product.brand,
            Product.hsn,
            Product.quantity_precision,
            Warehouse.name,
            Batch.batch_no,
            Batch.expiry_date,
        )
    )

    if filters.brand_values:
        stmt = stmt.where(Product.brand.in_(filters.brand_values))
    if filters.category_values:
        stmt = stmt.where(Product.hsn.in_(filters.category_values))
    if filters.product_ids:
        stmt = stmt.where(InventoryLedger.product_id.in_(filters.product_ids))
    if filters.warehouse_ids:
        stmt = stmt.where(InventoryLedger.warehouse_id.in_(filters.warehouse_ids))
    if filters.batch_nos:
        stmt = stmt.where(Batch.batch_no.in_(filters.batch_nos))
    if filters.expiry_from is not None:
        stmt = stmt.where(Batch.expiry_date >= filters.expiry_from)
    if filters.expiry_to is not None:
        stmt = stmt.where(Batch.expiry_date <= filters.expiry_to)
    opening_predicate = opening_entry_predicate()
    if filters.stock_source == "opening":
        stmt = stmt.where(opening_predicate)
    elif filters.stock_source == "non_opening":
        stmt = stmt.where(not_(opening_predicate))

    today = date.today()
    threshold = today + timedelta(days=30)
    if filters.expiry_status == "expired":
        stmt = stmt.where(Batch.expiry_date < today)
    elif filters.expiry_status == "expiring_30":
        stmt = stmt.where(Batch.expiry_date >= today).where(Batch.expiry_date <= threshold)
    elif filters.expiry_status == "safe":
        stmt = stmt.where(Batch.expiry_date > threshold)

    if filters.stock_status == "available":
        stmt = stmt.having(func.sum(InventoryLedger.qty) > 0)
    elif filters.stock_status == "zero":
        stmt = stmt.having(func.sum(InventoryLedger.qty) == 0)
    elif filters.stock_status == "negative":
        stmt = stmt.having(func.sum(InventoryLedger.qty) < 0)

    base_subquery = stmt.order_by(None).subquery()
    total = int(db.execute(select(func.count()).select_from(base_subquery)).scalar_one())

    summary_row = db.execute(
        select(
            func.count(func.distinct(base_subquery.c.product_id)).label("total_skus"),
            func.coalesce(func.sum(base_subquery.c.available_qty), Decimal("0")).label(
                "total_stock_qty"
            ),
            func.coalesce(func.sum(base_subquery.c.stock_value), Decimal("0")).label(
                "total_stock_value"
            ),
            func.coalesce(
                func.sum(
                    case(
                        (
                            and_(
                                base_subquery.c.expiry_date >= today,
                                base_subquery.c.expiry_date <= threshold,
                                base_subquery.c.available_qty > 0,
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("items_expiring_soon"),
        )
    ).mappings().one()

    rows = db.execute(
        stmt.order_by(
            Product.name.asc(),
            Warehouse.name.asc(),
            Batch.expiry_date.asc(),
            Batch.batch_no.asc(),
        )
        .offset((filters.page - 1) * filters.page_size)
        .limit(filters.page_size)
    ).mappings()

    data: list[dict[str, object]] = []
    for row in rows:
        data.append(
            {
                "sku": row["sku"],
                "product_name": row["product_name"],
                "brand": row["brand"],
                "category": row["category"],
                "warehouse": row["warehouse"],
                "batch": row["batch"],
                "expiry_date": row["expiry_date"],
                "available_qty": row["available_qty"] or Decimal("0"),
                "reserved_qty": row["reserved_qty"] or Decimal("0"),
                "stock_value": row["stock_value"] or Decimal("0"),
                "last_movement_date": row["last_movement_date"],
                "quantity_precision": row["quantity_precision"],
            }
        )

    summary = {
        "total_skus": int(summary_row["total_skus"] or 0),
        "total_stock_qty": summary_row["total_stock_qty"] or Decimal("0"),
        "total_stock_value": summary_row["total_stock_value"] or Decimal("0"),
        "items_expiring_soon": int(summary_row["items_expiring_soon"] or 0),
    }

    return total, data, summary
