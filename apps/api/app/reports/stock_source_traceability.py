from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.models.batch import Batch
from app.models.inventory import StockSummary
from app.models.party import Party
from app.models.product import Product
from app.models.purchase import GRN, PurchaseOrder
from app.models.purchase_bill import PurchaseBill
from app.models.stock_provenance import StockSourceProvenance
from app.models.warehouse import Warehouse


@dataclass(slots=True)
class StockSourceTraceabilityFilters:
    product_ids: tuple[int, ...] = ()
    warehouse_ids: tuple[int, ...] = ()
    supplier_ids: tuple[int, ...] = ()
    batch_nos: tuple[str, ...] = ()
    date_from: date | None = None
    date_to: date | None = None
    po_number: str | None = None
    grn_number: str | None = None
    bill_number: str | None = None
    page: int = 1
    page_size: int = 50


def _traceability_base_stmt(filters: StockSourceTraceabilityFilters):
    stmt = (
        select(
            StockSourceProvenance.id.label("provenance_id"),
            Product.id.label("product_id"),
            Product.sku.label("sku"),
            Product.name.label("product_name"),
            Product.quantity_precision.label("quantity_precision"),
            Warehouse.id.label("warehouse_id"),
            Warehouse.name.label("warehouse_name"),
            Batch.id.label("batch_id"),
            StockSourceProvenance.batch_no.label("batch_no"),
            StockSourceProvenance.expiry_date.label("expiry_date"),
            func.coalesce(StockSummary.qty_on_hand, Decimal("0")).label("qty_on_hand"),
            Party.id.label("supplier_id"),
            Party.name.label("supplier_name"),
            PurchaseOrder.id.label("purchase_order_id"),
            PurchaseOrder.po_number.label("po_number"),
            PurchaseBill.id.label("purchase_bill_id"),
            PurchaseBill.bill_number.label("bill_number"),
            GRN.id.label("grn_id"),
            GRN.grn_number.label("grn_number"),
            StockSourceProvenance.grn_line_id.label("grn_line_id"),
            StockSourceProvenance.grn_batch_line_id.label("grn_batch_line_id"),
            StockSourceProvenance.inward_date.label("received_date"),
            StockSourceProvenance.unit_cost_snapshot.label("unit_cost"),
            StockSourceProvenance.received_qty.label("received_qty"),
            StockSourceProvenance.free_qty.label("free_qty"),
        )
        .select_from(StockSourceProvenance)
        .join(Product, Product.id == StockSourceProvenance.product_id)
        .join(Warehouse, Warehouse.id == StockSourceProvenance.warehouse_id)
        .join(Party, Party.id == StockSourceProvenance.supplier_id)
        .join(PurchaseOrder, PurchaseOrder.id == StockSourceProvenance.purchase_order_id)
        .join(GRN, GRN.id == StockSourceProvenance.grn_id)
        .join(Batch, Batch.id == StockSourceProvenance.batch_id)
        .outerjoin(PurchaseBill, PurchaseBill.id == StockSourceProvenance.purchase_bill_id)
        .outerjoin(
            StockSummary,
            and_(
                StockSummary.warehouse_id == StockSourceProvenance.warehouse_id,
                StockSummary.product_id == StockSourceProvenance.product_id,
                StockSummary.batch_id == StockSourceProvenance.batch_id,
            ),
        )
    )

    if filters.product_ids:
        stmt = stmt.where(StockSourceProvenance.product_id.in_(filters.product_ids))
    if filters.warehouse_ids:
        stmt = stmt.where(StockSourceProvenance.warehouse_id.in_(filters.warehouse_ids))
    if filters.supplier_ids:
        stmt = stmt.where(StockSourceProvenance.supplier_id.in_(filters.supplier_ids))
    if filters.batch_nos:
        stmt = stmt.where(StockSourceProvenance.batch_no.in_(filters.batch_nos))
    if filters.date_from is not None:
        stmt = stmt.where(StockSourceProvenance.inward_date >= filters.date_from)
    if filters.date_to is not None:
        stmt = stmt.where(StockSourceProvenance.inward_date <= filters.date_to)
    if filters.po_number:
        stmt = stmt.where(PurchaseOrder.po_number.ilike(f"%{filters.po_number.strip()}%"))
    if filters.grn_number:
        stmt = stmt.where(GRN.grn_number.ilike(f"%{filters.grn_number.strip()}%"))
    if filters.bill_number:
        stmt = stmt.where(PurchaseBill.bill_number.ilike(f"%{filters.bill_number.strip()}%"))

    return stmt


def get_stock_source_traceability_report(
    db: Session,
    filters: StockSourceTraceabilityFilters,
) -> tuple[int, list[dict[str, object]]]:
    stmt = _traceability_base_stmt(filters)
    total = int(db.execute(select(func.count()).select_from(stmt.order_by(None).subquery())).scalar_one())

    rows = db.execute(
        stmt.order_by(
            StockSourceProvenance.inward_date.desc(),
            StockSourceProvenance.id.desc(),
        )
        .offset((filters.page - 1) * filters.page_size)
        .limit(filters.page_size)
    ).mappings()

    data: list[dict[str, object]] = []
    for row in rows:
        data.append(
            {
                "product_id": row["product_id"],
                "warehouse_id": row["warehouse_id"],
                "batch_id": row["batch_id"],
                "product": row["product_name"],
                "sku": row["sku"],
                "batch_no": row["batch_no"],
                "expiry_date": row["expiry_date"],
                "warehouse": row["warehouse_name"],
                "qty_on_hand": row["qty_on_hand"] or Decimal("0"),
                "received_qty": row["received_qty"] or Decimal("0"),
                "free_qty": row["free_qty"] or Decimal("0"),
                "supplier_name": row["supplier_name"],
                "po_number": row["po_number"],
                "purchase_bill_number": row["bill_number"],
                "grn_number": row["grn_number"],
                "received_date": row["received_date"],
                "unit_cost": row["unit_cost"],
                "quantity_precision": row["quantity_precision"],
            }
        )

    return total, data


def get_current_stock_source_detail(
    db: Session,
    *,
    warehouse_id: int,
    product_id: int,
    batch_id: int,
) -> dict[str, object] | None:
    header_row = db.execute(
        select(
            Product.id.label("product_id"),
            Product.sku.label("sku"),
            Product.name.label("product_name"),
            Product.quantity_precision.label("quantity_precision"),
            Warehouse.id.label("warehouse_id"),
            Warehouse.name.label("warehouse_name"),
            Batch.id.label("batch_id"),
            Batch.batch_no.label("batch_no"),
            Batch.expiry_date.label("expiry_date"),
            func.coalesce(StockSummary.qty_on_hand, Decimal("0")).label("qty_on_hand"),
        )
        .select_from(StockSummary)
        .join(Product, Product.id == StockSummary.product_id)
        .join(Warehouse, Warehouse.id == StockSummary.warehouse_id)
        .join(Batch, Batch.id == StockSummary.batch_id)
        .where(StockSummary.warehouse_id == warehouse_id)
        .where(StockSummary.product_id == product_id)
        .where(StockSummary.batch_id == batch_id)
    ).mappings().first()

    if header_row is None:
        return None

    rows = db.execute(
        _traceability_base_stmt(StockSourceTraceabilityFilters())
        .where(StockSourceProvenance.warehouse_id == warehouse_id)
        .where(StockSourceProvenance.product_id == product_id)
        .where(StockSourceProvenance.batch_id == batch_id)
        .order_by(StockSourceProvenance.inward_date.desc(), StockSourceProvenance.id.desc())
    ).mappings()

    source_rows: list[dict[str, object]] = []
    for row in rows:
        source_rows.append(
            {
                "supplier_name": row["supplier_name"],
                "po_number": row["po_number"],
                "purchase_bill_number": row["bill_number"],
                "grn_number": row["grn_number"],
                "received_date": row["received_date"],
                "received_qty": row["received_qty"] or Decimal("0"),
                "free_qty": row["free_qty"] or Decimal("0"),
                "unit_cost": row["unit_cost"],
                "grn_line_id": row["grn_line_id"],
                "grn_batch_line_id": row["grn_batch_line_id"],
            }
        )

    return {
        "product_id": header_row["product_id"],
        "warehouse_id": header_row["warehouse_id"],
        "batch_id": header_row["batch_id"],
        "sku": header_row["sku"],
        "product_name": header_row["product_name"],
        "warehouse": header_row["warehouse_name"],
        "batch_no": header_row["batch_no"],
        "expiry_date": header_row["expiry_date"],
        "qty_on_hand": header_row["qty_on_hand"] or Decimal("0"),
        "quantity_precision": header_row["quantity_precision"],
        "sources": source_rows,
    }
