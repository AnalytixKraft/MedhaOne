from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models.inventory import InventoryLedger
from app.models.product import Product
from app.models.batch import Batch
from app.models.warehouse import Warehouse


@dataclass(slots=True)
class StockMovementFilters:
    product_id: int | None = None
    warehouse_id: int | None = None
    date_from: date | None = None
    date_to: date | None = None
    movement_type: str | None = None
    page: int = 1
    page_size: int = 50


def _movement_base_stmt(filters: StockMovementFilters):
    qty_in_expr = case((InventoryLedger.qty > 0, InventoryLedger.qty), else_=Decimal("0"))
    qty_out_expr = case((InventoryLedger.qty < 0, -InventoryLedger.qty), else_=Decimal("0"))

    stmt = (
        select(
            InventoryLedger.id.label("ledger_id"),
            InventoryLedger.created_at.label("transaction_date"),
            InventoryLedger.reason.label("reason"),
            InventoryLedger.ref_type.label("reference_type"),
            InventoryLedger.ref_id.label("reference_id"),
            InventoryLedger.warehouse_id.label("warehouse_id"),
            InventoryLedger.product_id.label("product_id"),
            InventoryLedger.batch_id.label("batch_id"),
            Product.name.label("product"),
            Batch.batch_no.label("batch"),
            Warehouse.name.label("warehouse"),
            qty_in_expr.label("qty_in"),
            qty_out_expr.label("qty_out"),
            InventoryLedger.qty.label("signed_qty"),
        )
        .select_from(InventoryLedger)
        .join(Product, Product.id == InventoryLedger.product_id)
        .join(Batch, Batch.id == InventoryLedger.batch_id)
        .join(Warehouse, Warehouse.id == InventoryLedger.warehouse_id)
    )

    if filters.product_id is not None:
        stmt = stmt.where(InventoryLedger.product_id == filters.product_id)
    if filters.warehouse_id is not None:
        stmt = stmt.where(InventoryLedger.warehouse_id == filters.warehouse_id)
    if filters.date_from is not None:
        stmt = stmt.where(
            InventoryLedger.created_at >= datetime.combine(filters.date_from, time.min)
        )
    if filters.date_to is not None:
        stmt = stmt.where(
            InventoryLedger.created_at
            < datetime.combine(filters.date_to + timedelta(days=1), time.min)
        )
    if filters.movement_type == "inward":
        stmt = stmt.where(InventoryLedger.qty > 0)
    elif filters.movement_type == "outward":
        stmt = stmt.where(InventoryLedger.qty < 0)

    return stmt


def _serialize_row(row, running_balance: Decimal) -> dict[str, object]:
    return {
        "transaction_date": row["transaction_date"],
        "reason": row["reason"],
        "reference_type": row["reference_type"],
        "reference_id": row["reference_id"],
        "product": row["product"],
        "batch": row["batch"],
        "warehouse": row["warehouse"],
        "qty_in": row["qty_in"] or Decimal("0"),
        "qty_out": row["qty_out"] or Decimal("0"),
        "running_balance": running_balance,
    }


def _sqlite_report(db: Session, filters: StockMovementFilters) -> tuple[int, list[dict[str, object]]]:
    stmt = _movement_base_stmt(filters).order_by(
        InventoryLedger.created_at.asc(),
        InventoryLedger.id.asc(),
    )
    rows = list(db.execute(stmt).mappings())
    total = len(rows)

    start = (filters.page - 1) * filters.page_size
    end = start + filters.page_size

    balances: dict[tuple[int, int, int], Decimal] = {}
    data: list[dict[str, object]] = []

    for idx, row in enumerate(rows):
        key = (row["warehouse_id"], row["product_id"], row["batch_id"])
        balances[key] = balances.get(key, Decimal("0")) + (row["signed_qty"] or Decimal("0"))
        if start <= idx < end:
            data.append(_serialize_row(row, balances[key]))

    return total, data


def _postgres_report(db: Session, filters: StockMovementFilters) -> tuple[int, list[dict[str, object]]]:
    stmt = _movement_base_stmt(filters)
    total = int(db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one())

    running_balance_expr = func.sum(InventoryLedger.qty).over(
        partition_by=(
            InventoryLedger.warehouse_id,
            InventoryLedger.product_id,
            InventoryLedger.batch_id,
        ),
        order_by=(InventoryLedger.created_at.asc(), InventoryLedger.id.asc()),
    )

    rows = db.execute(
        stmt.add_columns(running_balance_expr.label("running_balance"))
        .order_by(InventoryLedger.created_at.asc(), InventoryLedger.id.asc())
        .offset((filters.page - 1) * filters.page_size)
        .limit(filters.page_size)
    ).mappings()

    data = [
        _serialize_row(row, row["running_balance"] or Decimal("0"))
        for row in rows
    ]
    return total, data


def get_stock_movement_report(
    db: Session,
    filters: StockMovementFilters,
) -> tuple[int, list[dict[str, object]]]:
    bind = db.get_bind()
    dialect_name = bind.dialect.name if bind is not None else ""

    if dialect_name == "postgresql":
        return _postgres_report(db, filters)
    return _sqlite_report(db, filters)
