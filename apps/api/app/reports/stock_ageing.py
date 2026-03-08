from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models.enums import InventoryReason
from app.models.inventory import InventoryLedger, StockSummary
from app.models.product import Product
from app.models.purchase import GRN
from app.models.warehouse import Warehouse


@dataclass(slots=True)
class StockAgeingFilters:
    warehouse_id: int | None = None
    warehouse_ids: tuple[int, ...] = ()
    product_id: int | None = None
    product_ids: tuple[int, ...] = ()
    brand_values: tuple[str, ...] = ()
    category_values: tuple[str, ...] = ()
    page: int = 1
    page_size: int = 50


def _bucket_for_age(age_in_days: int) -> str:
    if age_in_days <= 30:
        return "bucket_0_30"
    if age_in_days <= 60:
        return "bucket_31_60"
    if age_in_days <= 90:
        return "bucket_61_90"
    return "bucket_90_plus"


def get_stock_ageing_report(
    db: Session,
    filters: StockAgeingFilters,
) -> tuple[int, list[dict[str, object]]]:
    summary_stmt = (
        select(
            StockSummary.warehouse_id.label("warehouse_id"),
            StockSummary.product_id.label("product_id"),
            StockSummary.batch_id.label("batch_id"),
            StockSummary.qty_on_hand.label("qty_on_hand"),
            Product.name.label("product"),
            Product.quantity_precision.label("quantity_precision"),
            Warehouse.name.label("warehouse"),
        )
        .select_from(StockSummary)
        .join(Product, Product.id == StockSummary.product_id)
        .join(Warehouse, Warehouse.id == StockSummary.warehouse_id)
        .where(StockSummary.qty_on_hand > Decimal("0"))
    )

    if filters.warehouse_id is not None:
        summary_stmt = summary_stmt.where(StockSummary.warehouse_id == filters.warehouse_id)
    if filters.warehouse_ids:
        summary_stmt = summary_stmt.where(StockSummary.warehouse_id.in_(filters.warehouse_ids))
    if filters.product_id is not None:
        summary_stmt = summary_stmt.where(StockSummary.product_id == filters.product_id)
    if filters.product_ids:
        summary_stmt = summary_stmt.where(StockSummary.product_id.in_(filters.product_ids))
    if filters.brand_values:
        summary_stmt = summary_stmt.where(Product.brand.in_(filters.brand_values))
    if filters.category_values:
        summary_stmt = summary_stmt.where(Product.hsn.in_(filters.category_values))

    summary_rows = db.execute(
        summary_stmt.order_by(Warehouse.name.asc(), Product.name.asc(), StockSummary.batch_id.asc())
    ).mappings().all()
    if not summary_rows:
        return 0, []

    layer_stmt = (
        select(
            InventoryLedger.warehouse_id.label("warehouse_id"),
            InventoryLedger.product_id.label("product_id"),
            InventoryLedger.batch_id.label("batch_id"),
            InventoryLedger.qty.label("qty"),
            GRN.posted_at.label("posted_at"),
            InventoryLedger.id.label("ledger_id"),
        )
        .select_from(InventoryLedger)
        .join(
            GRN,
            and_(
                InventoryLedger.ref_type == "GRN",
                InventoryLedger.ref_id == GRN.grn_number,
            ),
        )
        .where(InventoryLedger.reason == InventoryReason.PURCHASE_GRN)
        .where(InventoryLedger.qty > Decimal("0"))
        .where(GRN.posted_at.isnot(None))
    )

    if filters.warehouse_id is not None:
        layer_stmt = layer_stmt.where(InventoryLedger.warehouse_id == filters.warehouse_id)
    if filters.warehouse_ids:
        layer_stmt = layer_stmt.where(InventoryLedger.warehouse_id.in_(filters.warehouse_ids))
    if filters.product_id is not None:
        layer_stmt = layer_stmt.where(InventoryLedger.product_id == filters.product_id)
    if filters.product_ids:
        layer_stmt = layer_stmt.where(InventoryLedger.product_id.in_(filters.product_ids))

    layer_rows = db.execute(
        layer_stmt.order_by(GRN.posted_at.asc(), InventoryLedger.id.asc())
    ).mappings()

    layers_by_key: dict[tuple[int, int, int], list[dict[str, object]]] = defaultdict(list)
    today = date.today()
    for row in layer_rows:
        posted_at = row["posted_at"]
        layers_by_key[
            (row["warehouse_id"], row["product_id"], row["batch_id"])
        ].append(
            {
                "qty": row["qty"] or Decimal("0"),
                "age_in_days": (today - posted_at.date()).days,
            }
        )

    totals_by_product: dict[tuple[int, int], dict[str, object]] = {}

    for row in summary_rows:
        product_key = (row["warehouse_id"], row["product_id"])
        result = totals_by_product.setdefault(
            product_key,
            {
                "product": row["product"],
                "quantity_precision": row["quantity_precision"],
                "warehouse": row["warehouse"],
                "bucket_0_30": Decimal("0"),
                "bucket_31_60": Decimal("0"),
                "bucket_61_90": Decimal("0"),
                "bucket_90_plus": Decimal("0"),
            },
        )

        remaining_qty = row["qty_on_hand"] or Decimal("0")
        batch_layers = layers_by_key.get(
            (row["warehouse_id"], row["product_id"], row["batch_id"]),
            [],
        )

        for layer in reversed(batch_layers):
            if remaining_qty <= 0:
                break
            alloc_qty = min(remaining_qty, layer["qty"])
            bucket = _bucket_for_age(int(layer["age_in_days"]))
            result[bucket] += alloc_qty
            remaining_qty -= alloc_qty

        if remaining_qty > 0:
            result["bucket_90_plus"] += remaining_qty

    rows = []
    for value in totals_by_product.values():
        total_qty = (
            value["bucket_0_30"]
            + value["bucket_31_60"]
            + value["bucket_61_90"]
            + value["bucket_90_plus"]
        )
        rows.append(
            {
                "product": value["product"],
                "quantity_precision": value["quantity_precision"],
                "warehouse": value["warehouse"],
                "bucket_0_30": value["bucket_0_30"],
                "bucket_31_60": value["bucket_31_60"],
                "bucket_61_90": value["bucket_61_90"],
                "bucket_90_plus": value["bucket_90_plus"],
                "total_qty": total_qty,
            }
        )

    rows.sort(key=lambda item: (str(item["warehouse"]), str(item["product"])))
    total = len(rows)
    offset = (filters.page - 1) * filters.page_size
    return total, rows[offset : offset + filters.page_size]
