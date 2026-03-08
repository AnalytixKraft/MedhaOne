from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.batch import Batch
from app.models.inventory import InventoryLedger, StockSummary
from app.models.product import Product
from app.reports.predicates import opening_entry_predicate
from app.models.warehouse import Warehouse


@dataclass(slots=True)
class OpeningStockFilters:
    brand_values: tuple[str, ...] = ()
    category_values: tuple[str, ...] = ()
    product_ids: tuple[int, ...] = ()
    warehouse_ids: tuple[int, ...] = ()
    batch_nos: tuple[str, ...] = ()
    date_from: date | None = None
    date_to: date | None = None
    page: int = 1
    page_size: int = 50


def get_opening_stock_report(
    db: Session,
    filters: OpeningStockFilters,
) -> tuple[int, list[dict[str, object]], dict[str, object]]:
    opening_qty_expr = func.coalesce(func.sum(InventoryLedger.qty), Decimal("0"))
    opening_value_expr = func.coalesce(
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
            opening_qty_expr.label("opening_qty"),
            opening_value_expr.label("opening_value"),
            func.max(InventoryLedger.created_at).label("last_opening_date"),
            func.coalesce(StockSummary.qty_on_hand, Decimal("0")).label("current_qty"),
        )
        .select_from(InventoryLedger)
        .join(Product, Product.id == InventoryLedger.product_id)
        .join(Warehouse, Warehouse.id == InventoryLedger.warehouse_id)
        .join(Batch, Batch.id == InventoryLedger.batch_id)
        .outerjoin(
            StockSummary,
            (StockSummary.warehouse_id == InventoryLedger.warehouse_id)
            & (StockSummary.product_id == InventoryLedger.product_id)
            & (StockSummary.batch_id == InventoryLedger.batch_id),
        )
        .where(opening_entry_predicate())
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
            StockSummary.qty_on_hand,
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
    if filters.date_from is not None:
        stmt = stmt.where(func.date(InventoryLedger.created_at) >= filters.date_from)
    if filters.date_to is not None:
        stmt = stmt.where(func.date(InventoryLedger.created_at) <= filters.date_to)

    base_subquery = stmt.order_by(None).subquery()
    total = int(db.execute(select(func.count()).select_from(base_subquery)).scalar_one())

    summary_row = db.execute(
        select(
            func.count(func.distinct(base_subquery.c.product_id)).label("total_skus"),
            func.coalesce(func.sum(base_subquery.c.opening_qty), Decimal("0")).label(
                "total_opening_qty"
            ),
            func.coalesce(func.sum(base_subquery.c.opening_value), Decimal("0")).label(
                "total_opening_value"
            ),
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
                "opening_qty": row["opening_qty"] or Decimal("0"),
                "opening_value": row["opening_value"] or Decimal("0"),
                "last_opening_date": row["last_opening_date"],
                "current_qty": row["current_qty"] or Decimal("0"),
                "quantity_precision": row["quantity_precision"],
            }
        )

    summary = {
        "total_skus": int(summary_row["total_skus"] or 0),
        "total_opening_qty": summary_row["total_opening_qty"] or Decimal("0"),
        "total_opening_value": summary_row["total_opening_value"] or Decimal("0"),
    }

    return total, data, summary
